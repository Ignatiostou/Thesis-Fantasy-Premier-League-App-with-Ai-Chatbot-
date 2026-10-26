"""
Season rollover — run ONCE before the new season starts (after FPL resets
the game in July, before GW1 of the new season is played).

The schema keys player_gameweek_stats and player_predictions by gameweek
number without a season column, so last season's GW1 row would collide with
the new season's GW1. This script:

  1. Archives last season's stats + predictions to parquet
     (artifacts/datasets/history/) — the trained model itself is untouched,
     so the chatbot keeps using the model learned from last season.
  2. Clears player_gameweek_stats and player_predictions so the new season
     starts from a clean slate.
  3. Clears gameweek_scoring_status (Node's scoring scheduler state) — same
     collision risk: if last season's GW1 row is still marked isFinal=true,
     the scheduler treats the new season's GW1 as already-finalized and
     never scores it. This table is pure operational state, not analytical
     data, so it's cleared without archiving.

TIMING IS CRITICAL — run this BEFORE fpl_fixtures is refreshed for the new
season. The stats extract derives fixture difficulty and home/away by joining
fpl_fixtures on `finished = TRUE`; once that table rolls over, the join matches
nothing and every archived row silently gets fdr=3 / was_home=False. Since the
DB tables are cleared straight afterwards, the archive is the only copy and the
loss is permanent. fixture_context_intact() now refuses to archive in that state
(this is exactly how the 2025-26 archive was lost on 2026-08-10 and had to be
rebuilt from a pre-rollover extract).

IMPORTANT — also restart the API process after running this with --apply.
The scoring and ML schedulers each keep in-memory caches (finalScoredGws,
_seasonCompleteLogged) that aren't season-aware and won't be reset by a
DB change alone.

    python scripts/rollover_season.py --season 2025-26          # dry run
    python scripts/rollover_season.py --season 2025-26 --apply  # actually clear
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pandas as pd
from sqlalchemy import text

from config import settings
from db import read_sql, dispose
from db_writer import get_writer_engine, dispose as dispose_writer
from logging_utils import get_logger

logger = get_logger("rollover_season")


def fixture_context_intact(stats: pd.DataFrame) -> tuple[bool, str]:
    """Guard against archiving a snapshot that has already lost its fixtures.

    extract() derives fixture_fdr/was_home by joining fpl_fixtures on
    `finished = TRUE`. Once that table has been refreshed for the new season
    nothing matches, the CASE expressions fall through to their defaults, and
    every row silently gets fdr=3 / was_home=False. Because the DB tables are
    cleared immediately afterwards, the archive is the only surviving copy —
    so a degraded archive loses fixture difficulty and home/away permanently.

    Real data always spans several FDR values and both venues.
    """
    if stats.empty:
        return False, "extract returned no rows"
    if stats["fixture_fdr"].nunique(dropna=True) <= 1:
        return False, (f"fixture_fdr has no variation "
                       f"(values: {stats['fixture_fdr'].unique()[:5]}) — "
                       f"the fpl_fixtures join matched nothing")
    if stats["was_home"].nunique(dropna=True) <= 1:
        return False, (f"was_home has no variation "
                       f"(values: {stats['was_home'].unique()[:5]}) — "
                       f"the fpl_fixtures join matched nothing")
    return True, ""


def _jsonify(df: pd.DataFrame) -> pd.DataFrame:
    """Serialise jsonb columns so parquet can hold them."""
    for col in df.columns:
        if df[col].dtype == object and df[col].map(lambda v: isinstance(v, (dict, list))).any():
            df[col] = df[col].map(lambda v: json.dumps(v) if isinstance(v, (dict, list)) else v)
    return df


def archive(season: str, force: bool = False) -> None:
    archive_dir = settings.datasets_dir / "history"
    archive_dir.mkdir(parents=True, exist_ok=True)

    from data.extract_player_gw_history import extract
    stats = extract()

    ok, why = fixture_context_intact(stats)
    if not ok:
        msg = (f"Refusing to archive {season}: {why}. "
               f"Run the rollover BEFORE fpl_fixtures is refreshed for the new "
               f"season, or restore the fixtures first. Use --force to override "
               f"(the archive will permanently lack fixture difficulty and venue).")
        if not force:
            raise SystemExit(msg)
        logger.warning("--force given. %s", msg)

    if not stats.empty:
        stats["season"] = season
        out = archive_dir / f"player_gw_history_{season}.parquet"
        stats.to_parquet(out, index=False)
        logger.info("Archived %d stat rows → %s", len(stats), out)

    preds = read_sql("SELECT * FROM player_predictions")
    if not preds.empty:
        preds["season"] = season
        out = archive_dir / f"player_predictions_{season}.parquet"
        preds.to_parquet(out, index=False)
        logger.info("Archived %d prediction rows → %s", len(preds), out)

    # Reference tables are "current season only" by design and get overwritten
    # on the next sync. Without a snapshot, team identity and fixture context
    # for the archived season cannot be reconstructed afterwards — team IDs are
    # renumbered whenever the league composition changes.
    for table in ("fpl_fixtures", "fpl_teams", "fpl_events"):
        df = read_sql(f"SELECT * FROM {table}")
        if df.empty:
            logger.warning("%s is empty — nothing archived for it.", table)
            continue
        df["season"] = season
        out = archive_dir / f"{table}_{season}.parquet"
        _jsonify(df).to_parquet(out, index=False)
        logger.info("Archived %d %s rows → %s", len(df), table, out)


def clear_tables() -> None:
    engine = get_writer_engine()
    with engine.begin() as conn:
        n1 = conn.execute(text("DELETE FROM player_predictions")).rowcount
        n2 = conn.execute(text("DELETE FROM player_gameweek_stats")).rowcount
        n3 = conn.execute(text("DELETE FROM gameweek_scoring_status")).rowcount
    logger.info(
        "Cleared %d predictions, %d gameweek stat rows, %d scoring status rows.",
        n1, n2, n3,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Archive last season and reset GW tables")
    parser.add_argument("--season", type=str, required=True,
                        help="Label of the season being archived, e.g. 2025-26")
    parser.add_argument("--apply", action="store_true",
                        help="Actually clear the tables (without this flag: archive only)")
    parser.add_argument("--force", action="store_true",
                        help="Archive even if the fixture context has already been lost "
                             "(fdr/venue will be missing from the archive forever)")
    args = parser.parse_args()

    try:
        archive(args.season, force=args.force)
        if args.apply:
            clear_tables()
            logger.info("Rollover complete. When the new season's first GW finishes, "
                        "the scheduler will retrain automatically.")
        else:
            logger.info("Dry run — archived only. Re-run with --apply to clear the tables.")
    finally:
        dispose()
        dispose_writer()


if __name__ == "__main__":
    main()
