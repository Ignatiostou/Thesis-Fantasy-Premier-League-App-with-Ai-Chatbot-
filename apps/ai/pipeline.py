"""
Central ML pipeline orchestrator.

Chains the existing stages end-to-end:

    extract  →  build dataset  →  train models  →  validate  →  predict  →  upsert

Usage:
    python pipeline.py --full                     # retrain on everything in the DB,
                                                  # then predict the next unfinished GW
    python pipeline.py --completed-gameweek 24    # GW24 just finished: retrain and
                                                  # generate predictions for GW25
    python pipeline.py --predict-only             # skip retraining, just refresh
                                                  # predictions with the current model
    python pipeline.py --skip-train --completed-gameweek 24
    python pipeline.py --predict-only --target-gameweek 1
                                                  # season boundary: no GW has finished
                                                  # yet this season (so there is nothing
                                                  # to resolve "next GW" from) — predict
                                                  # GW1 directly with the carried-over
                                                  # model from last season

Called by:
    - apps/ai/scripts/backfill_season.py   (initial historical backfill)
    - apps/api/src/jobs/ml-pipeline.scheduler.ts  (automatic 15-min scheduler)

Model safety gate: before retraining, current model artifacts are backed up.
If the freshly trained points model is much worse on validation MAE than the
previous one (>25% regression), the previous artifacts are restored so the
chatbot never silently downgrades.
"""

import argparse
import json
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from config import settings
from logging_utils import get_logger

logger = get_logger("pipeline")

MODEL_FILES = [
    "points_model.joblib", "points_model_meta.json",
    "played_classifier.joblib", "played_classifier_meta.json",
    "minutes_regressor.joblib", "minutes_regressor_meta.json",
]
POINTS_META = "points_model_meta.json"
BACKUP_DIR_NAME = "_previous"
MAX_MAE_REGRESSION = 1.25  # new MAE may be at most 25% worse than the old one


# ── Gameweek resolution ───────────────────────────────────────────────────────

def latest_finished_gameweek() -> int | None:
    """Highest GW that FPL marks finished AND data_checked (stats finalized)."""
    from db import read_sql
    df = read_sql("""
        SELECT MAX(id) AS gw FROM fpl_events
        WHERE finished = TRUE
          AND COALESCE((raw->>'data_checked')::boolean, FALSE) = TRUE
    """)
    if df.empty or df.iloc[0]["gw"] is None:
        return None
    return int(df.iloc[0]["gw"])


def gameweek_exists(gw: int) -> bool:
    from db import read_sql
    df = read_sql("SELECT 1 FROM fpl_events WHERE id = :gw", {"gw": gw})
    return not df.empty


def resolve_target_gameweek(completed_gw: int | None) -> int | None:
    """Returns the GW to predict, or None when the season is over."""
    base = completed_gw if completed_gw is not None else latest_finished_gameweek()
    if base is None:
        logger.warning("No finished+data_checked gameweek found — nothing to predict from.")
        return None
    target = base + 1
    if not gameweek_exists(target):
        logger.info("GW%d is the last gameweek of the season — no next GW to predict. "
                    "Model stays trained and ready for next season.", base)
        return None
    return target


# ── Stages ────────────────────────────────────────────────────────────────────

def stage_extract() -> None:
    logger.info("─── Stage 1/5: extract player GW history (live + archived seasons) ───")
    from data.extract_player_gw_history import extract_with_history, save
    df = extract_with_history()
    if df.empty:
        raise RuntimeError(
            "player_gameweek_stats is empty and no archived seasons were found. "
            "Run scripts/backfill_season.py first (or wait for the scoring "
            "scheduler to sync a finished gameweek)."
        )
    save(df)


def stage_build_dataset() -> None:
    logger.info("─── Stage 2/5: feature engineering + training dataset ───")
    from data.build_training_dataset import main as build_main
    build_main()


def _backup_models() -> Path | None:
    models_dir = settings.models_dir
    if not (models_dir / "points_model.joblib").exists():
        logger.info("No existing model to back up (first training run).")
        return None
    backup_dir = models_dir / BACKUP_DIR_NAME
    backup_dir.mkdir(parents=True, exist_ok=True)
    for name in MODEL_FILES:
        src = models_dir / name
        if src.exists():
            shutil.copy2(src, backup_dir / name)
    logger.info("Backed up current model artifacts to %s", backup_dir)
    return backup_dir


def _read_points_mae(meta_path: Path) -> float | None:
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        return float(meta["validation_metrics"]["mae"])
    except Exception:
        return None


def _read_points_scope(meta_path: Path) -> str | None:
    """Which population the points model was fitted on. Absent on models trained
    before the conditional split, which is itself the signal that the scope
    changed."""
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        return meta.get("target_scope", "all_rows")
    except Exception:
        return None


def _restore_models(backup_dir: Path) -> None:
    for name in MODEL_FILES:
        src = backup_dir / name
        if src.exists():
            shutil.copy2(src, settings.models_dir / name)
    logger.warning("Restored previous model artifacts from %s", backup_dir)


def stage_train() -> None:
    logger.info("─── Stage 3/5: train models (points + availability + minutes) ───")
    backup_dir = _backup_models()
    old_mae = _read_points_mae(settings.models_dir / POINTS_META) if backup_dir else None
    old_scope = _read_points_scope(settings.models_dir / POINTS_META) if backup_dir else None

    from models.train_points_model import main as train_points
    from models.train_availability_model import main as train_availability

    train_points()
    train_availability()

    # ── Validation gate ──────────────────────────────────────────────────────
    new_mae = _read_points_mae(settings.models_dir / POINTS_META)
    new_scope = _read_points_scope(settings.models_dir / POINTS_META)

    if old_scope != new_scope:
        # A played-only model predicts a larger quantity (points given an
        # appearance) than one trained across all rows, so its MAE is naturally
        # higher. Comparing the two would roll back a deliberate improvement.
        logger.warning(
            "Points model target scope changed (%s -> %s) — skipping the MAE gate, "
            "the two are not comparable. New MAE=%.4f",
            old_scope, new_scope, new_mae if new_mae is not None else float("nan"),
        )
    elif old_mae is not None and new_mae is not None:
        logger.info("Model gate: previous MAE=%.4f | new MAE=%.4f", old_mae, new_mae)
        if new_mae > old_mae * MAX_MAE_REGRESSION:
            logger.warning(
                "New points model regressed too much (%.4f > %.4f × %.2f) — rolling back.",
                new_mae, old_mae, MAX_MAE_REGRESSION,
            )
            _restore_models(backup_dir)
        else:
            logger.info("New model accepted.")
    elif new_mae is not None:
        logger.info("New model accepted (no previous model to compare against). MAE=%.4f", new_mae)


def stage_predict(target_gw: int, provisional: bool = False) -> Path:
    logger.info("─── Stage 4/5: predict GW%d ───", target_gw)
    from inference.predict_next_gw import run_inference
    predictions = run_inference(target_gw, provisional=provisional)

    settings.ensure_artifact_dirs()
    out_path = settings.datasets_dir / f"predictions_gw{target_gw}.parquet"
    predictions.to_parquet(out_path, index=False)
    logger.info("Predictions saved to %s", out_path)
    return out_path


def stage_upsert(target_gw: int) -> None:
    logger.info("─── Stage 5/5: store GW%d predictions in database ───", target_gw)
    import pandas as pd
    from exports.upsert_predictions_to_db import upsert_predictions

    pred_path = settings.datasets_dir / f"predictions_gw{target_gw}.parquet"
    predictions = pd.read_parquet(pred_path)
    upsert_predictions(predictions)


# ── Entry point ───────────────────────────────────────────────────────────────

def run(completed_gameweek: int | None = None,
        skip_train: bool = False,
        predict_only: bool = False,
        target_gameweek: int | None = None) -> None:
    from db import dispose

    try:
        if not predict_only:
            stage_extract()
            stage_build_dataset()
            if not skip_train:
                stage_train()

        if target_gameweek is not None:
            # Explicit target — bypasses "latest finished GW + 1" resolution.
            # Needed at a season boundary: GW1 has no prior finished gameweek
            # to resolve from, yet it still needs predictions from whatever
            # model was carried over from last season.
            if not gameweek_exists(target_gameweek):
                logger.warning("Target GW%d does not exist in fpl_events — nothing to predict.",
                               target_gameweek)
                return
            target_gw = target_gameweek
        else:
            target_gw = resolve_target_gameweek(completed_gameweek)
            if target_gw is None:
                logger.info("Pipeline finished (training only — no upcoming gameweek).")
                return

        stage_predict(target_gw, provisional=predict_only)
        stage_upsert(target_gw)
        logger.info("Pipeline complete — predictions for GW%d are live for the chatbot.", target_gw)
    finally:
        dispose()
        try:
            from db_writer import dispose as dispose_writer
            dispose_writer()
        except Exception:
            pass


def main() -> None:
    parser = argparse.ArgumentParser(description="FPL ML pipeline orchestrator")
    parser.add_argument("--completed-gameweek", type=int, default=None,
                        help="Gameweek that just finished; predictions target the next one")
    parser.add_argument("--full", action="store_true",
                        help="Full run on all data currently in the DB (default behaviour)")
    parser.add_argument("--skip-train", action="store_true",
                        help="Rebuild dataset but reuse the current model")
    parser.add_argument("--predict-only", action="store_true",
                        help="Only run inference + DB upsert with the current model")
    parser.add_argument("--target-gameweek", type=int, default=None,
                        help="Predict this exact gameweek directly, bypassing "
                             "completed-GW resolution. For the season boundary, "
                             "where no GW has finished yet so there is no 'next GW' "
                             "to resolve from.")
    args = parser.parse_args()

    run(
        completed_gameweek=args.completed_gameweek,
        skip_train=args.skip_train,
        predict_only=args.predict_only,
        target_gameweek=args.target_gameweek,
    )


if __name__ == "__main__":
    main()
