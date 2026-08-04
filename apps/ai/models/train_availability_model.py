import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import numpy as np
from sklearn.ensemble import (
    RandomForestClassifier,
    GradientBoostingClassifier,
    RandomForestRegressor,
    GradientBoostingRegressor,
)
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    f1_score,
    roc_auc_score,
    precision_score,
    recall_score,
    mean_absolute_error,
    mean_squared_error,
)
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from xgboost import XGBClassifier, XGBRegressor

from config import settings
from constants import TARGET_PLAYED, TARGET_MINUTES, FEATURE_COLS
from logging_utils import get_logger
from models.model_utils import (
    ensure_model_dirs,
    load_train_validation,
    get_xy,
    write_json,
    save_model_with_meta,
    feature_importance_report,
)

logger = get_logger(__name__)

PLAYED_MODEL_VERSION = "played_hybrid_v1"
MINUTES_MODEL_VERSION = "minutes_hybrid_v1"


def build_classifier_candidates() -> dict[str, Pipeline]:
    return {
        "logistic_regression_played": Pipeline(
            steps=[
                ("imputer", SimpleImputer(strategy="median")),
                ("scaler", StandardScaler()),
                (
                    "model",
                    LogisticRegression(
                        max_iter=2000,
                        class_weight="balanced",
                        random_state=42,
                    ),
                ),
            ]
        ),
        "random_forest_played": Pipeline(
            steps=[
                ("imputer", SimpleImputer(strategy="median")),
                (
                    "model",
                    RandomForestClassifier(
                        n_estimators=300,
                        max_depth=12,
                        min_samples_leaf=5,
                        class_weight="balanced",
                        random_state=42,
                        n_jobs=-1,
                    ),
                ),
            ]
        ),
        "gradient_boosting_played": Pipeline(
            steps=[
                ("imputer", SimpleImputer(strategy="median")),
                (
                    "model",
                    GradientBoostingClassifier(
                        n_estimators=220,
                        learning_rate=0.04,
                        max_depth=3,
                        random_state=42,
                    ),
                ),
            ]
        ),
        "xgboost_played": Pipeline(
            steps=[
                ("imputer", SimpleImputer(strategy="median")),
                (
                    "model",
                    XGBClassifier(
                        n_estimators=400,
                        max_depth=4,
                        learning_rate=0.05,
                        subsample=0.8,
                        colsample_bytree=0.8,
                        min_child_weight=5,
                        reg_alpha=0.1,
                        reg_lambda=1.0,
                        objective="binary:logistic",
                        eval_metric="auc",
                        random_state=42,
                        n_jobs=-1,
                        verbosity=0,
                    ),
                ),
            ]
        ),
    }


def build_minutes_candidates() -> dict[str, Pipeline]:
    return {
        "random_forest_minutes": Pipeline(
            steps=[
                ("imputer", SimpleImputer(strategy="median")),
                (
                    "model",
                    RandomForestRegressor(
                        n_estimators=300,
                        max_depth=12,
                        min_samples_leaf=5,
                        random_state=42,
                        n_jobs=-1,
                    ),
                ),
            ]
        ),
        "gradient_boosting_minutes": Pipeline(
            steps=[
                ("imputer", SimpleImputer(strategy="median")),
                (
                    "model",
                    GradientBoostingRegressor(
                        n_estimators=220,
                        learning_rate=0.04,
                        max_depth=3,
                        random_state=42,
                    ),
                ),
            ]
        ),
        "xgboost_minutes": Pipeline(
            steps=[
                ("imputer", SimpleImputer(strategy="median")),
                (
                    "model",
                    XGBRegressor(
                        n_estimators=400,
                        max_depth=4,
                        learning_rate=0.05,
                        subsample=0.8,
                        colsample_bytree=0.8,
                        min_child_weight=5,
                        reg_alpha=0.1,
                        reg_lambda=1.0,
                        objective="reg:squarederror",
                        random_state=42,
                        n_jobs=-1,
                        verbosity=0,
                    ),
                ),
            ]
        ),
    }


def get_positive_probability(model: Pipeline, x_val):
    if hasattr(model, "predict_proba"):
        proba = model.predict_proba(x_val)
        if proba.shape[1] == 2:
            return proba[:, 1]

    if hasattr(model, "decision_function"):
        scores = model.decision_function(x_val)
        return 1 / (1 + np.exp(-scores))

    return model.predict(x_val)


def classification_metrics(y_true, pred_labels, pred_prob) -> dict:
    payload = {
        "accuracy": float(accuracy_score(y_true, pred_labels)),
        "precision": float(precision_score(y_true, pred_labels, zero_division=0)),
        "recall": float(recall_score(y_true, pred_labels, zero_division=0)),
        "f1": float(f1_score(y_true, pred_labels, zero_division=0)),
        "positive_rate_true": float(np.mean(y_true)),
        "positive_rate_pred": float(np.mean(pred_labels)),
    }

    try:
        payload["roc_auc"] = float(roc_auc_score(y_true, pred_prob))
    except ValueError:
        payload["roc_auc"] = None

    return payload


def regression_metrics(y_true, preds) -> dict:
    preds = np.clip(preds, 0, 90)
    rmse = float(np.sqrt(mean_squared_error(y_true, preds)))

    def bucket(m: float) -> int:
        if m < 30:
            return 0
        if m < 60:
            return 1
        return 2

    actual_buckets = np.array([bucket(float(m)) for m in y_true.to_numpy()])
    pred_buckets = np.array([bucket(float(m)) for m in preds])

    return {
        "mae": float(mean_absolute_error(y_true, preds)),
        "rmse": rmse,
        "bucket_accuracy": float(np.mean(actual_buckets == pred_buckets)),
        "avg_actual_minutes": float(np.mean(y_true)),
        "avg_predicted_minutes": float(np.mean(preds)),
    }


def train_played_classifier(train_df, val_df) -> None:
    x_train, y_train, x_val, y_val = get_xy(train_df, val_df, TARGET_PLAYED)

    y_train = y_train.astype(int)
    y_val = y_val.astype(int)

    candidates = build_classifier_candidates()
    results = {}

    best_name = None
    best_model = None
    best_score = -1.0

    for name, model in candidates.items():
        logger.info("Training %s...", name)
        model.fit(x_train, y_train)

        pred_prob = get_positive_probability(model, x_val)
        pred_labels = (pred_prob >= 0.5).astype(int)

        metrics = classification_metrics(y_val, pred_labels, pred_prob)
        results[name] = metrics

        score = metrics["f1"]

        logger.info(
            "%s | F1=%.4f | ACC=%.4f | ROC_AUC=%s",
            name,
            metrics["f1"],
            metrics["accuracy"],
            metrics.get("roc_auc"),
        )

        if score > best_score:
            best_score = score
            best_name = name
            best_model = model

    if best_model is None or best_name is None:
        raise RuntimeError("No played classifier was trained.")

    importance = feature_importance_report(best_model)

    save_model_with_meta(
        model=best_model,
        model_filename="played_classifier.joblib",
        meta_filename="played_classifier_meta.json",
        meta_payload={
            "model_version": PLAYED_MODEL_VERSION,
            "best_model": best_name,
            "target": TARGET_PLAYED,
            "feature_cols": FEATURE_COLS,
            "trained_rows": len(x_train),
            "validation_rows": len(x_val),
            "validation_metrics": results[best_name],
            "feature_importance": importance[:20],
        },
    )

    write_json(
        settings.reports_dir / "played_classifier_report.json",
        {
            "model_version": PLAYED_MODEL_VERSION,
            "target": TARGET_PLAYED,
            "best_model": best_name,
            "best_metric": "f1",
            "models": results,
            "feature_importance": importance,
        },
    )


def train_minutes_regressor(train_df, val_df) -> None:
    x_train, y_train, x_val, y_val = get_xy(train_df, val_df, TARGET_MINUTES)

    y_train = y_train.astype(float)
    y_val = y_val.astype(float)

    candidates = build_minutes_candidates()
    results = {}

    best_name = None
    best_model = None
    best_mae = float("inf")

    for name, model in candidates.items():
        logger.info("Training %s...", name)
        model.fit(x_train, y_train)

        preds = np.clip(model.predict(x_val), 0, 90)
        metrics = regression_metrics(y_val, preds)
        results[name] = metrics

        logger.info(
            "%s | MAE=%.4f mins | RMSE=%.4f | bucket_acc=%.4f",
            name,
            metrics["mae"],
            metrics["rmse"],
            metrics["bucket_accuracy"],
        )

        if metrics["mae"] < best_mae:
            best_mae = metrics["mae"]
            best_name = name
            best_model = model

    if best_model is None or best_name is None:
        raise RuntimeError("No minutes regressor was trained.")

    importance = feature_importance_report(best_model)

    save_model_with_meta(
        model=best_model,
        model_filename="minutes_regressor.joblib",
        meta_filename="minutes_regressor_meta.json",
        meta_payload={
            "model_version": MINUTES_MODEL_VERSION,
            "best_model": best_name,
            "target": TARGET_MINUTES,
            "feature_cols": FEATURE_COLS,
            "trained_rows": len(x_train),
            "validation_rows": len(x_val),
            "validation_metrics": results[best_name],
            "feature_importance": importance[:20],
        },
    )

    write_json(
        settings.reports_dir / "minutes_regressor_report.json",
        {
            "model_version": MINUTES_MODEL_VERSION,
            "target": TARGET_MINUTES,
            "best_model": best_name,
            "best_metric": "mae",
            "models": results,
            "feature_importance": importance,
        },
    )


def main() -> None:
    ensure_model_dirs()

    train_df, val_df = load_train_validation()

    logger.info("Training played classifier...")
    train_played_classifier(train_df, val_df)

    logger.info("Training minutes regressor...")
    train_minutes_regressor(train_df, val_df)

    logger.info("Availability/minutes training complete.")


if __name__ == "__main__":
    main()