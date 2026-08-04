"""
Phase 2 — Incremental gameweek update.

Downloads the finalized stats of one completed gameweek from the FPL API
(event/{gw}/live) and upserts them into player_gameweek_stats. Optionally
runs the full pipeline afterwards (retrain + predict next GW).

    python scripts/update_gameweek.py --gameweek 24
    python scripts/update_gameweek.py --gameweek 24 --run-pipeline

Normally invoked automatically by the API's ML scheduler when a new
gameweek is detected as finished and data-checked.
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from db import read_sql, dispose
from fpl_client import get_event_live
from data.stats_ingest import rows_from_event_live, upsert_stat_rows
from logging_utils import get_logger

logger = get_logger("update_gameweek")


def detect_latest_finished_gw() -> int:
    df = read_sql("""
        SELECT MAX(id) AS gw FROM fpl_events
        WHERE finished = TRUE
          AND COALESCE((raw->>'data_checked')::boolean, FALSE) = TRUE
    """)
    if df.empty or df.iloc[0]["gw"] is None:
        raise RuntimeError("No finished + data_checked gameweek found in fpl_events.")
    return int(df.iloc[0]["gw"])


def sync_gameweek(gw: int) -> int:
    logger.info("Downloading finalized stats for GW%d from the FPL API...", gw)
    live = get_event_live(gw)
    elements = live.get("elements") or []
    if not elements:
        raise RuntimeError(f"FPL event/{gw}/live returned no elements.")

    rows = rows_from_event_live(gw, elements)
    return upsert_stat_rows(rows)


def main() -> None:
    parser = argparse.ArgumentParser(description="Import one completed gameweek's stats")
    parser.add_argument("--gameweek", type=int, default=None,
                        help="Gameweek to import (default: latest finished + data_checked)")
    parser.add_argument("--run-pipeline", action="store_true",
                        help="Run the full ML pipeline (retrain + predict) after import")
    args = parser.parse_args()

    try:
        gw = args.gameweek if args.gameweek is not None else detect_latest_finished_gw()
        count = sync_gameweek(gw)
        logger.info("GW%d import complete — %d player rows upserted.", gw, count)
    finally:
        dispose()

    if args.run_pipeline:
        from pipeline import run as run_pipeline
        run_pipeline(completed_gameweek=gw)


if __name__ == "__main__":
    main()
