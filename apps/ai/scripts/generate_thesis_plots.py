"""
Thesis figures — walk-forward evaluation of the ML pipeline across a season.

For every target gameweek GW_t (starting at GW8), the three production model
configurations are trained ONLY on data whose target is earlier than GW_t and
evaluated on GW_t itself — i.e. every point in these figures is an
out-of-sample prediction, exactly reproducing what the live pipeline would
have predicted before that gameweek was played.

Outputs (300 DPI PNG, print-ready) to artifacts/reports/thesis/:

    01_points_mae_by_gameweek.png       model vs naive form baseline
    02_mean_actual_vs_predicted.png     season shape tracking
    03_minutes_mae_by_gameweek.png
    04_played_auc_by_gameweek.png
    05_actual_vs_predicted_scatter.png
    06_error_distribution.png
    07_mae_by_position.png
    08_feature_importance_top15.png
    09_players_per_gameweek.png
    walkforward_metrics.csv             per-GW table for the report

Run:  python scripts/generate_thesis_plots.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.ensemble import (
    HistGradientBoostingRegressor,
    RandomForestClassifier,
    RandomForestRegressor,
)
from sklearn.impute import SimpleImputer
from sklearn.metrics import mean_absolute_error, r2_score, roc_auc_score
from sklearn.pipeline import Pipeline

from config import settings
from constants import FEATURE_COLS, TARGET_POINTS, TARGET_MINUTES, TARGET_PLAYED
from data.build_training_dataset import attach_targets, filter_minimum_history
from features.player_features import build_features
from logging_utils import get_logger

logger = get_logger("thesis_plots")

# GW3 is the earliest honestly-evaluable gameweek: predicting GW N requires a
# model trained on earlier (features → next-GW points) pairs, and the first
# such pair only exists after GW1 is played (GW1 features → GW2 target).
FIRST_TARGET_GW = 3

OUT_DIR = settings.reports_dir / "thesis"

# ── Chart style (validated palette, light surface) ────────────────────────────
SURFACE = "#fcfcfb"
GRID = "#e7e6e3"
AXIS = "#d0cfcb"
TEXT = "#0b0b0b"
TEXT_2 = "#52514e"
BLUE = "#2a78d6"    # series 1 — model / predicted
AQUA = "#1baf7a"    # series 2
YELLOW = "#eda100"  # series 3 — baseline
SEQ_BLUE = "#86b6ef"

plt.rcParams.update({
    "figure.dpi": 300, "savefig.dpi": 300,
    "figure.facecolor": SURFACE, "axes.facecolor": SURFACE,
    "savefig.facecolor": SURFACE,
    "text.color": TEXT, "axes.labelcolor": TEXT_2,
    "xtick.color": TEXT_2, "ytick.color": TEXT_2,
    "axes.edgecolor": AXIS, "axes.linewidth": 0.8,
    "axes.grid": True, "grid.color": GRID, "grid.linewidth": 0.6,
    "axes.spines.top": False, "axes.spines.right": False,
    "font.size": 9, "axes.titlesize": 11, "axes.titleweight": "bold",
    "axes.titlepad": 26,  # leave room for the subtitle line under the title
    "legend.frameon": False,
})


def new_fig(w=8.0, h=4.2):
    fig, ax = plt.subplots(figsize=(w, h))
    ax.set_axisbelow(True)
    return fig, ax


def save(fig, name: str) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / name
    fig.tight_layout()
    fig.savefig(path, bbox_inches="tight")
    plt.close(fig)
    logger.info("Saved %s", path)


def end_label(ax, x, y, text, color):
    ax.annotate(text, (x, y), xytext=(6, 0), textcoords="offset points",
                va="center", fontsize=8.5, fontweight="bold", color=color)


# ── Production model configurations (the tournament winners) ─────────────────

def points_model():
    return Pipeline([
        ("imputer", SimpleImputer(strategy="median")),
        ("model", HistGradientBoostingRegressor(
            max_iter=300, learning_rate=0.04, max_leaf_nodes=31, random_state=42)),
    ])


def played_model():
    return Pipeline([
        ("imputer", SimpleImputer(strategy="median")),
        ("model", RandomForestClassifier(
            n_estimators=300, max_depth=12, min_samples_leaf=5,
            random_state=42, n_jobs=-1)),
    ])


def minutes_model():
    return Pipeline([
        ("imputer", SimpleImputer(strategy="median")),
        ("model", RandomForestRegressor(
            n_estimators=300, max_depth=12, min_samples_leaf=5,
            random_state=42, n_jobs=-1)),
    ])


# ── Walk-forward evaluation ───────────────────────────────────────────────────

def load_dataset() -> pd.DataFrame:
    raw_path = settings.datasets_dir / "player_gw_history.parquet"
    if not raw_path.exists():
        raise FileNotFoundError(f"{raw_path} missing — run data/extract_player_gw_history.py")
    raw = pd.read_parquet(raw_path)
    df = build_features(raw)
    df = attach_targets(df)
    df = filter_minimum_history(df)
    df = df.dropna(subset=[TARGET_POINTS]).copy()
    df["target_gw"] = df["gameweek"] + 1  # the GW the row's target refers to
    return df


def walk_forward(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Returns (per-GW metrics table, all out-of-sample predictions)."""
    target_gws = sorted(df["target_gw"].unique())
    target_gws = [g for g in target_gws if g >= FIRST_TARGET_GW]

    metrics_rows, pred_frames = [], []

    for tgw in target_gws:
        train = df[df["target_gw"] < tgw]
        test = df[df["target_gw"] == tgw]
        if len(train) < 300 or len(test) < 50:
            continue

        x_tr, x_te = train[FEATURE_COLS].astype(float), test[FEATURE_COLS].astype(float)

        # Points
        pm = points_model().fit(x_tr, train[TARGET_POINTS])
        pts_pred = np.clip(pm.predict(x_te), 0, None)
        pts_true = test[TARGET_POINTS].to_numpy()
        # Naive baseline: recent form (mean points of last 5 GWs) as the prediction
        base_pred = test["pts_last_5gw_avg"].to_numpy()

        # Minutes
        mm = minutes_model().fit(x_tr, train[TARGET_MINUTES])
        min_pred = np.clip(mm.predict(x_te), 0, 90)
        min_true = test[TARGET_MINUTES].to_numpy()

        # Played (guard against degenerate single-class folds)
        played_true = test[TARGET_PLAYED].to_numpy()
        try:
            cm = played_model().fit(x_tr, train[TARGET_PLAYED].astype(int))
            played_prob = cm.predict_proba(x_te)[:, 1]
            auc = roc_auc_score(played_true, played_prob) if len(np.unique(played_true)) > 1 else np.nan
        except Exception:
            played_prob, auc = np.full(len(test), np.nan), np.nan

        metrics_rows.append({
            "target_gw": tgw,
            "n_test": len(test),
            "points_mae": mean_absolute_error(pts_true, pts_pred),
            "baseline_mae": mean_absolute_error(pts_true, base_pred),
            "points_mean_actual": pts_true.mean(),
            "points_mean_predicted": pts_pred.mean(),
            "minutes_mae": mean_absolute_error(min_true, min_pred),
            "played_auc": auc,
        })
        pred_frames.append(pd.DataFrame({
            "target_gw": tgw,
            "player_id": test["player_id"].to_numpy(),
            "position": test["position"].to_numpy(),
            "actual": pts_true, "predicted": pts_pred,
            "minutes_actual": min_true, "minutes_predicted": min_pred,
            "played_actual": played_true, "played_prob": played_prob,
        }))
        logger.info("GW%02d | test=%4d | pts MAE=%.3f (baseline %.3f) | mins MAE=%.2f | AUC=%s",
                    tgw, len(test), metrics_rows[-1]["points_mae"],
                    metrics_rows[-1]["baseline_mae"], metrics_rows[-1]["minutes_mae"],
                    f"{auc:.3f}" if not np.isnan(auc) else "n/a")

    return pd.DataFrame(metrics_rows), pd.concat(pred_frames, ignore_index=True)


# ── Figures ───────────────────────────────────────────────────────────────────

def fig_points_mae(m: pd.DataFrame):
    fig, ax = new_fig()
    ax.plot(m["target_gw"], m["baseline_mae"], color=YELLOW, lw=2, label="Naive baseline (5-GW form)")
    ax.plot(m["target_gw"], m["points_mae"], color=BLUE, lw=2, label="ML model (walk-forward)")
    end_label(ax, m["target_gw"].iloc[-1], m["points_mae"].iloc[-1], "Model", BLUE)
    end_label(ax, m["target_gw"].iloc[-1], m["baseline_mae"].iloc[-1], "Baseline", YELLOW)
    avg, avg_b = m["points_mae"].mean(), m["baseline_mae"].mean()
    ax.set_title("Expected-points model — out-of-sample MAE per gameweek", loc="left")
    ax.text(0, 1.02, f"Season average: model {avg:.3f} vs baseline {avg_b:.3f} points",
            transform=ax.transAxes, fontsize=8.5, color=TEXT_2)
    ax.set_xlabel("Target gameweek"); ax.set_ylabel("Mean absolute error (points)")
    ax.set_ylim(bottom=0); ax.legend(loc="lower right", fontsize=8)
    save(fig, "01_points_mae_by_gameweek.png")


def fig_mean_tracking(m: pd.DataFrame):
    fig, ax = new_fig()
    ax.plot(m["target_gw"], m["points_mean_actual"], color=TEXT_2, lw=2, label="Actual mean points")
    ax.plot(m["target_gw"], m["points_mean_predicted"], color=BLUE, lw=2, label="Predicted mean points")
    end_label(ax, m["target_gw"].iloc[-1], m["points_mean_predicted"].iloc[-1], "Predicted", BLUE)
    end_label(ax, m["target_gw"].iloc[-1], m["points_mean_actual"].iloc[-1], "Actual", TEXT_2)
    ax.set_title("Mean player points per gameweek — actual vs predicted", loc="left")
    ax.set_xlabel("Target gameweek"); ax.set_ylabel("Mean points (all evaluated players)")
    ax.set_ylim(bottom=0); ax.legend(loc="upper right", fontsize=8)
    save(fig, "02_mean_actual_vs_predicted.png")


def fig_minutes_mae(m: pd.DataFrame):
    fig, ax = new_fig()
    ax.plot(m["target_gw"], m["minutes_mae"], color=BLUE, lw=2, marker="o", ms=3.5)
    ax.set_title("Minutes model — out-of-sample MAE per gameweek", loc="left")
    ax.text(0, 1.02, f"Season average: {m['minutes_mae'].mean():.1f} minutes",
            transform=ax.transAxes, fontsize=8.5, color=TEXT_2)
    ax.set_xlabel("Target gameweek"); ax.set_ylabel("Mean absolute error (minutes)")
    ax.set_ylim(bottom=0)
    save(fig, "03_minutes_mae_by_gameweek.png")


def fig_played_auc(m: pd.DataFrame):
    fig, ax = new_fig()
    mm = m.dropna(subset=["played_auc"])
    ax.plot(mm["target_gw"], mm["played_auc"], color=BLUE, lw=2, marker="o", ms=3.5)
    ax.axhline(0.5, color=AXIS, lw=1, ls="--")
    ax.text(mm["target_gw"].iloc[0], 0.507, "random classifier (0.5)", fontsize=7.5, color=TEXT_2)
    ax.set_title("Probability-of-playing model — ROC-AUC per gameweek", loc="left")
    ax.text(0, 1.02, f"Season average: {mm['played_auc'].mean():.3f}",
            transform=ax.transAxes, fontsize=8.5, color=TEXT_2)
    ax.set_xlabel("Target gameweek"); ax.set_ylabel("ROC-AUC")
    ax.set_ylim(0.45, 1.0)
    save(fig, "04_played_auc_by_gameweek.png")


def fig_scatter(preds: pd.DataFrame):
    fig, ax = new_fig(6.4, 5.6)
    lim = max(preds["actual"].max(), preds["predicted"].max()) + 1
    ax.scatter(preds["actual"], preds["predicted"], s=6, color=BLUE, alpha=0.15, edgecolors="none")
    ax.plot([0, lim], [0, lim], color=TEXT_2, lw=1.2, ls="--")
    ax.text(lim * 0.82, lim * 0.87, "perfect\nprediction", fontsize=7.5, color=TEXT_2, ha="center")
    mae = mean_absolute_error(preds["actual"], preds["predicted"])
    r2 = r2_score(preds["actual"], preds["predicted"])
    ax.set_title("Actual vs predicted points — all out-of-sample predictions", loc="left")
    ax.text(0, 1.02, f"n = {len(preds):,} player-gameweeks | MAE {mae:.3f} | R² {r2:.3f}",
            transform=ax.transAxes, fontsize=8.5, color=TEXT_2)
    ax.set_xlabel("Actual points"); ax.set_ylabel("Predicted points")
    ax.set_xlim(-0.5, lim); ax.set_ylim(-0.5, lim)
    save(fig, "05_actual_vs_predicted_scatter.png")


def fig_error_hist(preds: pd.DataFrame):
    fig, ax = new_fig()
    err = preds["predicted"] - preds["actual"]
    ax.hist(err, bins=np.arange(-10, 10.5, 0.5), color=SEQ_BLUE, edgecolor=SURFACE, linewidth=0.6)
    ax.axvline(0, color=TEXT_2, lw=1.2, ls="--")
    within2 = float(np.mean(np.abs(err) <= 2) * 100)
    ax.set_title("Prediction error distribution (predicted − actual points)", loc="left")
    ax.text(0, 1.02, f"{within2:.1f}% of predictions within ±2 points | mean error {err.mean():+.3f}",
            transform=ax.transAxes, fontsize=8.5, color=TEXT_2)
    ax.set_xlabel("Error (points)"); ax.set_ylabel("Player-gameweeks")
    save(fig, "06_error_distribution.png")


def fig_mae_by_position(preds: pd.DataFrame):
    from constants import POSITION_LABEL
    fig, ax = new_fig(6.4, 3.8)
    rows = []
    for pos, grp in preds.groupby("position"):
        rows.append((POSITION_LABEL.get(int(pos), str(pos)),
                     mean_absolute_error(grp["actual"], grp["predicted"])))
    labels, values = zip(*rows)
    bars = ax.bar(labels, values, color=BLUE, width=0.55)
    for b, v in zip(bars, values):
        ax.text(b.get_x() + b.get_width() / 2, v + 0.015, f"{v:.3f}",
                ha="center", fontsize=8.5, fontweight="bold", color=TEXT)
    ax.set_title("Points model MAE by position (out-of-sample)", loc="left")
    ax.set_ylabel("Mean absolute error (points)")
    ax.grid(axis="x", visible=False)
    save(fig, "07_mae_by_position.png")


def fig_feature_importance():
    import json
    meta_path = settings.models_dir / "points_model_meta.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    imp = meta.get("feature_importance") or []
    xlabel = "Importance"

    if not imp:
        # HistGradientBoosting exposes no feature_importances_ — compute
        # permutation importance on the held-out validation set instead.
        logger.info("No stored importances — computing permutation importance...")
        from sklearn.inspection import permutation_importance
        from models.model_utils import load_model

        model = load_model(settings.models_dir / "points_model.joblib")
        val = pd.read_parquet(settings.datasets_dir / "validation_dataset.parquet")
        x_val = val[FEATURE_COLS].astype(float)
        y_val = val[TARGET_POINTS]
        result = permutation_importance(
            model, x_val, y_val, n_repeats=5, random_state=42,
            scoring="neg_mean_absolute_error",
        )
        imp = sorted(
            ({"feature": f, "importance": float(m)}
             for f, m in zip(FEATURE_COLS, result.importances_mean)),
            key=lambda r: r["importance"], reverse=True,
        )
        xlabel = "Permutation importance (increase in MAE when shuffled)"

    top = imp[:15][::-1]
    names = [i["feature"] for i in top]
    vals = [i["importance"] for i in top]
    fig, ax = new_fig(7.2, 5.0)
    ax.barh(names, vals, color=BLUE, height=0.6)
    ax.set_title("Points model — top 15 feature importances", loc="left")
    ax.text(0, 1.015, f"Production model: {meta.get('best_model')}",
            transform=ax.transAxes, fontsize=8.5, color=TEXT_2)
    ax.set_xlabel(xlabel)
    ax.grid(axis="y", visible=False)
    save(fig, "08_feature_importance_top15.png")


def fig_players_per_gw(df: pd.DataFrame):
    fig, ax = new_fig()
    counts = df.groupby("target_gw")["player_id"].count()
    ax.bar(counts.index, counts.values, color=SEQ_BLUE, width=0.7)
    ax.set_title("Evaluation dataset coverage — player rows per target gameweek", loc="left")
    ax.text(0, 1.02, f"Total: {int(counts.sum()):,} player-gameweek training pairs",
            transform=ax.transAxes, fontsize=8.5, color=TEXT_2)
    ax.set_xlabel("Target gameweek"); ax.set_ylabel("Players")
    ax.grid(axis="x", visible=False)
    save(fig, "09_players_per_gameweek.png")


# ── Per-gameweek figures (3 per GW: points / minutes / played) ───────────────

def _scatter_gw(ax, actual, predicted, unit_max, xlabel, ylabel):
    ax.scatter(actual, predicted, s=10, color=BLUE, alpha=0.35, edgecolors="none")
    ax.plot([0, unit_max], [0, unit_max], color=TEXT_2, lw=1.1, ls="--")
    ax.set_xlim(-unit_max * 0.03, unit_max)
    ax.set_ylim(-unit_max * 0.03, unit_max)
    ax.set_xlabel(xlabel)
    ax.set_ylabel(ylabel)


def per_gameweek_figures(preds: pd.DataFrame) -> None:
    from sklearn.metrics import roc_curve

    dirs = {kind: OUT_DIR / "per_gameweek" / kind for kind in ("points", "minutes", "played")}
    for d in dirs.values():
        d.mkdir(parents=True, exist_ok=True)

    for tgw, grp in preds.groupby("target_gw"):
        tgw = int(tgw)

        # 1. Points — actual vs predicted scatter
        fig, ax = new_fig(5.4, 4.6)
        lim = max(12.0, float(grp["actual"].max()) + 1)
        _scatter_gw(ax, grp["actual"], grp["predicted"], lim,
                    "Actual points", "Predicted points")
        mae = mean_absolute_error(grp["actual"], grp["predicted"])
        ax.set_title(f"GW{tgw} — expected points (out-of-sample)", loc="left")
        ax.text(0, 1.02, f"n = {len(grp)} players | MAE {mae:.3f}",
                transform=ax.transAxes, fontsize=8.5, color=TEXT_2)
        save(fig, f"per_gameweek/points/points_gw{tgw:02d}.png")

        # 2. Minutes — actual vs predicted scatter
        fig, ax = new_fig(5.4, 4.6)
        _scatter_gw(ax, grp["minutes_actual"], grp["minutes_predicted"], 95,
                    "Actual minutes", "Predicted minutes")
        mae_m = mean_absolute_error(grp["minutes_actual"], grp["minutes_predicted"])
        ax.set_title(f"GW{tgw} — minutes played (out-of-sample)", loc="left")
        ax.text(0, 1.02, f"n = {len(grp)} players | MAE {mae_m:.1f} minutes",
                transform=ax.transAxes, fontsize=8.5, color=TEXT_2)
        save(fig, f"per_gameweek/minutes/minutes_gw{tgw:02d}.png")

        # 3. Played — ROC curve
        fig, ax = new_fig(5.4, 4.6)
        y_true = grp["played_actual"].to_numpy()
        y_prob = grp["played_prob"].to_numpy()
        valid = ~np.isnan(y_prob)
        if valid.sum() > 10 and len(np.unique(y_true[valid])) > 1:
            fpr, tpr, _ = roc_curve(y_true[valid], y_prob[valid])
            auc = roc_auc_score(y_true[valid], y_prob[valid])
            ax.plot(fpr, tpr, color=BLUE, lw=2)
            ax.plot([0, 1], [0, 1], color=AXIS, lw=1, ls="--")
            ax.text(0.62, 0.08, f"AUC = {auc:.3f}", fontsize=10,
                    fontweight="bold", color=BLUE)
            ax.text(0, 1.02, f"n = {int(valid.sum())} players | played ≥30 min: "
                    f"{int(y_true[valid].sum())}",
                    transform=ax.transAxes, fontsize=8.5, color=TEXT_2)
        else:
            ax.text(0.5, 0.5, "insufficient data", ha="center", color=TEXT_2)
        ax.set_title(f"GW{tgw} — probability of playing, ROC curve", loc="left")
        ax.set_xlabel("False positive rate")
        ax.set_ylabel("True positive rate")
        ax.set_xlim(0, 1)
        ax.set_ylim(0, 1.02)
        save(fig, f"per_gameweek/played/played_gw{tgw:02d}.png")

    logger.info("Per-gameweek figures written for %d gameweeks (3 each)",
                preds["target_gw"].nunique())


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    import argparse
    parser = argparse.ArgumentParser(description="Generate thesis figures")
    parser.add_argument("--plots-only", action="store_true",
                        help="Reuse cached walk-forward results, just re-render the PNGs")
    args = parser.parse_args()

    logger.info("Loading dataset and building features...")
    df = load_dataset()
    logger.info("Dataset: %d rows | target GWs %d–%d",
                len(df), df["target_gw"].min(), df["target_gw"].max())

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    metrics_path = OUT_DIR / "walkforward_metrics.csv"
    preds_path = OUT_DIR / "walkforward_predictions.parquet"

    if args.plots_only and metrics_path.exists() and preds_path.exists():
        logger.info("--plots-only: reusing cached walk-forward results")
        metrics = pd.read_csv(metrics_path)
        preds = pd.read_parquet(preds_path)
    else:
        logger.info("Running walk-forward evaluation (%d folds, 3 models each)...",
                    df[df['target_gw'] >= FIRST_TARGET_GW]['target_gw'].nunique())
        metrics, preds = walk_forward(df)
        metrics.round(4).to_csv(metrics_path, index=False)
        preds.to_parquet(preds_path, index=False)
        logger.info("Saved per-GW metrics table: %s", metrics_path)

    fig_points_mae(metrics)
    fig_mean_tracking(metrics)
    fig_minutes_mae(metrics)
    fig_played_auc(metrics)
    fig_scatter(preds)
    fig_error_hist(preds)
    fig_mae_by_position(preds)
    fig_feature_importance()
    fig_players_per_gw(df)
    per_gameweek_figures(preds)

    logger.info("All thesis figures written to %s", OUT_DIR)


if __name__ == "__main__":
    main()
