"""
Phase 1 — Historical backfill.

Downloads the full per-gameweek history of every player for the season the
FPL API is currently serving (one element-summary call per player), stores it
in player_gameweek_stats, archives a season snapshot to parquet, then runs
the full ML pipeline: feature engineering → training → next-GW predictions.

Run once during initial setup, after adding an older season, or after
significant feature/algorithm changes:

    python scripts/backfill_season.py --season 2025-26

Prerequisites: fpl_teams / fpl_events / fpl_players / fpl_fixtures must be
populated. If they are not, run the API sync first:

    npm run fpl:refresh --workspace @apps/api
"""

import argparse
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from config import settings
from constants import CURRENT_SEASON
from db import read_sql, dispose
from fpl_client import get_bootstrap, get_element_summary
from data.stats_ingest import rows_from_history, upsert_stat_rows, gw_row_counts
from logging_utils import get_logger

logger = get_logger("backfill_season")

FETCH_WORKERS = 6          # parallel element-summary requests
POLITENESS_DELAY_S = 0.05  # small delay per request to be kind to the FPL API


def check_prerequisites() -> None:
    counts = read_sql("""
        SELECT
            (SELECT COUNT(*) FROM fpl_teams)    AS teams,
            (SELECT COUNT(*) FROM fpl_events)   AS events,
            (SELECT COUNT(*) FROM fpl_players)  AS players,
            (SELECT COUNT(*) FROM fpl_fixtures) AS fixtures
    """).iloc[0]

    logger.info("DB reference data: %d teams | %d events | %d players | %d fixtures",
                counts["teams"], counts["events"], counts["players"], counts["fixtures"])

    if counts["teams"] == 0 or counts["events"] == 0 or counts["players"] == 0:
        raise RuntimeError(
            "Reference tables are empty. Run the FPL sync first:\n"
            "    npm run fpl:refresh --workspace @apps/api"
        )


def fetch_all_player_histories() -> list[dict]:
    """One element-summary request per player; returns upsert-ready stat rows."""
    bootstrap = get_bootstrap()
    player_ids = [el["id"] for el in bootstrap["elements"]]
    logger.info("Fetching per-GW history for %d players from the FPL API "
                "(%d parallel workers)...", len(player_ids), FETCH_WORKERS)

    all_rows: list[dict] = []
    failed: list[int] = []
    done = 0

    def fetch_one(pid: int) -> list[dict]:
        time.sleep(POLITENESS_DELAY_S)
        summary = get_element_summary(pid)
        return rows_from_history(pid, summary.get("history") or [])

    with ThreadPoolExecutor(max_workers=FETCH_WORKERS) as pool:
        futures = {pool.submit(fetch_one, pid): pid for pid in player_ids}
        for fut in as_completed(futures):
            pid = futures[fut]
            try:
                all_rows.extend(fut.result())
            except Exception as exc:  # noqa: BLE001
                failed.append(pid)
                logger.error("Failed to fetch history for player %d: %s", pid, exc)
            done += 1
            if done % 100 == 0:
                logger.info("  ...%d/%d players fetched", done, len(player_ids))

    if failed:
        logger.warning("History fetch failed for %d players: %s", len(failed), failed[:20])
    if not all_rows:
        raise RuntimeError(
            "FPL API returned no history rows. The game may have been reset for "
            "the new season — in that case the previous season's data must come "
            "from your own database (skip with --skip-fetch)."
        )

    logger.info("Fetched %d player-gameweek rows total", len(all_rows))
    return all_rows


def archive_season_snapshot(season: str) -> None:
    """Saves the raw season history to parquet so it survives a DB reset
    when the new season starts."""
    from data.extract_player_gw_history import extract

    df = extract()
    if df.empty:
        logger.warning("Nothing to archive — extraction returned no rows.")
        return

    df["season"] = season
    archive_dir = settings.datasets_dir / "history"
    archive_dir.mkdir(parents=True, exist_ok=True)
    out = archive_dir / f"player_gw_history_{season}.parquet"
    df.to_parquet(out, index=False)
    logger.info("Archived season snapshot: %s (%d rows)", out, len(df))


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill a full season of player GW stats and train the model")
    parser.add_argument("--season", type=str, default=CURRENT_SEASON,
                        help="Season label for the archive snapshot (e.g. 2025-26)")
    parser.add_argument("--skip-fetch", action="store_true",
                        help="Skip the FPL API download; train on what is already in the DB")
    parser.add_argument("--skip-pipeline", action="store_true",
                        help="Only ingest + archive data; do not train or predict")
    args = parser.parse_args()

    logger.info("═══ Historical backfill — season %s ═══", args.season)

    try:
        check_prerequisites()

        if args.skip_fetch:
            logger.info("--skip-fetch: using player_gameweek_stats already in the DB")
        else:
            rows = fetch_all_player_histories()
            upsert_stat_rows(rows)

        counts = gw_row_counts()
        if counts.empty:
            raise RuntimeError("player_gameweek_stats is still empty after backfill.")
        logger.info("player_gameweek_stats coverage: GW%d–GW%d, %d total rows",
                    counts["gameweek"].min(), counts["gameweek"].max(),
                    int(counts["players"].sum()))

        archive_season_snapshot(args.season)
    finally:
        dispose()

    if args.skip_pipeline:
        logger.info("--skip-pipeline: done (data only).")
        return

    logger.info("Starting full ML pipeline (train + predict)...")
    from pipeline import run as run_pipeline
    run_pipeline()

    logger.info("═══ Backfill complete ═══")


if __name__ == "__main__":
    main()
