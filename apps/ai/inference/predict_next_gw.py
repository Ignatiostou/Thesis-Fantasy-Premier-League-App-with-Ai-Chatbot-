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
    OPPONENT_FEATURE_COLS,
    FDR_NEUTRAL,
    FDR_MULTIPLIER,
)
from db import read_sql, dispose
from features.player_features import build_team_round_table
from models.model_utils import load_model
from logging_utils import get_logger

logger = get_logger(__name__)

MODEL_VERSION = "points_hybrid_v1 | played_hybrid_v1 | minutes_hybrid_v1"

# Width of the rolling windows the features are built on.
ROLLING_WINDOW = 5
# Archived rounds are renumbered below zero so that sorting by gameweek places
# last season before this one — gameweek numbers restart at 1 every season.
PRIOR_SEASON_OFFSET = -100

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


# Per-player rows for recent gameweeks, carrying the club they actually played
# for. Aggregated into team-level form below.
TEAM_RECENT_STATS_QUERY = """
SELECT
    COALESCE(s."teamId", p."teamId")                AS team_id,
    s.gameweek,
    s.minutes,
    s."goalsScored"                                 AS gw_goals_scored,
    s."goalsConceded"                               AS gw_goals_conceded,
    CASE WHEN s."cleanSheets" THEN 1.0 ELSE 0.0 END AS gw_clean_sheets,
    s."wasHome"                                     AS was_home
FROM player_gameweek_stats s
JOIN fpl_players p ON p.id = s."playerId"
WHERE s.gameweek >= :from_gw
"""

TEAM_SHORTNAME_QUERY = 'SELECT id, "shortName" AS short_name FROM fpl_teams'

# Who each player faces in the gameweek being predicted. Unlike training — where
# 2025-26 never recorded the opponent — this is always knowable at inference,
# because upcoming fixtures are published in advance.
NEXT_OPPONENT_QUERY = """
SELECT DISTINCT ON (p.id)
    p.id                                                        AS player_id,
    CASE WHEN f."teamHId" = p."teamId" THEN f."teamAId"
         ELSE f."teamHId" END                                   AS opponent_team_id,
    CASE WHEN f."teamHId" = p."teamId" THEN 1.0 ELSE 0.0 END    AS is_home_next_gw
FROM fpl_players p
JOIN fpl_fixtures f
    ON (f."teamHId" = p."teamId" OR f."teamAId" = p."teamId")
    AND f.event = :gw
WHERE p.status IN ('a', 'd')
ORDER BY p.id, f.id
"""


# ── Archived history (season-boundary fallback) ───────────────────────────────

def load_archived_history() -> pd.DataFrame:
    """Most recent archived season's per-GW rows.

    Season-boundary fallback: rollover_season.py clears player_gameweek_stats,
    so before GW1 of a new season the DB has nothing to build rolling features
    from. Training already merges these archives via extract_with_history();
    without the same history here every form feature collapses to zero and the
    models are asked to score a feature vector unlike anything they trained on.
    """
    history_dir = settings.datasets_dir / "history"
    if not history_dir.exists():
        return pd.DataFrame()

    paths = sorted(history_dir.glob("player_gw_history_*.parquet"))
    if not paths:
        return pd.DataFrame()

    latest = paths[-1]          # season tags sort chronologically
    df = pd.read_parquet(latest)

    # Archives written before the extract deduplicated its fixtures join hold one
    # row per fixture on double gameweeks, each carrying the already-summed round
    # totals. Left alone they double that round's goals when aggregated to team
    # level. extract_with_history() does the same for the training path.
    dupes = int(df.duplicated(["player_id", "gameweek"]).sum())
    if dupes:
        logger.warning("Archive has %d duplicate player-gameweek rows "
                       "(double gameweeks) — keeping the first of each.", dupes)
        df = df.drop_duplicates(["player_id", "gameweek"], keep="first").reset_index(drop=True)

    logger.info(
        "Season boundary — using archived history: %s (%d rows)", latest.name, len(df)
    )
    return df


# ── Team form (mirrors features/player_features._add_team_form_features) ──────

def team_stats_from_archive(archive: pd.DataFrame) -> pd.DataFrame:
    """Reshape archived rows into the same columns TEAM_RECENT_STATS_QUERY returns.

    Joined on club short name, NOT team id: FPL renumbers team ids whenever the
    league composition changes, so last season's id 17 is a different club this
    season. Promoted sides have no archived history and simply drop out, which
    is correct — nobody has prior top-flight data for them.
    """
    if archive.empty or "team_short_name" not in archive.columns:
        return pd.DataFrame()

    teams = read_sql(TEAM_SHORTNAME_QUERY)
    by_short = {str(r.short_name): int(r.id) for r in teams.itertuples()}

    a = archive.copy()
    a["team_id"] = a["team_short_name"].map(by_short)
    matched = a["team_id"].notna()
    if not matched.any():
        logger.warning("No archived club names matched current teams — team form unavailable")
        return pd.DataFrame()
    logger.info("Archived team form mapped for %d of %d clubs by short name",
                a.loc[matched, "team_id"].nunique(), a["team_short_name"].nunique())

    a = a[matched]
    return pd.DataFrame({
        "team_id": a["team_id"].astype(int),
        "gameweek": a["gameweek"].astype(int),
        "minutes": a["minutes"].astype(float),
        "gw_goals_scored": a["goals_scored"].astype(float),
        "gw_goals_conceded": a["goals_conceded"].astype(float),
        "gw_clean_sheets": a["clean_sheets"].astype(float),
        "was_home": a["was_home"],
    })


def build_team_form_features(team_stats: pd.DataFrame) -> pd.DataFrame:
    """One row per team: last-5 attacking/defensive form, plus venue splits.

    Uses the same aggregation as training (build_team_round_table), so the
    definition of a team's goals for/against cannot drift between the two paths.

    Note the window convention: training computes these with shift(1), i.e. as of
    the row BEFORE the one being scored, whereas here — matching the existing
    build_rolling_features — the most recent completed gameweek is included. The
    same one-gameweek offset already applies to every player-level feature.
    """
    cols = ["team_id", "team_gf_l5", "team_ga_l5", "team_cs_rate_l5", "team_gd_l5",
            "_home_gf", "_home_ga", "_away_gf", "_away_ga"]
    if team_stats.empty:
        logger.warning("No team stats available — team form features will be 0")
        return pd.DataFrame(columns=cols)

    t = team_stats.copy()
    t["_round_key"] = t["gameweek"].astype(int)
    table = build_team_round_table(t, ["team_id"])

    rows = []
    for tid, g in table.groupby("team_id", sort=False):
        g = g.sort_values("_round_key")
        last5 = g.tail(5)
        home5 = g[g["was_home"] == True].tail(5)    # noqa: E712 — pandas mask
        away5 = g[g["was_home"] == False].tail(5)   # noqa: E712
        rows.append({
            "team_id": int(tid),
            "team_gf_l5": float(last5["team_gf"].mean()),
            "team_ga_l5": float(last5["team_ga"].mean()),
            "team_cs_rate_l5": float(last5["team_cs"].mean()),
            "_home_gf": float(home5["team_gf"].mean()) if len(home5) else np.nan,
            "_home_ga": float(home5["team_ga"].mean()) if len(home5) else np.nan,
            "_away_gf": float(away5["team_gf"].mean()) if len(away5) else np.nan,
            "_away_ga": float(away5["team_ga"].mean()) if len(away5) else np.nan,
        })

    out = pd.DataFrame(rows)
    out["team_gd_l5"] = out["team_gf_l5"] - out["team_ga_l5"]
    logger.info("Team form built for %d clubs", len(out))
    return out[cols]


def build_opponent_strength_features(team_form: pd.DataFrame,
                                     next_opponents: pd.DataFrame) -> pd.DataFrame:
    """Per player: the form of the side he is about to face.

    `team_form` is the output of build_team_form_features (one row per club);
    `next_opponents` maps player_id -> opponent_team_id for the target gameweek.
    Returns zeros when the opponent is unknown, which is the case for every row
    until opponent_team_id has been captured from GW1 2026-27 onward.
    """
    cols = ["player_id"] + OPPONENT_FEATURE_COLS
    if team_form.empty or next_opponents.empty:
        logger.info("Opponent identity unavailable — opponent features are 0")
        return pd.DataFrame(columns=cols)

    src = team_form.rename(columns={
        "team_id": "opponent_team_id",
        "team_gf_l5": "opp_gf_l5",
        "team_ga_l5": "opp_ga_l5",
        "team_cs_rate_l5": "opp_cs_rate_l5",
        "team_gd_l5": "opp_gd_l5",
    })
    out = next_opponents.merge(src, on="opponent_team_id", how="left")

    # Venue inverted: the player at home means the opponent is away.
    at_home = out["is_home_next_gw"].astype(float) == 1.0
    out["opp_venue_ga_l5"] = np.where(at_home, out["_away_ga"], out["_home_ga"])

    known = out["opp_gf_l5"].notna().mean() * 100
    logger.info("Opponent strength resolved for %.1f%% of players", known)
    return out.reindex(columns=cols)


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

def run_inference(target_gw: int, provisional: bool = False) -> pd.DataFrame:
    """
    provisional=True marks predictions generated with no retrain (the season-
    boundary carried-over-model fallback in ml-pipeline.scheduler.ts). Tagged
    with a `provisional_` model_version prefix — same pattern as `backtest_`
    — so the scheduler's "already has predictions" guard doesn't treat a
    stopgap run as final and skip the real retrain once data is available.
    """
    logger.info("Starting inference for GW%d%s", target_gw, " (provisional)" if provisional else "")
    model_version = f"provisional_{MODEL_VERSION}" if provisional else MODEL_VERSION

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

    team_stats = read_sql(TEAM_RECENT_STATS_QUERY, {"from_gw": from_gw_history})

    # Top the rolling windows up from last season while this one is still short.
    # Training rolls each player's history ordered across the season boundary, so
    # a GW2 row there sees last season's closing matches; reading only live rows
    # here would hand the model a one-match window instead of five. Blending until
    # the live window is full keeps the two sides describing the same thing.
    #
    # Season AGGREGATES are deliberately excluded: those reset every season, both
    # in the table inference reads and (since the season_scope fix) in training.
    live_gws = 0 if recent_stats.empty else int(recent_stats["gameweek"].nunique())
    live_team_gws = 0 if team_stats.empty else int(team_stats["gameweek"].nunique())

    archive = pd.DataFrame()
    if live_gws < ROLLING_WINDOW or live_team_gws < ROLLING_WINDOW:
        archive = load_archived_history()

    if not archive.empty and live_gws < ROLLING_WINDOW:
        prior = archive.rename(columns={"total_points": "gw_points"})[
            ["player_id", "gameweek", "gw_points", "minutes",
             "influence", "creativity", "threat", "ict_index"]
        ].copy()
        # Shift prior-season rounds below every current-season one so the sort
        # that feeds tail(n) orders them correctly across the boundary.
        prior["gameweek"] = prior["gameweek"] + PRIOR_SEASON_OFFSET
        recent_stats = (pd.concat([prior, recent_stats], ignore_index=True)
                        .sort_values(["player_id", "gameweek"]))
        logger.info("Rolling windows topped up from last season "
                    "(%d live gameweeks, %d archived rows)", live_gws, len(prior))

    if not archive.empty and live_team_gws < ROLLING_WINDOW:
        prior_team = team_stats_from_archive(archive)
        if not prior_team.empty:
            prior_team = prior_team.copy()
            prior_team["gameweek"] = prior_team["gameweek"] + PRIOR_SEASON_OFFSET
            team_stats = pd.concat([prior_team, team_stats], ignore_index=True)
            logger.info("Team form topped up from last season (%d live gameweeks)",
                        live_team_gws)

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
        "player_id", "team_id", "form", "chance_of_playing",
        "position", "now_cost", "selected_by_percent",
    ]].copy()
    features = features.merge(rolling_feats, on="player_id", how="left")
    features = features.merge(fixture_feats,  on="player_id", how="left")
    features = features.merge(season_feats,   on="player_id", how="left")

    # Own-team form, joined by club. Must come after fixture_feats — the venue
    # split is chosen by the venue of the fixture being predicted.
    team_feats = build_team_form_features(team_stats)
    if team_feats.empty:
        for c in ["team_gf_l5", "team_ga_l5", "team_cs_rate_l5", "team_gd_l5",
                  "team_venue_gf_l5", "team_venue_ga_l5"]:
            features[c] = 0.0
    else:
        features = features.merge(team_feats, on="team_id", how="left")
        at_home = features["is_home_next_gw"].astype(float) == 1.0
        features["team_venue_gf_l5"] = np.where(at_home, features["_home_gf"], features["_away_gf"])
        features["team_venue_ga_l5"] = np.where(at_home, features["_home_ga"], features["_away_ga"])
        features = features.drop(columns=["_home_gf", "_home_ga", "_away_gf", "_away_ga"])

    # Opponent strength. Computed whenever the fixture is known — which at
    # inference is always — so the path stays exercised even while these columns
    # are not yet in FEATURE_COLS (see constants.OPPONENT_FEATURE_COLS).
    next_opp = read_sql(NEXT_OPPONENT_QUERY, {"gw": target_gw})
    opp_feats = build_opponent_strength_features(team_feats, next_opp)
    if opp_feats.empty:
        for c in OPPONENT_FEATURE_COLS:
            features[c] = 0.0
    else:
        features = features.merge(opp_feats, on="player_id", how="left")
        features[OPPONENT_FEATURE_COLS] = features[OPPONENT_FEATURE_COLS].fillna(0.0)

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
    # The points model is conditional: points GIVEN an appearance.
    pred_pts_if_starts = np.clip(points_model.predict(X), 0, None)

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

    # Reassemble the unconditional expectation. predicted_pts_gw1 keeps its
    # original meaning — expected points for the gameweek, appearance risk
    # included — so every existing consumer stays correct, while the conditional
    # figure is published alongside it for display and for the squad optimiser.
    pred_pts_gw1 = prob_playing * pred_pts_if_starts

    logger.info(
        "Inference complete — mean xPts (expected): %.2f | mean xPts if starts: %.2f "
        "| mean prob_playing: %.2f",
        pred_pts_gw1.mean(), pred_pts_if_starts.mean(), prob_playing.mean(),
    )

    # Assemble output
    now  = datetime.now(timezone.utc).isoformat()
    rows = []

    for i in range(len(features)):
        row     = features.iloc[i]
        pid     = int(row["player_id"])
        pts_gw1 = round(float(pred_pts_gw1[i]), 2)
        pts_if_starts = round(float(pred_pts_if_starts[i]), 2)
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
            "predicted_pts_if_starts": pts_if_starts,
            "predicted_pts_gw3": pts_gw3,
            "predicted_pts_gw5": pts_gw5,
            "prob_playing":      prob_pl,
            "prob_60_plus_mins": prob_60,
            "predicted_minutes": predicted_minutes,
            "model_version":     model_version,
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