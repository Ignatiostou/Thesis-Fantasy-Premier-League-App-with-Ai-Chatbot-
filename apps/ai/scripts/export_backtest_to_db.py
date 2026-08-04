"""
Stores the walk-forward backtest predictions (GW3–GW38) in the
player_predictions table so the app can show historical
predicted-vs-actual for every gameweek of the season.

Rows are written under model_version "backtest_walkforward_v1" with an
early-morning generated_at timestamp. The chatbot picks, per gameweek, the
model version with the NEWEST generated_at — so the live pipeline's rows
(generated later) always win and chatbot behaviour is unchanged.

    python scripts/export_backtest_to_db.py            # upsert
    python scripts/export_backtest_to_db.py --dry-run
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import numpy as np
import pandas as pd
from sqlalchemy import text

from config import settings
from db_writer import get_writer_engine, upsert_dataframe, dispose
from logging_utils import get_logger

logger = get_logger("export_backtest")

MODEL_VERSION = "backtest_walkforward_v1"
# Before the live pipeline's timestamps for the same day, so per-GW
# "latest model version" resolution in the API still prefers live rows.
GENERATED_AT = "2026-07-13T00:00:00+00:00"

PARQUET = settings.reports_dir / "thesis" / "walkforward_predictions.parquet"


def derive_confidence(prob_playing: float, predicted_minutes: float) -> str:
    """Same thresholds as inference/predict_next_gw.derive_confidence,
    minus the history-count criterion (not tracked in the backtest)."""
    if prob_playing < 0.5:
        return "LOW"
    if prob_playing < 0.75 or predicted_minutes < 20:
        return "MEDIUM"
    return "HIGH"


def build_rows(preds: pd.DataFrame) -> pd.DataFrame:
    if "player_id" not in preds.columns:
        raise RuntimeError(
            "walkforward_predictions.parquet has no player_id column — "
            "re-run scripts/generate_thesis_plots.py first."
        )

    pts = preds["predicted"].astype(float).clip(lower=0)
    mins = preds["minutes_predicted"].astype(float).clip(0, 90)
    prob = preds["played_prob"].astype(float).fillna(0.0).clip(0, 1)

    # Same shapes as the live pipeline (neutral-FDR multi-GW projection and
    # the minutes→prob_60 mapping from inference/predict_next_gw.py).
    prob60 = np.where(
        mins >= 60,
        np.clip((mins - 60) / 30 * 0.5 + 0.5, 0.5, 1.0),
        np.clip(mins / 60 * 0.5, 0.0, 0.5),
    )

    out = pd.DataFrame({
        "player_id": preds["player_id"].astype(int),
        "gameweek": preds["target_gw"].astype(int),
        "predicted_pts_gw1": pts.round(4),
        "predicted_pts_gw3": (pts * 3).round(4),
        "predicted_pts_gw5": (pts * 5 * 0.95).round(4),
        "prob_playing": prob.round(4),
        "prob_60_plus_mins": np.round(prob60, 4),
        "predicted_minutes": mins.round(2),
        "model_version": MODEL_VERSION,
        "confidence": [derive_confidence(p, m) for p, m in zip(prob, mins)],
        "generated_at": GENERATED_AT,
    })

    # One row per (player, gameweek) — defensive against duplicates
    out = out.drop_duplicates(subset=["player_id", "gameweek"], keep="last")
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description="Upsert walk-forward backtest predictions into the DB")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not PARQUET.exists():
        raise FileNotFoundError(f"{PARQUET} not found — run scripts/generate_thesis_plots.py first.")

    preds = pd.read_parquet(PARQUET)
    rows = build_rows(preds)
    logger.info("Prepared %d backtest rows | GW%d–GW%d | %d players",
                len(rows), rows["gameweek"].min(), rows["gameweek"].max(),
                rows["player_id"].nunique())

    if args.dry_run:
        logger.info("DRY RUN — sample:\n%s", rows.head(5).to_string(index=False))
        return

    try:
        engine = get_writer_engine()
        with engine.begin() as conn:
            deleted = conn.execute(
                text("DELETE FROM player_predictions WHERE model_version = :mv"),
                {"mv": MODEL_VERSION},
            ).rowcount
        if deleted:
            logger.info("Removed %d previous backtest rows", deleted)

        count = upsert_dataframe(
            rows,
            table_name="player_predictions",
            conflict_columns=["player_id", "gameweek", "model_version"],
        )
        logger.info("Stored %d backtest predictions in player_predictions.", count)
    finally:
        dispose()


if __name__ == "__main__":
    main()
