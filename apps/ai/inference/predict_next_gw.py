import sys
import argparse
from pathlib import Path
from datetime import datetime, timezone

sys.path.insert(0, str(Path(__file__).parent.parent))

import numpy as np
import pandas as pd

from config import settings
from constants import (
    FEATURE_COLS,
    FDR_NEUTRAL,
    FDR_MULTIPLIER,
)
from db import read_sql, dispose
from models.model_utils import load_model
from logging_utils import get_logger

logger = get_logger(__name__)

MODEL_VERSION = "points_hybrid_v1 | played_hybrid_v1 | minutes_hybrid_v1"

# ── DB queries ────────────────────────────────────────────────────────────────
# All column names match Prisma schema exactly (camelCase, double-quoted).

CURRENT_GAMEWEEK_QUERY = """
SELECT id AS gameweek
FROM fpl_events
WHERE
    "isCurrent" = TRUE
    OR (raw->>'is_next')::boolean = TRUE
ORDER BY
    CASE WHEN (raw->>'is_next')::boolean = TRUE THEN 0 ELSE 1 END,
    id ASC
LIMIT 1
"""

# Only columns that actually exist on fpl_players.
# Season aggregates (goals, assists etc.) are computed separately from
# player_gameweek_stats — they do NOT exist as columns on fpl_players.
PLAYER_STATE_QUERY = """
SELECT
    p.id                                                AS player_id,
    p."webName"                                         AS web_name,
    p."teamId"                                          AS team_id,
    p.position,
    p."nowCost"                                         AS now_cost,
    p.status,
    COALESCE(CAST(p."selectedByPercent" AS FLOAT), 0.0) AS selected_by_percent,
    COALESCE(CAST(p.form AS FLOAT), 0.0)                AS form,
    COALESCE(
        p."chanceOfPlayingNextRound",
        CASE p.status
            WHEN 'a' THEN 100
            WHEN 'd' THEN 50
            ELSE 0
        END
    )                                                   AS chance_of_playing
FROM fpl_players p
WHERE p.status IN ('a', 'd')
"""

# Season totals aggregated from player_gameweek_stats
SEASON_AGGREGATES_QUERY = """
SELECT
    s."playerId"                AS player_id,
    SUM(s."totalPoints")        AS season_total_pts,
    SUM(s."goalsScored")        AS goals_scored,
    SUM(s.assists)              AS assists,
    SUM(CASE WHEN s."cleanSheets" = TRUE THEN 1 ELSE 0 END) AS clean_sheets,
    SUM(s.bonus)                AS bonus,
    SUM(s.minutes)              AS season_minutes,
    COUNT(*)                    AS games_played
FROM player_gameweek_stats s
GROUP BY s."playerId"
"""

# Recent per-GW stats for rolling features (last 5 GWs)
RECENT_GW_STATS_QUERY = """
SELECT
    s."playerId"                                AS player_id,
    s.gameweek,
    s."totalPoints"                             AS gw_points,
    s.minutes,
    COALESCE(CAST(s.influence  AS FLOAT), 0.0)  AS influence,
    COALESCE(CAST(s.creativity AS FLOAT), 0.0)  AS creativity,
    COALESCE(CAST(s.threat     AS FLOAT), 0.0)  AS threat,
    COALESCE(CAST(s."ictIndex" AS FLOAT), 0.0)  AS ict_index
FROM player_gameweek_stats s
WHERE s.gameweek >= :from_gw
ORDER BY s."playerId", s.gameweek ASC
"""

# Upcoming fixtures joined via team — only for available/doubtful players
UPCOMING_FIXTURES_QUERY = """
SELECT
    p.id                                        AS player_id,
    f.event                                     AS gameweek,
    CASE WHEN f."teamHId" = p."teamId"
         THEN f."teamHDifficulty"
         ELSE f."teamADifficulty"
    END                                         AS fdr,
    CASE WHEN f."teamHId" = p."teamId"
         THEN TRUE ELSE FALSE
    END                                         AS is_home
FROM fpl_players p
JOIN fpl_fixtures f
    ON (f."teamHId" = p."teamId" OR f."teamAId" = p."teamId")
    AND f.event BETWEEN :from_gw AND :to_gw
    AND f.finished = FALSE
WHERE p.status IN ('a', 'd')
ORDER BY p.id, f.event ASC
"""


# ── Gameweek detection ────────────────────────────────────────────────────────

def get_target_gameweek(override: int | None = None) -> int:
    if override:
        logger.info("Using override gameweek: GW%d", override)
        return override

    df = read_sql(CURRENT_GAMEWEEK_QUERY)
    if df.empty:
        raise RuntimeError(
            "Could not detect current gameweek from fpl_events. "
            "Try --gameweek N to specify manually."
        )
    gw = int(df.iloc[0]["gameweek"])
    logger.info("Detected target gameweek: GW%d", gw)
    return gw


# ── Feature builders ──────────────────────────────────────────────────────────

def build_rolling_features(
    player_ids: pd.Series,
    recent_stats: pd.DataFrame,
) -> pd.DataFrame:
    """Rolling pts/minutes/ICT features from recent GW history."""
    zero = {
        "pts_last_1gw":        0.0,
        "pts_last_3gw_avg":    0.0,
        "pts_last_5gw_avg":    0.0,
        "pts_last_5gw_std":    0.0,
        "minutes_last_3gw_avg":0.0,
        "minutes_last_5gw_avg":0.0,
        "ict_index_avg":       0.0,
        "threat_avg":          0.0,
        "creativity_avg":      0.0,
        "influence_avg":       0.0,
        "history_count":       0,
    }

    if recent_stats.empty:
        return pd.DataFrame([{"player_id": pid, **zero} for pid in player_ids])

    stats_grouped = (
        recent_stats.sort_values("gameweek").groupby("player_id")
    )
    rows = []

    for pid in player_ids:
        if pid not in stats_grouped.groups:
            rows.append({"player_id": pid, **zero})
            continue

        grp  = stats_grouped.get_group(pid)
        pts  = grp["gw_points"].values.astype(float)
        mins = grp["minutes"].values.astype(float)
        ict  = grp["ict_index"].values.astype(float)
        thr  = grp["threat"].values.astype(float)
        cre  = grp["creativity"].values.astype(float)
        inf  = grp["influence"].values.astype(float)

        def tail_mean(arr, n):
            return float(np.mean(arr[-n:])) if len(arr) > 0 else 0.0

        def tail_std(arr, n):
            return float(np.std(arr[-n:])) if len(arr) > 1 else 0.0

        rows.append({
            "player_id":           pid,
            "pts_last_1gw":        float(pts[-1]) if len(pts) >= 1 else 0.0,
            "pts_last_3gw_avg":    tail_mean(pts, 3),
            "pts_last_5gw_avg":    tail_mean(pts, 5),
            "pts_last_5gw_std":    tail_std(pts, 5),
            "minutes_last_3gw_avg":tail_mean(mins, 3),
            "minutes_last_5gw_avg":tail_mean(mins, 5),
            "ict_index_avg":       tail_mean(ict, 5),
            "threat_avg":          tail_mean(thr, 5),
            "creativity_avg":      tail_mean(cre, 5),
            "influence_avg":       tail_mean(inf, 5),
            "history_count":       len(grp),
        })

    return pd.DataFrame(rows)


def build_fixture_features(
    player_ids: pd.Series,
    upcoming_fixtures: pd.DataFrame,
    target_gw: int,
) -> pd.DataFrame:
    """Injects next_gw_fdr, avg_fdr_next3, is_home_next_gw from real upcoming fixtures."""
    result = pd.DataFrame({
        "player_id":       player_ids.values,
        "next_gw_fdr":     float(FDR_NEUTRAL),
        "is_home_next_gw": 0.0,
        "avg_fdr_next3":   float(FDR_NEUTRAL),
    })
    result = result.set_index("player_id")

    if not upcoming_fixtures.empty:
        fix_grouped = upcoming_fixtures.sort_values("gameweek").groupby("player_id")

        for pid in player_ids:
            if pid not in fix_grouped.groups:
                continue

            grp      = fix_grouped.get_group(pid)
            next_fix = grp[grp["gameweek"] == target_gw]
            next3    = grp[grp["gameweek"].between(target_gw, target_gw + 2)]

            if not next_fix.empty:
                fdr_val  = next_fix.iloc[0]["fdr"]
                home_val = next_fix.iloc[0]["is_home"]
                result.at[pid, "next_gw_fdr"]     = float(fdr_val  if fdr_val  is not None else FDR_NEUTRAL)
                result.at[pid, "is_home_next_gw"] = float(home_val if home_val is not None else False)

            if not next3.empty:
                result.at[pid, "avg_fdr_next3"] = float(
                    next3["fdr"].fillna(FDR_NEUTRAL).mean()
                )

    return result.reset_index()


def build_season_features(
    player_ids: pd.Series,
    season_agg: pd.DataFrame,
) -> pd.DataFrame:
    """Merges season aggregate stats and computes pts_per_game."""
    base   = pd.DataFrame({"player_id": player_ids})
    merged = base.merge(season_agg, on="player_id", how="left")

    for col in ["season_total_pts", "goals_scored", "assists",
                "clean_sheets", "bonus", "season_minutes", "games_played"]:
        merged[col] = merged[col].fillna(0).astype(float)

    games_safe          = merged["games_played"].clip(lower=1)
    merged["pts_per_game"] = (merged["season_total_pts"] / games_safe).round(3)

    return merged[[
        "player_id", "season_total_pts", "pts_per_game",
        "goals_scored", "assists", "clean_sheets", "bonus",
    ]]


# ── Confidence scorer ─────────────────────────────────────────────────────────

def derive_confidence(
    prob_playing_pct: float,
    minutes_last_3gw_avg: float,
    history_count: int,
) -> str:
    if history_count < 3:
        return "LOW"
    if prob_playing_pct < 50:
        return "LOW"
    if prob_playing_pct < 75 or minutes_last_3gw_avg < 20:
        return "MEDIUM"
    if history_count < 8:
        return "MEDIUM"
    return "HIGH"


# ── Multi-GW projection ───────────────────────────────────────────────────────

def project_multi_gw(
    predicted_gw1: float,
    avg_fdr_next3: float,
    next_gw_fdr: float,
) -> tuple[float, float]:
    fdr_next  = FDR_MULTIPLIER.get(round(next_gw_fdr),   1.0)
    fdr_next3 = FDR_MULTIPLIER.get(round(avg_fdr_next3), 1.0)
    ratio     = fdr_next3 / fdr_next if fdr_next > 0 else 1.0

    predicted_gw3 = round(predicted_gw1 * 3 * max(0.5, ratio), 2)
    predicted_gw5 = round(predicted_gw1 * 5 * 0.95, 2)
    return predicted_gw3, predicted_gw5


# ── Main inference ────────────────────────────────────────────────────────────

def run_inference(target_gw: int) -> pd.DataFrame:
    logger.info("Starting inference for GW%d", target_gw)

    # Load models
    points_model  = load_model(settings.models_dir / "points_model.joblib")
    played_model  = load_model(settings.models_dir / "played_classifier.joblib")
    minutes_model = load_model(settings.models_dir / "minutes_regressor.joblib")
    logger.info("Models loaded. Version: %s", MODEL_VERSION)

    # Pull data
    from_gw_history   = max(1, target_gw - 10)  # 10 GWs for confidence scoring; rolling features use last 5
    players_df        = read_sql(PLAYER_STATE_QUERY)
    season_agg        = read_sql(SEASON_AGGREGATES_QUERY)
    recent_stats      = read_sql(RECENT_GW_STATS_QUERY, {"from_gw": from_gw_history})
    upcoming_fixtures = read_sql(
        UPCOMING_FIXTURES_QUERY,
        {"from_gw": target_gw, "to_gw": target_gw + 2},
    )

    logger.info(
        "DB pull: %d players | %d season agg rows | %d recent stat rows | %d fixture rows",
        len(players_df), len(season_agg), len(recent_stats), len(upcoming_fixtures),
    )

    if players_df.empty:
        raise RuntimeError(
            "No eligible players found. "
            "Check that fpl_players has rows with status 'a' or 'd'."
        )

    player_ids = players_df["player_id"]

    # Build features
    rolling_feats = build_rolling_features(player_ids, recent_stats)
    fixture_feats = build_fixture_features(player_ids, upcoming_fixtures, target_gw)
    season_feats  = build_season_features(player_ids, season_agg)

    # Merge
    features = players_df[[
        "player_id", "form", "chance_of_playing",
        "position", "now_cost", "selected_by_percent",
    ]].copy()
    features = features.merge(rolling_feats, on="player_id", how="left")
    features = features.merge(fixture_feats,  on="player_id", how="left")
    features = features.merge(season_feats,   on="player_id", how="left")

    # Ensure all feature columns exist and are non-NaN
    for col in FEATURE_COLS:
        if col not in features.columns:
            logger.warning("Feature '%s' missing — filling with 0", col)
            features[col] = 0.0
        features[col] = features[col].fillna(0)

    features["history_count"] = features.get("history_count", pd.Series(0)).fillna(0).astype(int)

    X = features[FEATURE_COLS].astype(float)
    logger.info("Feature matrix: %d players × %d features", X.shape[0], X.shape[1])

    # Run models
    pred_pts_gw1 = np.clip(points_model.predict(X), 0, None)

    if hasattr(played_model, "predict_proba"):
        prob_playing = played_model.predict_proba(X)[:, 1]
    elif hasattr(played_model, "decision_function"):
        scores       = played_model.decision_function(X)
        prob_playing = 1 / (1 + np.exp(-scores))
    else:
        prob_playing = played_model.predict(X).astype(float)

    pred_minutes = np.clip(minutes_model.predict(X), 0, 90)
    prob_60_plus = np.where(
        pred_minutes >= 60,
        np.clip((pred_minutes - 60) / 30 * 0.5 + 0.5, 0.5, 1.0),
        np.clip(pred_minutes / 60 * 0.5, 0.0, 0.5),
    )

    logger.info(
        "Inference complete — mean xPts: %.2f | mean prob_playing: %.2f",
        pred_pts_gw1.mean(), prob_playing.mean(),
    )

    # Assemble output
    now  = datetime.now(timezone.utc).isoformat()
    rows = []

    for i in range(len(features)):
        row     = features.iloc[i]
        pid     = int(row["player_id"])
        pts_gw1 = round(float(pred_pts_gw1[i]), 2)
        prob_pl = round(float(prob_playing[i]),  4)
        prob_60 = round(float(prob_60_plus[i]),  4)
        predicted_minutes=round(float(pred_minutes[i]), 2)

        pts_gw3, pts_gw5 = project_multi_gw(
            pts_gw1,
            float(row.get("avg_fdr_next3", FDR_NEUTRAL)),
            float(row.get("next_gw_fdr",   FDR_NEUTRAL)),
        )

        rows.append({
            "player_id":         pid,
            "gameweek":          target_gw,
            "predicted_pts_gw1": pts_gw1,
            "predicted_pts_gw3": pts_gw3,
            "predicted_pts_gw5": pts_gw5,
            "prob_playing":      prob_pl,
            "prob_60_plus_mins": prob_60,
            "predicted_minutes": predicted_minutes,
            "model_version":     MODEL_VERSION,
            "confidence":        derive_confidence(
                prob_pl * 100,
                float(row.get("minutes_last_3gw_avg", 0)),
                int(row.get("history_count", 0)),
            ),
            "generated_at":      now,
        })

    predictions = pd.DataFrame(rows)

    logger.info(
        "Generated %d predictions for GW%d | HIGH: %d | MEDIUM: %d | LOW: %d",
        len(predictions), target_gw,
        (predictions["confidence"] == "HIGH").sum(),
        (predictions["confidence"] == "MEDIUM").sum(),
        (predictions["confidence"] == "LOW").sum(),
    )
    return predictions


# ── CLI ───────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Run FPL ML inference for next GW")
    parser.add_argument("--gameweek", type=int, default=None)
    args = parser.parse_args()

    try:
        target_gw   = get_target_gameweek(args.gameweek)
        predictions = run_inference(target_gw)

        settings.ensure_artifact_dirs()
        out_path = settings.datasets_dir / f"predictions_gw{target_gw}.parquet"
        predictions.to_parquet(out_path, index=False)
        logger.info("Predictions saved to %s", out_path)

        top5 = predictions.nlargest(5, "predicted_pts_gw1")[
            ["player_id", "predicted_pts_gw1", "prob_playing", "confidence"]
        ]
        logger.info("Top 5 predicted scorers:\n%s", top5.to_string(index=False))

    finally:
        dispose()


if __name__ == "__main__":
    main()