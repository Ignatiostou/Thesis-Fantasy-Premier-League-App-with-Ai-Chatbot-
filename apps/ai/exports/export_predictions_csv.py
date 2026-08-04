import sys
import argparse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pandas as pd

from config import settings
from constants import POSITION_LABEL
from db import read_sql, dispose
from models.model_utils import write_json
from logging_utils import get_logger

logger = get_logger(__name__)


PLAYER_ENRICHMENT_QUERY = """
SELECT
    p.id                AS player_id,
    p."webName"         AS web_name,
    t."shortName"       AS team,
    p.position,
    p."nowCost"         AS now_cost
FROM fpl_players p
JOIN fpl_teams t ON p."teamId" = t.id
"""


def find_latest_predictions(gameweek: int | None) -> Path:
    """Finds the prediction parquet for the given GW, or the most recent one."""
    datasets_dir = settings.datasets_dir

    if gameweek:
        path = datasets_dir / f"predictions_gw{gameweek}.parquet"
        if not path.exists():
            raise FileNotFoundError(
                f"No predictions found for GW{gameweek} at {path}. "
                f"Run inference/predict_next_gw.py first."
            )
        return path

    # Find most recent predictions file
    files = sorted(datasets_dir.glob("predictions_gw*.parquet"))
    if not files:
        raise FileNotFoundError(
            f"No prediction files found in {datasets_dir}. "
            f"Run inference/predict_next_gw.py first."
        )
    latest = files[-1]
    logger.info(f"Auto-selected latest predictions: {latest.name}")
    return latest


def fmt_cost(tenths: float) -> str:
    return f"£{tenths / 10:.1f}m"


def main() -> None:
    parser = argparse.ArgumentParser(description="Export FPL predictions to CSV")
    parser.add_argument(
        "--gameweek", type=int, default=None,
        help="Gameweek to export (default: most recent)"
    )
    args = parser.parse_args()

    settings.ensure_artifact_dirs()

    # ── Load predictions ──────────────────────────────────────────────────────
    pred_path   = find_latest_predictions(args.gameweek)
    predictions = pd.read_parquet(pred_path)
    target_gw   = int(predictions["gameweek"].iloc[0])

    logger.info(f"Loaded {len(predictions)} predictions for GW{target_gw}")

    # ── Enrich with player info ───────────────────────────────────────────────
    try:
        players = read_sql(PLAYER_ENRICHMENT_QUERY)
        predictions = predictions.merge(players, on="player_id", how="left")
        predictions["position_label"] = predictions["position"].map(POSITION_LABEL).fillna("UNK")
        predictions["price"]          = predictions["now_cost"].apply(fmt_cost)
    except Exception as e:
        logger.warning(f"Could not enrich with player names: {e}")
        predictions["web_name"]       = predictions["player_id"].astype(str)
        predictions["team"]           = "UNK"
        predictions["position_label"] = "UNK"
        predictions["price"]          = "UNK"

    # ── Build export DataFrame ────────────────────────────────────────────────
    # Build column list dynamically — predicted_minutes is optional
    base_cols = [
        "player_id", "web_name", "team", "position_label", "price",
        "predicted_pts_gw1", "predicted_pts_gw3", "predicted_pts_gw5",
        "prob_playing", "prob_60_plus_mins",
        "confidence", "model_version", "generated_at",
    ]
    optional_cols = ["predicted_minutes"]
    export_cols = base_cols + [c for c in optional_cols if c in predictions.columns]
    export = predictions[export_cols].copy()

    # Human-readable probability columns (0-100%)
    export["prob_playing_pct"]    = (export["prob_playing"]    * 100).round(1)
    export["prob_60mins_pct"]     = (export["prob_60_plus_mins"] * 100).round(1)

    # Sort: HIGH confidence first, then by predicted points
    confidence_order = {"HIGH": 0, "MEDIUM": 1, "LOW": 2}
    export["_conf_order"] = export["confidence"].map(confidence_order).fillna(3)
    export = export.sort_values(
        ["_conf_order", "predicted_pts_gw1"],
        ascending=[True, False]
    ).drop(columns=["_conf_order"])

    # ── Save CSV ──────────────────────────────────────────────────────────────
    csv_path = settings.reports_dir / f"predictions_gw{target_gw}.csv"
    export.to_csv(csv_path, index=False)
    logger.info(f"CSV saved → {csv_path}  ({len(export)} rows)")

    # ── Save summary JSON (top 20 per position) ───────────────────────────────
    summary = {}
    for pos_code, pos_label in POSITION_LABEL.items():
        pos_df = export[export["position_label"] == pos_label].head(5)
        summary[pos_label] = pos_df[[
            "web_name", "team", "predicted_pts_gw1",
            "prob_playing_pct", "confidence"
        ]].to_dict(orient="records")

    summary_path = settings.reports_dir / f"predictions_summary_gw{target_gw}.json"
    write_json(summary_path, {
        "gameweek":    target_gw,
        "total_rows":  len(export),
        "by_position": summary,
        "top_10_overall": export.head(10)[[
            "web_name", "team", "position_label",
            "predicted_pts_gw1", "prob_playing_pct", "confidence"
        ]].to_dict(orient="records"),
    })
    logger.info(f"Summary JSON saved → {summary_path}")

    # ── Print top 10 to console ───────────────────────────────────────────────
    logger.info("\nTop 10 predicted scorers for GW%d:", target_gw)
    top10_cols = ["web_name", "team", "position_label", "price",
                  "predicted_pts_gw1", "prob_playing_pct", "confidence"]
    available_cols = [c for c in top10_cols if c in export.columns]
    logger.info("\n%s", export[available_cols].head(10).to_string(index=False))


if __name__ == "__main__":
    try:
        main()
    finally:
        dispose()