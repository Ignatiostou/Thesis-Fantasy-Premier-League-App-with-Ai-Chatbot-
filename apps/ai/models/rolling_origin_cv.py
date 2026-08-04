import sys
import json
import argparse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import numpy as np
import pandas as pd

from sklearn.ensemble import GradientBoostingRegressor, GradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.calibration import CalibratedClassifierCV
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import (
    mean_absolute_error, mean_squared_error, r2_score,
    f1_score, roc_auc_score, brier_score_loss,
    accuracy_score,
)
from xgboost import XGBRegressor

from config import settings
from constants import FEATURE_COLS, TARGET_POINTS, TARGET_PLAYED, TARGET_MINUTES
from features.player_features import build_features
from logging_utils import get_logger
from models.model_utils import write_json

logger = get_logger(__name__)


# ── Fold generator ────────────────────────────────────────────────────────────

def rolling_origin_folds(
    gameweeks: pd.Series,
    min_train_gws: int = 15,
    max_folds: int = 8,
) -> list[tuple[int, int]]:
    """
    Generate (train_max_gw, val_gw) pairs.
    Skips folds where validation GW has too few rows.
    """
    available_gws = sorted(gameweeks.unique())
    if len(available_gws) <= min_train_gws:
        raise ValueError(
            f"Need more than {min_train_gws} gameweeks of data; got {len(available_gws)}"
        )

    folds = []
    for i in range(min_train_gws, len(available_gws) - 1):
        train_max = available_gws[i - 1]
        val_gw    = available_gws[i]
        folds.append((train_max, val_gw))
        if len(folds) >= max_folds:
            break
    return folds


# ── Per-target candidate builders ─────────────────────────────────────────────

def build_points_pipeline():
    return Pipeline([
        ("imputer", SimpleImputer(strategy="median")),
        ("model",   GradientBoostingRegressor(
            n_estimators=250, learning_rate=0.04, max_depth=3, random_state=42,
        )),
    ])


def build_played_pipeline(calibrate: bool = True):
    """Returns the same logistic+calibration stack used in production."""
    base = Pipeline([
        ("imputer", SimpleImputer(strategy="median")),
        ("scaler",  StandardScaler()),
        ("model",   LogisticRegression(max_iter=2000, class_weight="balanced", random_state=42)),
    ])
    if not calibrate:
        return base
    return CalibratedClassifierCV(estimator=base, method="isotonic", cv=3)


def build_minutes_pipeline():
    return Pipeline([
        ("imputer", SimpleImputer(strategy="median")),
        ("model",   XGBRegressor(
            n_estimators=400, max_depth=4, learning_rate=0.05,
            subsample=0.8, colsample_bytree=0.8, min_child_weight=5,
            reg_alpha=0.1, reg_lambda=1.0,
            objective="reg:squarederror", random_state=42, n_jobs=-1, verbosity=0,
        )),
    ])


# ── Per-target metric collectors ──────────────────────────────────────────────

def metrics_points(y_true, y_pred) -> dict:
    preds = np.clip(y_pred, 0, None)
    errors = preds - y_true.to_numpy()
    return {
        "mae":               float(mean_absolute_error(y_true, preds)),
        "rmse":              float(np.sqrt(mean_squared_error(y_true, preds))),
        "r2":                float(r2_score(y_true, preds)),
        "pct_within_1pt":    float(np.mean(np.abs(errors) <= 1.0) * 100),
        "pct_within_2pt":    float(np.mean(np.abs(errors) <= 2.0) * 100),
        "pct_within_3pt":    float(np.mean(np.abs(errors) <= 3.0) * 100),
    }


def metrics_played(y_true, y_prob, threshold: float = 0.5) -> dict:
    y_lab = (y_prob >= threshold).astype(int)
    out = {
        "accuracy":    float(accuracy_score(y_true, y_lab)),
        "f1":          float(f1_score(y_true, y_lab, zero_division=0)),
        "brier_score": float(brier_score_loss(y_true, y_prob)),
    }
    try:
        out["roc_auc"] = float(roc_auc_score(y_true, y_prob))
    except ValueError:
        out["roc_auc"] = None
    return out


def metrics_minutes(y_true, y_pred) -> dict:
    preds = np.clip(y_pred, 0, 90)
    def bucket(m):
        return 0 if m < 30 else (1 if m < 60 else 2)
    return {
        "mae":             float(mean_absolute_error(y_true, preds)),
        "rmse":            float(np.sqrt(mean_squared_error(y_true, preds))),
        "bucket_accuracy": float(np.mean(
            np.array([bucket(float(v)) for v in y_true.to_numpy()]) ==
            np.array([bucket(float(v)) for v in preds])
        )),
    }


# ── CV driver per target ──────────────────────────────────────────────────────

def cv_one_target(
    df: pd.DataFrame,
    target: str,
    min_train_gws: int,
    max_folds: int,
) -> dict:
    """Run rolling-origin CV for one of: points / played / minutes."""
    df = df.dropna(subset=[target]).copy()
    if df.empty:
        return {"error": f"No rows with target {target}"}

    folds = rolling_origin_folds(df["gameweek"], min_train_gws, max_folds)
    if not folds:
        return {"error": "No folds could be constructed"}

    logger.info("Running rolling-origin CV for %s — %d folds", target, len(folds))

    fold_metrics: list[dict] = []

    for fold_idx, (train_max, val_gw) in enumerate(folds, start=1):
        train_df = df[df["gameweek"] <= train_max]
        val_df   = df[df["gameweek"] == val_gw]
        if len(train_df) < 100 or len(val_df) < 20:
            continue

        x_train = train_df[FEATURE_COLS].astype(float)
        x_val   = val_df[FEATURE_COLS].astype(float)
        y_train = train_df[target]
        y_val   = val_df[target]

        if target == TARGET_POINTS:
            model = build_points_pipeline()
            model.fit(x_train, y_train.astype(float))
            preds = np.clip(model.predict(x_val), 0, None)
            m = metrics_points(y_val.astype(float), preds)
        elif target == TARGET_PLAYED:
            model = build_played_pipeline(calibrate=True)
            model.fit(x_train, y_train.astype(int))
            probs = model.predict_proba(x_val)[:, 1]
            m = metrics_played(y_val.astype(int), probs)
        elif target == TARGET_MINUTES:
            model = build_minutes_pipeline()
            model.fit(x_train, y_train.astype(float))
            preds = np.clip(model.predict(x_val), 0, 90)
            m = metrics_minutes(y_val.astype(float), preds)
        else:
            return {"error": f"Unknown target {target}"}

        m["fold"]      = fold_idx
        m["train_max"] = int(train_max)
        m["val_gw"]    = int(val_gw)
        m["n_train"]   = int(len(x_train))
        m["n_val"]     = int(len(x_val))
        fold_metrics.append(m)

        logger.info(
            "  Fold %d  train≤GW%d (n=%d)  val=GW%d (n=%d)  → %s",
            fold_idx, train_max, len(x_train), val_gw, len(x_val),
            " | ".join(
                f"{k}={v:.3f}" for k, v in m.items()
                if k not in {"fold", "train_max", "val_gw", "n_train", "n_val"}
                and isinstance(v, (int, float))
            ),
        )

    # Aggregate
    summary: dict = {"target": target, "fold_count": len(fold_metrics), "folds": fold_metrics}
    if not fold_metrics:
        return summary

    numeric_keys = set()
    for f in fold_metrics:
        for k, v in f.items():
            if isinstance(v, (int, float)) and k not in {"fold", "train_max", "val_gw", "n_train", "n_val"}:
                numeric_keys.add(k)

    aggregate = {}
    for k in numeric_keys:
        values = [f[k] for f in fold_metrics if f.get(k) is not None]
        if not values: continue
        aggregate[k] = {
            "mean":   float(np.mean(values)),
            "std":    float(np.std(values, ddof=1)) if len(values) > 1 else 0.0,
            "min":    float(np.min(values)),
            "max":    float(np.max(values)),
            "ci_low":  float(np.mean(values) - 1.96 * (np.std(values, ddof=1) / np.sqrt(len(values))) if len(values) > 1 else np.mean(values)),
            "ci_high": float(np.mean(values) + 1.96 * (np.std(values, ddof=1) / np.sqrt(len(values))) if len(values) > 1 else np.mean(values)),
        }
    summary["aggregate"] = aggregate
    return summary


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Rolling-origin CV for FPL models")
    parser.add_argument("--target", choices=["points", "played", "minutes", "all"], default="all")
    parser.add_argument("--min-train-gws", type=int, default=15)
    parser.add_argument("--folds", type=int, default=8)
    args = parser.parse_args()

    settings.ensure_artifact_dirs()

    raw_path = settings.datasets_dir / "player_gw_history.parquet"
    if not raw_path.exists():
        raise FileNotFoundError(f"Run extract_player_gw_history.py first; {raw_path} not found")

    raw = pd.read_parquet(raw_path)
    logger.info("Loaded %d raw rows", len(raw))

    featured = build_features(raw)

    # Attach targets the same way build_training_dataset does
    featured = featured.sort_values(["player_id", "gameweek"])
    featured[TARGET_POINTS]  = featured.groupby("player_id")["gw_points"].shift(-1)
    featured[TARGET_MINUTES] = featured.groupby("player_id")["minutes"].shift(-1)
    featured[TARGET_PLAYED]  = (featured[TARGET_MINUTES] >= 30).astype(float)

    targets = [TARGET_POINTS, TARGET_PLAYED, TARGET_MINUTES] if args.target == "all" else {
        "points": [TARGET_POINTS], "played": [TARGET_PLAYED], "minutes": [TARGET_MINUTES],
    }[args.target]

    full_report = {"min_train_gws": args.min_train_gws, "max_folds": args.folds, "targets": {}}
    for tgt in targets:
        full_report["targets"][tgt] = cv_one_target(featured, tgt, args.min_train_gws, args.folds)

    out_path = settings.reports_dir / "rolling_origin_cv_report.json"
    write_json(out_path, full_report)
    logger.info("Rolling-origin CV report written to %s", out_path)

    # Print headline aggregates
    print()
    print("═" * 80)
    print(" Rolling-Origin Cross-Validation — Summary")
    print("═" * 80)
    for tgt, payload in full_report["targets"].items():
        if "aggregate" not in payload: continue
        print(f"\n  Target: {tgt}  (n_folds={payload['fold_count']})")
        for metric, stats in payload["aggregate"].items():
            print(f"    {metric:<20} mean={stats['mean']:.4f}  std={stats['std']:.4f}  "
                  f"95%CI=[{stats['ci_low']:.4f}, {stats['ci_high']:.4f}]")
    print()


if __name__ == "__main__":
    main()