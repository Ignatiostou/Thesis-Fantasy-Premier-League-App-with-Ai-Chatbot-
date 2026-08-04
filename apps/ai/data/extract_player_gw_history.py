import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

import pandas as pd
from db import read_sql, dispose
from config import settings
from logging_utils import get_logger

logger = get_logger(__name__)


EXTRACT_QUERY = """
SELECT
    -- Player identity
    p.id                          AS player_id,
    p."webName"                   AS web_name,
    p."teamId"                    AS team_id,
    t."shortName"                 AS team_short_name,
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

    -- Fixture context for this GW
    CASE
        WHEN f."teamHId" = p."teamId" THEN f."teamHDifficulty"
        ELSE f."teamADifficulty"
    END                           AS fixture_fdr,
    CASE
        WHEN f."teamHId" = p."teamId" THEN TRUE
        ELSE FALSE
    END                           AS was_home

FROM player_gameweek_stats s
JOIN fpl_players p
    ON s."playerId" = p.id
JOIN fpl_teams t
    ON p."teamId" = t.id
LEFT JOIN fpl_fixtures f
    ON f.event = s.gameweek
    AND (f."teamHId" = p."teamId" OR f."teamAId" = p."teamId")
    AND f.finished = TRUE

ORDER BY p.id, s.gameweek
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