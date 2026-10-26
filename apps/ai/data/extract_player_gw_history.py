import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

import pandas as pd
from db import read_sql, dispose
from config import settings
from constants import CURRENT_SEASON, season_round_key
from logging_utils import get_logger

logger = get_logger(__name__)


EXTRACT_QUERY = """
-- DISTINCT ON keeps exactly one row per player-gameweek. In a double gameweek
-- the fixtures join matches both fixtures, but player_gameweek_stats already
-- holds the SUMMED stats for the round — so without this the whole row is
-- emitted twice and those players are double-counted in training. The earliest
-- fixture (lowest id) supplies the fdr/venue context.
SELECT DISTINCT ON (p.id, s.gameweek)
    -- Player identity.
    -- teamId recorded on the stat row wins over the player's CURRENT club:
    -- the latter is only correct until a transfer or a season rollover, and
    -- using it retroactively scrambles team attribution.
    p.id                          AS player_id,
    p."webName"                   AS web_name,
    COALESCE(s."teamId", p."teamId") AS team_id,
    t."shortName"                 AS team_short_name,
    s."opponentTeamId"            AS opponent_team_id,
    s."fixtureCount"              AS fixture_count,
    p.position,
    p."nowCost"                   AS now_cost,
    p.status,
    p."selectedByPercent"         AS selected_by_percent,
    p.form,

    -- Gameweek stats (from PlayerGameweekStat)
    s.gameweek,
    s.minutes,
    s."totalPoints"               AS total_points,
    s."goalsScored"               AS goals_scored,
    s.assists,
    s."cleanSheets"               AS clean_sheets,
    s."goalsConceded"             AS goals_conceded,
    s."ownGoals"                  AS own_goals,
    s."penaltiesSaved"            AS penalties_saved,
    s."penaltiesMissed"           AS penalties_missed,
    s."yellowCards"               AS yellow_cards,
    s."redCards"                  AS red_cards,
    s.saves,
    s.bonus,
    s.bps,
    CAST(s.influence  AS FLOAT)   AS influence,
    CAST(s.creativity AS FLOAT)   AS creativity,
    CAST(s.threat     AS FLOAT)   AS threat,
    CAST(s."ictIndex" AS FLOAT)   AS ict_index,

    -- Fixture context for this GW. The stored wasHome wins; the fixtures join
    -- is only a fallback for rows written before that column existed, and it
    -- goes silently wrong once fpl_fixtures rolls over to the next season.
    CASE
        WHEN f."teamHId" = COALESCE(s."teamId", p."teamId") THEN f."teamHDifficulty"
        ELSE f."teamADifficulty"
    END                           AS fixture_fdr,
    COALESCE(
        s."wasHome",
        CASE
            WHEN f."teamHId" = COALESCE(s."teamId", p."teamId") THEN TRUE
            ELSE FALSE
        END
    )                             AS was_home

FROM player_gameweek_stats s
JOIN fpl_players p
    ON s."playerId" = p.id
LEFT JOIN fpl_teams t
    ON t.id = COALESCE(s."teamId", p."teamId")
LEFT JOIN fpl_fixtures f
    ON f.event = s.gameweek
    AND (f."teamHId" = COALESCE(s."teamId", p."teamId")
         OR f."teamAId" = COALESCE(s."teamId", p."teamId"))
    AND f.finished = TRUE

ORDER BY p.id, s.gameweek, f.id
"""


def extract() -> pd.DataFrame:
    logger.info("Extracting player gameweek history from database...")
    df = read_sql(EXTRACT_QUERY)

    if df.empty:
        logger.warning("No data returned — check that player_gameweek_stats has rows.")
        return df

    # ── Basic cleaning ────────────────────────────────────────────────────────
    # Drop rows with no points data (should not happen but defensive)
    before = len(df)
    df = df.dropna(subset=["player_id", "gameweek", "total_points"])
    after  = len(df)
    if before != after:
        logger.warning(f"Dropped {before - after} rows with null key fields.")

    # Cast types
    df["gameweek"]   = df["gameweek"].astype(int)
    df["player_id"]  = df["player_id"].astype(int)
    df["now_cost"]   = df["now_cost"].astype(int)
    df["clean_sheets"] = df["clean_sheets"].astype(bool)
    df["was_home"]   = df["was_home"].fillna(False).astype(bool)

    # Fill nulls in float stats with 0 (missing stat = 0 for ML purposes)
    float_cols = ["influence", "creativity", "threat", "ict_index",
                  "selected_by_percent", "form"]
    df[float_cols] = df[float_cols].fillna(0.0)

    # fixture_fdr: fill with neutral FDR if fixture data missing
    df["fixture_fdr"] = df["fixture_fdr"].fillna(3).astype(int)

    logger.info(
        f"Extracted {len(df):,} rows | "
        f"{df['player_id'].nunique()} players | "
        f"GWs {df['gameweek'].min()}-{df['gameweek'].max()}"
    )

    return df


def extract_with_history() -> pd.DataFrame:
    """
    Live current-season rows + every archived prior season (written by
    scripts/rollover_season.py to artifacts/datasets/history/), combined into
    one chronologically-ordered dataset for training.

    Each archive already has correct fixture_fdr/was_home baked in from when
    IT was extracted live (before the next season's fixtures overwrote
    fpl_fixtures) — so no re-joining against fixtures is needed for old
    seasons, which sidesteps fpl_fixtures/fpl_events having no season column
    of their own (they're "current season only" reference data by design).

    Used by the training pipeline (pipeline.py). rollover_season.py itself
    keeps calling the plain extract() above — unchanged — since archiving must
    capture only the season being rolled over, not an already-merged view.
    """
    live = extract()
    if not live.empty:
        live = live.copy()
        live["season"] = CURRENT_SEASON

    history_dir = settings.datasets_dir / "history"
    archives: list[pd.DataFrame] = []
    if history_dir.exists():
        for path in sorted(history_dir.glob("player_gw_history_*.parquet")):
            archived = pd.read_parquet(path)
            if "season" not in archived.columns:
                logger.warning(f"{path.name} has no 'season' column — skipping")
                continue
            if (archived["season"] == CURRENT_SEASON).any():
                logger.warning(
                    f"{path.name} is tagged with the current season ({CURRENT_SEASON}) — "
                    f"skipping to avoid double-counting live rows. If this season has "
                    f"actually rolled over, bump CURRENT_SEASON in constants.py."
                )
                continue
            archives.append(archived)

    frames = archives + ([live] if not live.empty else [])
    if not frames:
        logger.warning("No live or archived data found.")
        return pd.DataFrame()

    combined = pd.concat(frames, ignore_index=True)
    combined["_round_key"] = season_round_key(combined)
    combined = (
        combined.sort_values(["player_id", "_round_key"])
        .drop(columns=["_round_key"])
        .reset_index(drop=True)
    )

    # Archives written before the extract deduplicated its fixtures join carry
    # one row per fixture on double gameweeks, even though the stats on each are
    # already the summed round total. Keeping them would count those players
    # twice in training, so collapse to one row per player per round.
    dupe_key = (["season", "player_id", "gameweek"] if "season" in combined.columns
                else ["player_id", "gameweek"])
    dupes = int(combined.duplicated(dupe_key).sum())
    if dupes:
        logger.warning(
            "Dropping %d duplicate player-gameweek rows (double gameweeks in a "
            "pre-fix archive); keeping the first fixture of each round.", dupes
        )
        combined = combined.drop_duplicates(dupe_key, keep="first").reset_index(drop=True)

    logger.info(
        f"extract_with_history: {len(combined):,} rows | "
        f"{combined['player_id'].nunique()} players | "
        f"seasons: {sorted(combined['season'].unique())}"
    )
    return combined


def save(df: pd.DataFrame) -> Path:
    settings.ensure_artifact_dirs()
    out_path = settings.datasets_dir / "player_gw_history.parquet"
    df.to_parquet(out_path, index=False)
    logger.info(f"Saved to {out_path}  ({out_path.stat().st_size / 1024:.1f} KB)")
    return out_path


def main() -> None:
    try:
        df = extract()
        if df.empty:
            logger.error("Extraction returned empty DataFrame. Exiting.")
            sys.exit(1)
        save(df)
        logger.info("Extraction complete.")
    finally:
        dispose()


if __name__ == "__main__":
    main()