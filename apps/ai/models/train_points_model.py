import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import numpy as np
from sklearn.ensemble import (
    RandomForestRegressor,
    GradientBoostingRegressor,
    HistGradientBoostingRegressor,
)
from sklearn.impute import SimpleImputer
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.pipeline import Pipeline
from xgboost import XGBRegressor

from config import settings
from constants import TARGET_POINTS, TARGET_PLAYED, FEATURE_COLS

# The points model answers "how many points if he appears", not "how many points
# in expectation". Roughly 70% of player-gameweeks are non-appearances scoring
# ~0.15, so training across all rows dragged every prediction toward that mass:
# real starters were predicted 2.47 against an actual 3.48, and the model never
# output above 7.0 when reality reaches 18.
#
# The unconditional value is reassembled at inference as
#     E[points] = P(appears) x E[points | appears]
# using the played classifier for the first term. Both terms condition on the
# same event — appearing for at least MIN_MINUTES_PLAYED — so the product is
# coherent.
TARGET_SCOPE = "played_only"
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

MODEL_VERSION = "points_hybrid_v1"


def build_candidates() -> dict[str, Pipeline]:
    return {
        "random_forest_points": Pipeline(
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
        "gradient_boosting_points": Pipeline(
            steps=[
                ("imputer", SimpleImputer(strategy="median")),
                (
                    "model",
                    GradientBoostingRegressor(
                        n_estimators=250,
                        learning_rate=0.04,
                        max_depth=3,
                        random_state=42,
                    ),
                ),
            ]
        ),
        "hist_gradient_boosting_points": Pipeline(
            steps=[
                ("imputer", SimpleImputer(strategy="median")),
                (
                    "model",
                    HistGradientBoostingRegressor(
                        max_iter=300,
                        learning_rate=0.04,
                        max_leaf_nodes=31,
                        random_state=42,
                    ),
                ),
            ]
        ),
        "xgboost_points": Pipeline(
            steps=[
                ("imputer", SimpleImputer(strategy="median")),
                (
                    "model",
                    XGBRegressor(
                        n_estimators=400,
                        max_depth=5,
                        learning_rate=0.05,
                        subsample=0.8,
                        colsample_bytree=0.8,
                        min_child_weight=3,
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


def regression_metrics(y_true, y_pred) -> dict:
    rmse = float(np.sqrt(mean_squared_error(y_true, y_pred)))
    errors = y_pred - y_true.to_numpy()

    return {
        "mae": float(mean_absolute_error(y_true, y_pred)),
        "rmse": rmse,
        "r2": float(r2_score(y_true, y_pred)),
        "pct_within_1pt": float(np.mean(np.abs(errors) <= 1.0) * 100),
        "pct_within_2pt": float(np.mean(np.abs(errors) <= 2.0) * 100),
        "pct_within_3pt": float(np.mean(np.abs(errors) <= 3.0) * 100),
        "prediction_mean": float(np.mean(y_pred)),
        "prediction_std": float(np.std(y_pred)),
        "target_mean": float(np.mean(y_true)),
        "target_std": float(np.std(y_true)),
    }


def main() -> None:
    ensure_model_dirs()

    train_df, val_df = load_train_validation()

    # Restrict to appearances — see TARGET_SCOPE above.
    n_before = (len(train_df), len(val_df))
    train_df = train_df[train_df[TARGET_PLAYED] == 1]
    val_df = val_df[val_df[TARGET_PLAYED] == 1]
    logger.info(
        "Conditional target: kept appearances only — train %d/%d, val %d/%d rows",
        len(train_df), n_before[0], len(val_df), n_before[1],
    )

    x_train, y_train, x_val, y_val = get_xy(train_df, val_df, TARGET_POINTS)

    logger.info(
        "Training points models | train=%s | val=%s | features=%s | target mean=%.2f",
        len(x_train),
        len(x_val),
        len(FEATURE_COLS),
        float(y_train.mean()),
    )

    candidates = build_candidates()
    results = {}

    best_name = None
    best_model = None
    best_mae = float("inf")

    for name, model in candidates.items():
        logger.info("Training %s...", name)
        model.fit(x_train, y_train)

        preds = np.clip(model.predict(x_val), 0, None)
        metrics = regression_metrics(y_val, preds)
        results[name] = metrics

        logger.info(
            "%s | MAE=%.4f | RMSE=%.4f | R2=%.4f",
            name,
            metrics["mae"],
            metrics["rmse"],
            metrics["r2"],
        )

        if metrics["mae"] < best_mae:
            best_mae = metrics["mae"]
            best_name = name
            best_model = model

    if best_model is None or best_name is None:
        raise RuntimeError("No points model was trained.")

    importance = feature_importance_report(best_model)

    report = {
        "model_version": MODEL_VERSION,
        "target": TARGET_POINTS,
        "best_model": best_name,
        "best_metric": "mae",
        "best_mae": best_mae,
        "train_rows": len(x_train),
        "validation_rows": len(x_val),
        "feature_columns": FEATURE_COLS,
        "models": results,
        "feature_importance": importance,
    }

    save_model_with_meta(
        model=best_model,
        model_filename="points_model.joblib",
        meta_filename="points_model_meta.json",
        meta_payload={
            "model_version": MODEL_VERSION,
            "best_model": best_name,
            "target": TARGET_POINTS,
            # Marks the prediction as conditional on appearing. The pipeline's
            # safety gate keys off this: MAE from a played-only model is not
            # comparable with one trained across all rows.
            "target_scope": TARGET_SCOPE,
            "feature_cols": FEATURE_COLS,
            "trained_rows": len(x_train),
            "validation_rows": len(x_val),
            "validation_metrics": results[best_name],
            "feature_importance": importance[:20],
        },
    )

    write_json(settings.reports_dir / "points_model_report.json", report)

    logger.info("Best points model: %s", best_name)
    logger.info("Saved points model and metadata.")


if __name__ == "__main__":
    main()