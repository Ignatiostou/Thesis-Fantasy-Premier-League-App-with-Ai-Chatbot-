import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

import pandas as pd
import numpy as np
from config import settings
from constants import (
    FEATURE_COLS,
    TARGET_POINTS, TARGET_MINUTES, TARGET_PLAYED,
    MIN_MINUTES_PLAYED,
)
from features.player_features import build_features
from logging_utils import get_logger

logger = get_logger(__name__)

# Temporal split: last N gameweeks go to validation
VALIDATION_GW_COUNT = 5


def attach_targets(df: pd.DataFrame) -> pd.DataFrame:
    """
    For each player × GW row, attach the NEXT GW's stats as targets.
    Rows for the last GW a player appears in have no next GW — these are dropped
    from training (but kept for inference).

    Uses "gw_points" (raw per-GW score preserved by _preserve_raw_gw_points)
    as the source for TARGET_POINTS — NOT "total_points" which is cumulative
    after feature engineering runs.
    """
    df = df.sort_values(["player_id", "gameweek"]).copy()

    # KEY FIX: shift "gw_points" (raw per-GW) not "total_points" (cumulative)
    df[TARGET_POINTS] = (
        df.groupby("player_id")["gw_points"].shift(-1)
    )
    df[TARGET_MINUTES] = (
        df.groupby("player_id")["minutes"].shift(-1)
    )
    df[TARGET_PLAYED] = (
        df[TARGET_MINUTES] >= MIN_MINUTES_PLAYED
    ).astype(float)

    n_total = len(df)
    n_with  = df[TARGET_POINTS].notna().sum()
    logger.info(f"Target attachment: {n_with:,}/{n_total:,} rows have next-GW target")

    # Sanity check: target should be per-GW points (0–25 range), not cumulative (0–300)
    if df[TARGET_POINTS].notna().any():
        tgt_max  = df[TARGET_POINTS].max()
        tgt_mean = df[TARGET_POINTS].mean()
        logger.info(
            f"Target sanity — mean: {tgt_mean:.2f}, max: {tgt_max:.1f} "
            f"(expected mean ~3-5, max ~20-25)"
        )
        if tgt_max > 50:
            logger.warning(
                f"TARGET_POINTS max is {tgt_max:.1f} — this looks like cumulative "
                f"totals, not per-GW points. Check that gw_points was preserved "
                f"correctly in player_features._preserve_raw_gw_points()."
            )

    return df


def filter_minimum_history(df: pd.DataFrame) -> pd.DataFrame:
    """
    Drop rows where the player has fewer than MIN_GW_HISTORY appearances.
    These players don't have enough history for rolling features to be reliable.
    """
    gw_counts = df.groupby("player_id")["gameweek"].count()
    valid_ids  = gw_counts[gw_counts >= settings.min_gw_history].index
    before = len(df)
    df     = df[df["player_id"].isin(valid_ids)]
    logger.info(
        f"Min history filter: kept {len(df):,}/{before:,} rows "
        f"({df['player_id'].nunique()} players with ≥{settings.min_gw_history} GWs)"
    )
    return df


def temporal_split(
    df: pd.DataFrame,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """
    Splits by gameweek — last VALIDATION_GW_COUNT GWs go to validation.
    This is CRITICAL for time-series data: never use random splits for FPL data
    as it would leak future information into training.
    """
    max_gw    = df["gameweek"].max()
    val_start = max_gw - VALIDATION_GW_COUNT + 1

    train_df = df[df["gameweek"] < val_start].copy()
    val_df   = df[df["gameweek"] >= val_start].copy()

    logger.info(
        f"Temporal split: train GW1-{val_start - 1} ({len(train_df):,} rows) | "
        f"val GW{val_start}-{max_gw} ({len(val_df):,} rows)"
    )
    return train_df, val_df


def build_dataset() -> tuple[pd.DataFrame, pd.DataFrame]:
    # ── Load raw data ─────────────────────────────────────────────────────────
    raw_path = settings.datasets_dir / "player_gw_history.parquet"
    if not raw_path.exists():
        raise FileNotFoundError(
            f"Raw data not found at {raw_path}. "
            f"Run data/extract_player_gw_history.py first."
        )

    logger.info(f"Loading raw data from {raw_path}")
    raw = pd.read_parquet(raw_path)
    logger.info(f"Loaded {len(raw):,} rows")

    # ── Feature engineering ───────────────────────────────────────────────────
    logger.info("Building features...")
    featured = build_features(raw)
    logger.info(f"Features built: {featured.shape[1]} columns, {len(featured):,} rows")

    # ── Attach targets ────────────────────────────────────────────────────────
    featured = attach_targets(featured)

    # ── Filter minimum history ────────────────────────────────────────────────
    featured = filter_minimum_history(featured)

    # ── Drop rows without targets (last GW per player) ────────────────────────
    # These rows are kept for inference but removed from training
    train_ready = featured.dropna(subset=[TARGET_POINTS]).copy()
    logger.info(f"After dropping no-target rows: {len(train_ready):,}")

    # ── Validate feature columns are all present ──────────────────────────────
    missing_feats = [f for f in FEATURE_COLS if f not in train_ready.columns]
    if missing_feats:
        raise ValueError(f"Missing feature columns: {missing_feats}")

    # ── Temporal split ────────────────────────────────────────────────────────
    train_df, val_df = temporal_split(train_ready)

    return train_df, val_df


def main() -> None:
    settings.ensure_artifact_dirs()

    train_df, val_df = build_dataset()

    train_path = settings.datasets_dir / "training_dataset.parquet"
    val_path   = settings.datasets_dir / "validation_dataset.parquet"

    train_df.to_parquet(train_path, index=False)
    val_df.to_parquet(val_path, index=False)

    logger.info(f"Training set saved:   {train_path}  ({len(train_df):,} rows)")
    logger.info(f"Validation set saved: {val_path}  ({len(val_df):,} rows)")

    # Quick summary stats
    logger.info(
        f"Target stats (training) — "
        f"mean pts: {train_df[TARGET_POINTS].mean():.2f}, "
        f"std: {train_df[TARGET_POINTS].std():.2f}, "
        f"played%: {train_df[TARGET_PLAYED].mean() * 100:.1f}%"
    )


if __name__ == "__main__":
    main()