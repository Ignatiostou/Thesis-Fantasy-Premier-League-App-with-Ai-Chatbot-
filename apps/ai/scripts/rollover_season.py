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

    python scripts/rollover_season.py --season 2025-26          # dry run
    python scripts/rollover_season.py --season 2025-26 --apply  # actually clear
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import text

from config import settings
from db import read_sql, dispose
from db_writer import get_writer_engine, dispose as dispose_writer
from logging_utils import get_logger

logger = get_logger("rollover_season")


def archive(season: str) -> None:
    archive_dir = settings.datasets_dir / "history"
    archive_dir.mkdir(parents=True, exist_ok=True)

    from data.extract_player_gw_history import extract
    stats = extract()
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


def clear_tables() -> None:
    engine = get_writer_engine()
    with engine.begin() as conn:
        n1 = conn.execute(text("DELETE FROM player_predictions")).rowcount
        n2 = conn.execute(text("DELETE FROM player_gameweek_stats")).rowcount
    logger.info("Cleared %d predictions and %d gameweek stat rows.", n1, n2)


def main() -> None:
    parser = argparse.ArgumentParser(description="Archive last season and reset GW tables")
    parser.add_argument("--season", type=str, required=True,
                        help="Label of the season being archived, e.g. 2025-26")
    parser.add_argument("--apply", action="store_true",
                        help="Actually clear the tables (without this flag: archive only)")
    args = parser.parse_args()

    try:
        archive(args.season)
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
