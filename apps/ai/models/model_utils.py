import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).parent.parent))

import joblib
import numpy as np
import pandas as pd

from config import settings
from constants import FEATURE_COLS


def ensure_model_dirs() -> None:
    settings.ensure_artifact_dirs()


def load_train_validation() -> tuple[pd.DataFrame, pd.DataFrame]:
    train_path = settings.datasets_dir / "training_dataset.parquet"
    val_path = settings.datasets_dir / "validation_dataset.parquet"

    if not train_path.exists():
        raise FileNotFoundError(f"Missing training dataset: {train_path}")
    if not val_path.exists():
        raise FileNotFoundError(f"Missing validation dataset: {val_path}")

    return pd.read_parquet(train_path), pd.read_parquet(val_path)


def get_xy(
    train_df: pd.DataFrame,
    val_df: pd.DataFrame,
    target_col: str,
) -> tuple[pd.DataFrame, pd.Series, pd.DataFrame, pd.Series]:
    train_ready = train_df.dropna(subset=[target_col]).copy()
    val_ready = val_df.dropna(subset=[target_col]).copy()

    missing_train = [c for c in FEATURE_COLS if c not in train_ready.columns]
    missing_val = [c for c in FEATURE_COLS if c not in val_ready.columns]

    if missing_train:
        raise ValueError(f"Training dataset missing features: {missing_train}")
    if missing_val:
        raise ValueError(f"Validation dataset missing features: {missing_val}")

    x_train = train_ready[FEATURE_COLS].astype(float)
    y_train = train_ready[target_col]

    x_val = val_ready[FEATURE_COLS].astype(float)
    y_val = val_ready[target_col]

    return x_train, y_train, x_val, y_val


def to_jsonable(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(k): to_jsonable(v) for k, v in value.items()}
    if isinstance(value, list):
        return [to_jsonable(v) for v in value]
    if isinstance(value, tuple):
        return [to_jsonable(v) for v in value]
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, np.floating):
        return float(value)
    return value


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(to_jsonable(payload), indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


def save_model(path: Path, model: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, path)


def load_model(path: Path) -> Any:
    return joblib.load(path)


def get_estimator(model: Any) -> Any:
    if hasattr(model, "named_steps"):
        return model.named_steps.get("model", model)
    return model


def feature_importance_report(model: Any) -> list[dict[str, Any]]:
    estimator = get_estimator(model)

    if not hasattr(estimator, "feature_importances_"):
        return []

    importances = estimator.feature_importances_

    rows = [
        {"feature": feature, "importance": float(importance)}
        for feature, importance in zip(FEATURE_COLS, importances)
    ]

    return sorted(rows, key=lambda x: x["importance"], reverse=True)


def save_model_with_meta(
    model: Any,
    model_filename: str,
    meta_filename: str,
    meta_payload: dict[str, Any],
) -> None:
    model_path = settings.models_dir / model_filename
    meta_path = settings.models_dir / meta_filename

    save_model(model_path, model)
    write_json(meta_path, meta_payload)