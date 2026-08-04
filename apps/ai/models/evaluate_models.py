import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import json
import numpy as np
import pandas as pd
import joblib

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import seaborn as sns

from sklearn.metrics import (
    mean_absolute_error,
    mean_squared_error,
    r2_score,
    accuracy_score,
    precision_score,
    recall_score,
    f1_score,
    roc_auc_score,
    roc_curve,
    ConfusionMatrixDisplay,
)
from sklearn.calibration import calibration_curve

from config import settings
from constants import FEATURE_COLS, TARGET_POINTS, TARGET_PLAYED, TARGET_MINUTES, POSITION_LABEL
from logging_utils import get_logger
from models.model_utils import write_json, get_estimator, feature_importance_report

logger = get_logger(__name__)

sns.set_theme(style="whitegrid", palette="muted")


def load_val_data() -> pd.DataFrame:
    val_path = settings.datasets_dir / "validation_dataset.parquet"
    if not val_path.exists():
        raise FileNotFoundError(f"Missing validation dataset: {val_path}")
    return pd.read_parquet(val_path)


def load_model_file(filename: str):
    path = settings.models_dir / filename
    if not path.exists():
        raise FileNotFoundError(f"Missing model: {path}")
    logger.info("Loaded model: %s", path)
    return joblib.load(path)


def get_positive_probability(model, x):
    if hasattr(model, "predict_proba"):
        proba = model.predict_proba(x)
        if proba.shape[1] == 2:
            return proba[:, 1]

    if hasattr(model, "decision_function"):
        scores = model.decision_function(x)
        return 1 / (1 + np.exp(-scores))

    return model.predict(x)


def plot_feature_importance(model, title: str, filename: str) -> None:
    rows = feature_importance_report(model)
    if not rows:
        return

    top = rows[:15]
    names = [r["feature"] for r in top]
    vals = [r["importance"] for r in top]

    fig, ax = plt.subplots(figsize=(8, 6))
    y_pos = range(len(names))
    ax.barh(list(y_pos), vals)
    ax.set_yticks(list(y_pos))
    ax.set_yticklabels(names, fontsize=9)
    ax.invert_yaxis()
    ax.set_xlabel("Importance")
    ax.set_title(title)
    plt.tight_layout()
    plt.savefig(settings.reports_dir / filename, dpi=150)
    plt.close()


def evaluate_points_model(model, val_df: pd.DataFrame) -> dict:
    df = val_df.dropna(subset=[TARGET_POINTS]).copy()
    x = df[FEATURE_COLS].astype(float)
    y = df[TARGET_POINTS].astype(float)

    preds = np.clip(model.predict(x), 0, None)
    errors = preds - y.to_numpy()

    mae = float(mean_absolute_error(y, preds))
    rmse = float(np.sqrt(mean_squared_error(y, preds)))
    r2 = float(r2_score(y, preds))

    df["actual"] = y.to_numpy()
    df["predicted"] = preds
    df["abs_error"] = np.abs(errors)

    per_position = {}
    for pos_code, pos_name in POSITION_LABEL.items():
        subset = df[df["position"] == pos_code]
        if subset.empty:
            continue

        per_position[pos_name] = {
            "n": int(len(subset)),
            "mae": float(mean_absolute_error(subset["actual"], subset["predicted"])),
            "rmse": float(np.sqrt(mean_squared_error(subset["actual"], subset["predicted"]))),
        }

    report = {
        "rows": int(len(df)),
        "mae": mae,
        "rmse": rmse,
        "r2": r2,
        "pct_within_1pt": float(np.mean(np.abs(errors) <= 1.0) * 100),
        "pct_within_2pt": float(np.mean(np.abs(errors) <= 2.0) * 100),
        "pct_within_3pt": float(np.mean(np.abs(errors) <= 3.0) * 100),
        "per_position": per_position,
    }

    sample = df.sample(min(2000, len(df)), random_state=42)

    fig, ax = plt.subplots(figsize=(7, 5))
    ax.scatter(sample["actual"], sample["predicted"], alpha=0.25, s=12)
    max_val = max(sample["actual"].max(), sample["predicted"].max()) + 2
    ax.plot([0, max_val], [0, max_val], "r--", lw=1.5)
    ax.set_xlabel("Actual points")
    ax.set_ylabel("Predicted points")
    ax.set_title(f"Points model: actual vs predicted | MAE={mae:.2f}")
    plt.tight_layout()
    plt.savefig(settings.reports_dir / "points_actual_vs_predicted.png", dpi=150)
    plt.close()

    fig, ax = plt.subplots(figsize=(7, 4))
    ax.hist(errors, bins=60, alpha=0.75, edgecolor="white")
    ax.axvline(0, color="red", linestyle="--")
    ax.set_xlabel("Prediction error")
    ax.set_ylabel("Count")
    ax.set_title("Points model error distribution")
    ax.set_xlim(-15, 15)
    plt.tight_layout()
    plt.savefig(settings.reports_dir / "points_error_distribution.png", dpi=150)
    plt.close()

    if per_position:
        fig, ax = plt.subplots(figsize=(6, 4))
        names = list(per_position.keys())
        maes = [per_position[p]["mae"] for p in names]
        ax.bar(names, maes)
        ax.set_xlabel("Position")
        ax.set_ylabel("MAE")
        ax.set_title("Points model MAE by position")
        plt.tight_layout()
        plt.savefig(settings.reports_dir / "points_mae_by_position.png", dpi=150)
        plt.close()

    plot_feature_importance(model, "Points model feature importance", "points_feature_importance.png")

    return report


def evaluate_played_classifier(model, val_df: pd.DataFrame) -> dict:
    df = val_df.dropna(subset=[TARGET_PLAYED]).copy()
    x = df[FEATURE_COLS].astype(float)
    y = df[TARGET_PLAYED].astype(int)

    pred_prob = get_positive_probability(model, x)
    pred_labels = (pred_prob >= 0.5).astype(int)

    report = {
        "rows": int(len(df)),
        "accuracy": float(accuracy_score(y, pred_labels)),
        "precision": float(precision_score(y, pred_labels, zero_division=0)),
        "recall": float(recall_score(y, pred_labels, zero_division=0)),
        "f1": float(f1_score(y, pred_labels, zero_division=0)),
        "positive_rate_true": float(np.mean(y)),
        "positive_rate_pred": float(np.mean(pred_labels)),
    }

    try:
        report["roc_auc"] = float(roc_auc_score(y, pred_prob))
    except ValueError:
        report["roc_auc"] = None

    if report["roc_auc"] is not None:
        fpr, tpr, _ = roc_curve(y, pred_prob)
        fig, ax = plt.subplots(figsize=(6, 5))
        ax.plot(fpr, tpr, lw=2, label=f"AUC={report['roc_auc']:.3f}")
        ax.plot([0, 1], [0, 1], "r--")
        ax.set_xlabel("False positive rate")
        ax.set_ylabel("True positive rate")
        ax.set_title("Played classifier ROC curve")
        ax.legend()
        plt.tight_layout()
        plt.savefig(settings.reports_dir / "played_roc_curve.png", dpi=150)
        plt.close()

    try:
        fraction_pos, mean_pred = calibration_curve(y, pred_prob, n_bins=10, strategy="uniform")
        fig, ax = plt.subplots(figsize=(6, 5))
        ax.plot(mean_pred, fraction_pos, "s-", label="Model")
        ax.plot([0, 1], [0, 1], "r--", label="Perfect calibration")
        ax.set_xlabel("Mean predicted probability")
        ax.set_ylabel("Fraction of positives")
        ax.set_title("Played classifier calibration")
        ax.legend()
        plt.tight_layout()
        plt.savefig(settings.reports_dir / "played_calibration_curve.png", dpi=150)
        plt.close()
    except Exception:
        pass

    fig, ax = plt.subplots(figsize=(5, 4))
    ConfusionMatrixDisplay.from_predictions(
        y,
        pred_labels,
        ax=ax,
        display_labels=["No/low mins", "Played"],
        colorbar=False,
        cmap="Blues",
    )
    ax.set_title("Played classifier confusion matrix")
    plt.tight_layout()
    plt.savefig(settings.reports_dir / "played_confusion_matrix.png", dpi=150)
    plt.close()

    plot_feature_importance(model, "Played classifier feature importance", "played_feature_importance.png")

    return report


def evaluate_minutes_regressor(model, val_df: pd.DataFrame) -> dict:
    df = val_df.dropna(subset=[TARGET_MINUTES]).copy()
    x = df[FEATURE_COLS].astype(float)
    y = df[TARGET_MINUTES].astype(float)

    preds = np.clip(model.predict(x), 0, 90)

    mae = float(mean_absolute_error(y, preds))
    rmse = float(np.sqrt(mean_squared_error(y, preds)))

    def bucket(m: float) -> int:
        if m < 30:
            return 0
        if m < 60:
            return 1
        return 2

    actual_buckets = np.array([bucket(float(v)) for v in y.to_numpy()])
    pred_buckets = np.array([bucket(float(v)) for v in preds])

    report = {
        "rows": int(len(df)),
        "mae": mae,
        "rmse": rmse,
        "bucket_accuracy": float(np.mean(actual_buckets == pred_buckets)),
        "avg_actual_minutes": float(np.mean(y)),
        "avg_predicted_minutes": float(np.mean(preds)),
    }

    sample = pd.DataFrame({"actual": y.to_numpy(), "predicted": preds})
    sample = sample.sample(min(2000, len(sample)), random_state=42)

    fig, ax = plt.subplots(figsize=(6, 5))
    ax.scatter(sample["actual"], sample["predicted"], alpha=0.25, s=12)
    ax.plot([0, 90], [0, 90], "r--")
    ax.set_xlabel("Actual minutes")
    ax.set_ylabel("Predicted minutes")
    ax.set_title(f"Minutes regressor actual vs predicted | MAE={mae:.1f}")
    plt.tight_layout()
    plt.savefig(settings.reports_dir / "minutes_actual_vs_predicted.png", dpi=150)
    plt.close()

    plot_feature_importance(model, "Minutes regressor feature importance", "minutes_feature_importance.png")

    return report


def save_text_report(report: dict) -> None:
    txt_path = settings.reports_dir / "evaluation_summary.txt"
    with open(txt_path, "w", encoding="utf-8") as f:
        f.write("FPL ML Pipeline — Phase 6B Evaluation Report\n")
        f.write("=" * 60 + "\n\n")

        for section, metrics in report.items():
            f.write(section.upper() + "\n")
            f.write("-" * 40 + "\n")
            if isinstance(metrics, dict):
                for key, value in metrics.items():
                    f.write(f"{key}: {json.dumps(value, indent=2, ensure_ascii=False)}\n")
            else:
                f.write(str(metrics))
            f.write("\n")


def main() -> None:
    settings.ensure_artifact_dirs()

    val_df = load_val_data()

    points_model = load_model_file("points_model.joblib")
    played_classifier = load_model_file("played_classifier.joblib")
    minutes_regressor = load_model_file("minutes_regressor.joblib")

    report = {
        "points_model": evaluate_points_model(points_model, val_df),
        "played_classifier": evaluate_played_classifier(played_classifier, val_df),
        "minutes_regressor": evaluate_minutes_regressor(minutes_regressor, val_df),
        "feature_columns": FEATURE_COLS,
    }

    write_json(settings.reports_dir / "evaluation_summary.json", report)
    save_text_report(report)

    logger.info("Evaluation complete.")
    logger.info("Points MAE: %.4f", report["points_model"]["mae"])
    logger.info("Played F1: %.4f", report["played_classifier"]["f1"])
    logger.info("Minutes MAE: %.4f", report["minutes_regressor"]["mae"])


if __name__ == "__main__":
    main()