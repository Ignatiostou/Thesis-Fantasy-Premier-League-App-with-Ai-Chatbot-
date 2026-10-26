"""
Season-start evaluation figures for the live season (2026-27): actual vs
predicted for each gameweek that has both a stored forward prediction and a
now-known real result.

Unlike scripts/generate_thesis_plots.py — which *simulates* out-of-sample
folds by retraining on 2025-26 history — this reuses the genuine forward
predictions the pipeline already stored before each gameweek was played
(artifacts/datasets/predictions_gw{N}.parquet), joined against the real
outcome once it's in. No retraining happens here.

Same 3-figure-per-GW layout as generate_thesis_plots.py's per_gameweek
figures (points scatter / minutes scatter / played ROC), written to a
season-tagged folder so they never collide with the 2025-26 set.

Run:  python scripts/generate_season_plots.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pandas as pd
from sklearn.metrics import mean_absolute_error, roc_auc_score, roc_curve

from config import settings
from constants import CURRENT_SEASON, MIN_MINUTES_PLAYED
from logging_utils import get_logger

from generate_thesis_plots import new_fig, save, _scatter_gw, BLUE, AXIS, TEXT_2  # noqa: E402

logger = get_logger("season_plots")

OUT_BASE = settings.reports_dir / "thesis" / f"per_gameweek_{CURRENT_SEASON}"


def load_gw(gw: int) -> pd.DataFrame | None:
    pred_path = settings.datasets_dir / f"predictions_gw{gw}.parquet"
    if not pred_path.exists():
        logger.warning("No stored predictions for GW%d (%s) — skipping", gw, pred_path.name)
        return None

    preds = pd.read_parquet(pred_path)[
        ["player_id", "predicted_pts_gw1", "predicted_minutes", "prob_playing"]
    ].rename(columns={"predicted_pts_gw1": "predicted", "predicted_minutes": "minutes_predicted"})

    history = pd.read_parquet(settings.datasets_dir / "player_gw_history.parquet")
    actual = history[(history["season"] == CURRENT_SEASON) & (history["gameweek"] == gw)][
        ["player_id", "total_points", "minutes"]
    ].rename(columns={"total_points": "actual", "minutes": "minutes_actual"})

    if actual.empty:
        logger.warning("No real GW%d results in player_gw_history.parquet yet — skipping", gw)
        return None

    merged = preds.merge(actual, on="player_id", how="inner")
    merged["played_actual"] = merged["minutes_actual"] >= MIN_MINUTES_PLAYED
    merged["played_prob"] = merged["prob_playing"]
    logger.info("GW%d: %d players with both a stored prediction and a real result", gw, len(merged))
    return merged


def gw_figures(gw: int, grp: pd.DataFrame) -> None:
    dirs = {kind: OUT_BASE / kind for kind in ("points", "minutes", "played")}
    for d in dirs.values():
        d.mkdir(parents=True, exist_ok=True)

    # 1. Points — actual vs predicted scatter
    fig, ax = new_fig(5.4, 4.6)
    lim = max(12.0, float(grp["actual"].max()) + 1)
    _scatter_gw(ax, grp["actual"], grp["predicted"], lim, "Actual points", "Predicted points")
    mae = mean_absolute_error(grp["actual"], grp["predicted"])
    ax.set_title(f"GW{gw} {CURRENT_SEASON} — expected points (real outcome)", loc="left")
    ax.text(0, 1.02, f"n = {len(grp)} players | MAE {mae:.3f}",
            transform=ax.transAxes, fontsize=8.5, color=TEXT_2)
    save(fig, str((dirs["points"] / f"points_gw{gw:02d}.png").relative_to(settings.reports_dir / "thesis")))

    # 2. Minutes — actual vs predicted scatter
    fig, ax = new_fig(5.4, 4.6)
    _scatter_gw(ax, grp["minutes_actual"], grp["minutes_predicted"], 95, "Actual minutes", "Predicted minutes")
    mae_m = mean_absolute_error(grp["minutes_actual"], grp["minutes_predicted"])
    ax.set_title(f"GW{gw} {CURRENT_SEASON} — minutes played (real outcome)", loc="left")
    ax.text(0, 1.02, f"n = {len(grp)} players | MAE {mae_m:.1f} minutes",
            transform=ax.transAxes, fontsize=8.5, color=TEXT_2)
    save(fig, str((dirs["minutes"] / f"minutes_gw{gw:02d}.png").relative_to(settings.reports_dir / "thesis")))

    # 3. Played — ROC curve
    fig, ax = new_fig(5.4, 4.6)
    y_true = grp["played_actual"].to_numpy()
    y_prob = grp["played_prob"].to_numpy()
    if len(set(y_true)) > 1:
        fpr, tpr, _ = roc_curve(y_true, y_prob)
        auc = roc_auc_score(y_true, y_prob)
        ax.plot(fpr, tpr, color=BLUE, lw=2)
        ax.plot([0, 1], [0, 1], color=AXIS, lw=1, ls="--")
        ax.text(0.62, 0.08, f"AUC = {auc:.3f}", fontsize=10, fontweight="bold", color=BLUE)
        ax.text(0, 1.02, f"n = {len(grp)} players | played ≥30 min: {int(y_true.sum())}",
                transform=ax.transAxes, fontsize=8.5, color=TEXT_2)
    else:
        ax.text(0.5, 0.5, "insufficient data", ha="center", color=TEXT_2)
    ax.set_title(f"GW{gw} {CURRENT_SEASON} — probability of playing, ROC curve", loc="left")
    ax.set_xlabel("False positive rate")
    ax.set_ylabel("True positive rate")
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1.02)
    save(fig, str((dirs["played"] / f"played_gw{gw:02d}.png").relative_to(settings.reports_dir / "thesis")))


def main() -> None:
    import argparse
    parser = argparse.ArgumentParser(description="Season-start evaluation figures")
    parser.add_argument("--gameweeks", type=int, nargs="+", default=[1, 2],
                         help="Gameweeks to plot (default: 1 2)")
    args = parser.parse_args()

    for gw in args.gameweeks:
        grp = load_gw(gw)
        if grp is not None:
            gw_figures(gw, grp)

    logger.info("Season-start figures written to %s", OUT_BASE)


if __name__ == "__main__":
    main()
