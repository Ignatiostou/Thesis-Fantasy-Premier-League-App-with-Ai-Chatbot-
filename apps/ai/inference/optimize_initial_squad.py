import sys
import json
import argparse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pandas as pd

try:
    from pulp import (
        LpProblem, LpMaximize, LpVariable, lpSum, LpBinary, LpStatus,
        PULP_CBC_CMD,
    )
except ImportError as e:
    print("ERROR: PuLP not installed. Run: pip install pulp", file=sys.stderr)
    raise

from config import settings
from db import read_sql, dispose
from logging_utils import get_logger

logger = get_logger(__name__)

# ── FPL constants ─────────────────────────────────────────────────────────────
SQUAD_SIZE                = 15
POSITION_QUOTAS           = {1: 2, 2: 5, 3: 5, 4: 3}   # GK=2, DEF=5, MID=5, FWD=3
BUDGET_TENTHS             = 1000                        # £100.0m
MAX_PLAYERS_PER_CLUB      = 3

# Solver timeout — small problems should solve in <1s; if it takes more than
# 30s something is wrong with the inputs.
SOLVER_TIMEOUT_SECONDS    = 30


# ── Candidate query ───────────────────────────────────────────────────────────
# Pulls every eligible player + their latest prediction. Joins via
# (player_id, latest gameweek prediction).
CANDIDATE_QUERY = """
WITH latest_pred AS (
    SELECT DISTINCT ON (player_id)
        player_id,
        gameweek,
        predicted_pts_gw1,
        predicted_pts_gw3,
        predicted_pts_gw5,
        prob_playing,
        prob_60_plus_mins,
        confidence,
        model_version
    FROM player_predictions
    ORDER BY player_id, gameweek DESC, generated_at DESC
)
SELECT
    p.id                          AS player_id,
    p."webName"                   AS web_name,
    p."teamId"                    AS team_id,
    t."shortName"                 AS team_short_name,
    p.position,
    p."nowCost"                   AS now_cost,
    p.status,
    p."selectedByPercent"         AS selected_by_percent,
    p."chanceOfPlayingNextRound"  AS chance_of_playing,
    lp.gameweek                   AS pred_gw,
    lp.predicted_pts_gw1,
    lp.predicted_pts_gw3,
    lp.predicted_pts_gw5,
    lp.prob_playing,
    lp.prob_60_plus_mins,
    lp.confidence,
    lp.model_version
FROM fpl_players p
JOIN fpl_teams t ON p."teamId" = t.id
LEFT JOIN latest_pred lp ON lp.player_id = p.id
WHERE p.status IN ('a', 'd')
  AND lp.predicted_pts_gw5 IS NOT NULL
ORDER BY p.id
"""


# ── Profile loading (mirrors the TypeScript derivation) ───────────────────────

USER_PROFILE_QUERY = """
SELECT
    "riskTolerance", "budgetStyle", "preferredFocus",
    "differentialPreference", "planningHorizon", "explanationDepth",
    notes
FROM user_assistant_profiles
WHERE "userId" = %(uid)s
"""

DEFAULT_WEIGHTS = {
    "gw1_weight":            0.20,
    "gw5_weight":            0.80,
    "availability_exponent": 1.0,
    "differential_bonus":    0.05,
    "big_six_multiplier":    1.0,
    "top_six_defender":      1.0,
    "premium_attraction":    1.0,   # multiplies score for premium-priced players
}

BIG_SIX = {"ARS", "CHE", "LIV", "MCI", "MUN", "TOT"}


def derive_squad_weights(profile_row: pd.Series | None) -> dict:
    """Squad-build profile → coefficient vector.

    Differs slightly from the per-week scoring weights:
      - planningHorizon weights GW1 vs GW5 (since this is an INITIAL squad —
        long horizon matters more than for weekly transfers)
      - budgetStyle introduces a "premium attraction" coefficient
    """
    w = dict(DEFAULT_WEIGHTS)
    if profile_row is None or profile_row.empty:
        return w

    # planningHorizon — short-term (1) prioritises GW1; long-term (3) prioritises GW5
    ph = int(profile_row.get("planningHorizon", 2) or 2)
    if ph == 1:   w["gw1_weight"], w["gw5_weight"] = 0.40, 0.60
    elif ph == 3: w["gw1_weight"], w["gw5_weight"] = 0.10, 0.90
    else:         w["gw1_weight"], w["gw5_weight"] = 0.20, 0.80

    # riskTolerance — low (1) penalises availability gaps more
    rt = int(profile_row.get("riskTolerance", 2) or 2)
    w["availability_exponent"] = {1: 1.5, 2: 1.0, 3: 0.7}[rt]

    # differentialPreference
    dp = int(profile_row.get("differentialPreference", 2) or 2)
    w["differential_bonus"] = {1: 0.0, 2: 0.05, 3: 0.20}[dp]

    # budgetStyle
    bs = int(profile_row.get("budgetStyle", 2) or 2)
    w["premium_attraction"] = {1: 0.92, 2: 1.0, 3: 1.10}[bs]

    # Notes extras
    extras = {}
    raw_notes = profile_row.get("notes")
    if isinstance(raw_notes, str):
        try: extras = json.loads(raw_notes)
        except Exception: extras = {}

    tsa = extras.get("topSixAffinity")
    if isinstance(tsa, (int, float)):
        w["big_six_multiplier"] = {1: 0.85, 2: 1.00, 3: 1.15}.get(int(tsa), 1.0)
        if int(profile_row.get("preferredFocus", 2) or 2) == 1:
            w["top_six_defender"] = 1.10
    return w


# ── Objective value per player ────────────────────────────────────────────────

def compute_objective(row: pd.Series, w: dict) -> float:
    """
    Return the expected-value of including this player in the squad.
    """
    if pd.isna(row["predicted_pts_gw5"]):
        return 0.0

    # Horizon-weighted xPts — GW1 is per-GW (×5 to compare to GW5 total)
    horizon = (
        (row["predicted_pts_gw1"] or 0) * 5.0 * w["gw1_weight"]
        + (row["predicted_pts_gw5"] or 0) * w["gw5_weight"]
    )

    # Availability shaping
    prob_play = row["prob_playing"] if row["prob_playing"] is not None else 0.5
    avail = max(0.20, float(prob_play)) ** w["availability_exponent"]

    # Confidence discount
    confidence = (row["confidence"] or "MEDIUM")
    conf_mul = {"HIGH": 1.05, "MEDIUM": 1.00, "LOW": 0.82}.get(confidence, 1.0)

    base = horizon * avail * conf_mul

    # Big-six adjustment
    team_short = row["team_short_name"]
    big_six_mul = w["big_six_multiplier"] if team_short in BIG_SIX else 1.0
    if team_short in BIG_SIX and int(row["position"]) == 2:
        big_six_mul *= w["top_six_defender"]

    # Premium attraction — bias toward higher-priced players if user prefers premium
    # Anchored around the average cost (60)
    premium_factor = ((row["now_cost"] or 60) / 60.0) ** (w["premium_attraction"] - 1.0)

    # Differential bonus — additive, proportional to base
    ownership = float(row["selected_by_percent"] or 50.0)
    diff_bonus = 0.0
    if w["differential_bonus"] > 0:
        diff_bonus = w["differential_bonus"] * max(0.0, (100.0 - ownership) / 100.0) * max(2.0, base)

    return float(base * big_six_mul * premium_factor + diff_bonus)


# ── Main optimiser ────────────────────────────────────────────────────────────

def optimize_squad(
    user_id: str | None,
    budget_tenths: int = BUDGET_TENTHS,
    forced_in_ids: list[int] | None = None,
    forced_out_ids: list[int] | None = None,
) -> dict:
    """
    Solve the ILP and return:
      {
        "status": "OPTIMAL" | "INFEASIBLE" | "TIMEOUT",
        "objective_value": float,
        "squad": [ { player_id, web_name, position, team, cost, predicted_pts_gw5, ... }, ... ],
        "budget_used": int (tenths),
        "weights": { ... },
      }
    """
    candidates = read_sql(CANDIDATE_QUERY)
    if candidates.empty:
        return {"status": "INFEASIBLE", "reason": "No candidate players returned from DB"}

    # Load profile and derive weights
    profile_row = None
    if user_id:
        prof = read_sql(USER_PROFILE_QUERY, {"uid": user_id})
        if not prof.empty:
            profile_row = prof.iloc[0]
    weights = derive_squad_weights(profile_row)

    # Compute per-player objective value
    candidates["obj_value"] = candidates.apply(lambda r: compute_objective(r, weights), axis=1)

    # Filter out zero-value rows (no prediction or zero objective)
    candidates = candidates[candidates["obj_value"] > 0].reset_index(drop=True)

    if len(candidates) < SQUAD_SIZE:
        return {
            "status": "INFEASIBLE",
            "reason": f"Only {len(candidates)} candidate players have non-zero objective values",
        }

    logger.info("Optimising over %d candidate players", len(candidates))

    # ── Build the ILP ─────────────────────────────────────────────────────────
    prob = LpProblem("FPL_Initial_Squad", LpMaximize)

    # Decision variables: one binary per candidate
    x = {}
    for idx, row in candidates.iterrows():
        var_name = f"x_{int(row['player_id'])}"
        x[idx] = LpVariable(var_name, cat=LpBinary)

    # Objective
    prob += lpSum(x[idx] * row["obj_value"] for idx, row in candidates.iterrows())

    # Constraint: exactly 15 players
    prob += lpSum(x[idx] for idx in candidates.index) == SQUAD_SIZE, "TotalSize"

    # Constraint: positional quotas
    for pos, quota in POSITION_QUOTAS.items():
        position_indices = candidates.index[candidates["position"] == pos]
        prob += lpSum(x[i] for i in position_indices) == quota, f"Position_{pos}"

    # Constraint: budget
    prob += lpSum(
        x[idx] * int(row["now_cost"]) for idx, row in candidates.iterrows()
    ) <= budget_tenths, "Budget"

    # Constraint: max 3 per club
    for team_id in candidates["team_id"].unique():
        team_indices = candidates.index[candidates["team_id"] == team_id]
        prob += lpSum(x[i] for i in team_indices) <= MAX_PLAYERS_PER_CLUB, f"Club_{int(team_id)}"

    # Optional forced inclusions / exclusions
    if forced_in_ids:
        for pid in forced_in_ids:
            matches = candidates.index[candidates["player_id"] == pid]
            for i in matches:
                prob += x[i] == 1, f"ForceIn_{pid}"
    if forced_out_ids:
        for pid in forced_out_ids:
            matches = candidates.index[candidates["player_id"] == pid]
            for i in matches:
                prob += x[i] == 0, f"ForceOut_{pid}"

    # ── Solve ─────────────────────────────────────────────────────────────────
    solver = PULP_CBC_CMD(msg=False, timeLimit=SOLVER_TIMEOUT_SECONDS)
    prob.solve(solver)

    status_str = LpStatus[prob.status]
    logger.info("Solver status: %s, objective = %.3f", status_str, prob.objective.value() or 0)

    if status_str != "Optimal":
        return {"status": status_str.upper(), "reason": "Solver did not find optimal solution"}

    # Collect picks
    chosen_indices = [idx for idx in candidates.index if x[idx].value() == 1]
    chosen_df = candidates.loc[chosen_indices].copy().sort_values(["position", "obj_value"], ascending=[True, False])

    POSITION_LABEL = {1: "GK", 2: "DEF", 3: "MID", 4: "FWD"}
    squad = []
    for _, row in chosen_df.iterrows():
        squad.append({
            "player_id":            int(row["player_id"]),
            "web_name":             row["web_name"],
            "position":             POSITION_LABEL[int(row["position"])],
            "team":                 row["team_short_name"],
            "cost":                 int(row["now_cost"]) / 10.0,
            "predicted_pts_gw1":    float(row["predicted_pts_gw1"] or 0),
            "predicted_pts_gw5":    float(row["predicted_pts_gw5"] or 0),
            "prob_playing":         float(row["prob_playing"] or 0),
            "confidence":           row["confidence"],
            "ownership_percent":    float(row["selected_by_percent"] or 0),
            "objective_value":      float(row["obj_value"]),
        })

    total_cost = sum(p["cost"] for p in squad)

    return {
        "status":          "OPTIMAL",
        "objective_value": float(prob.objective.value()),
        "squad":           squad,
        "budget_used":     round(total_cost, 1),
        "budget_left":     round(100.0 - total_cost, 1),
        "weights":         weights,
        "candidate_count": int(len(candidates)),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Optimise FPL initial squad via ILP")
    parser.add_argument("--user-id", type=str, default=None, help="User ID for profile-aware optimisation")
    parser.add_argument("--budget", type=int, default=BUDGET_TENTHS, help="Budget in tenths (default 1000 = £100.0m)")
    parser.add_argument("--force-in",  type=int, nargs="*", default=[], help="Player IDs that MUST be in the squad")
    parser.add_argument("--force-out", type=int, nargs="*", default=[], help="Player IDs that must NOT be in the squad")
    parser.add_argument("--json-out", action="store_true", help="Print result as JSON (for TS spawn integration)")
    args = parser.parse_args()

    result = optimize_squad(
        user_id=args.user_id,
        budget_tenths=args.budget,
        forced_in_ids=args.force_in,
        forced_out_ids=args.force_out,
    )

    if args.json_out:
        print(json.dumps(result, indent=2))
    else:
        if result["status"] != "OPTIMAL":
            logger.error("Optimisation failed: %s", result)
            sys.exit(1)
        logger.info("=== Optimal Squad (objective=%.2f, budget used £%.1fm) ===", result["objective_value"], result["budget_used"])
        for p in result["squad"]:
            logger.info(
                "  %s | %s (%s) | £%.1fm | GW1 xPts %.2f | GW5 xPts %.2f | %d%% own",
                p["position"], p["web_name"], p["team"], p["cost"],
                p["predicted_pts_gw1"], p["predicted_pts_gw5"], int(p["ownership_percent"]),
            )


if __name__ == "__main__":
    try:
        main()
    finally:
        dispose()