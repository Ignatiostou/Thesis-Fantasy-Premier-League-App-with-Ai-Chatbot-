import pandas as pd
import numpy as np
from constants import FEATURE_COLS, FDR_NEUTRAL
from logging_utils import get_logger

logger = get_logger(__name__)


# ── Rolling window helper ─────────────────────────────────────────────────────

def _rolling(
    series: pd.Series,
    window: int,
    func: str = "mean",
    min_periods: int = 1,
) -> pd.Series:
    """
    Per-player rolling aggregate — expects series already grouped by player.
    `func` can be 'mean', 'std', 'sum'.
    Shift(1) ensures we never use the current GW's value to predict itself.
    """
    shifted = series.shift(1)
    roller  = shifted.rolling(window=window, min_periods=min_periods)
    if func == "mean":
        return roller.mean()
    if func == "std":
        return roller.std().fillna(0)
    if func == "sum":
        return roller.sum()
    raise ValueError(f"Unknown rolling func: {func}")


# ── Step 0: preserve raw per-GW points ───────────────────────────────────────

def _preserve_raw_gw_points(df: pd.DataFrame) -> pd.DataFrame:
    """
    Saves a clean copy of raw per-GW total_points as "gw_points".
    MUST be called first — before _add_cumulative_season_features overwrites
    "total_points" with the cumulative season total.

    "gw_points" is used by:
      - _add_rolling_points_features  (rolling averages of per-GW scores)
      - _add_cumulative_season_features (source for season_total_pts)
      - build_training_dataset.attach_targets (source for TARGET_POINTS)
    """
    df["gw_points"] = df["total_points"].astype(float)
    return df


# ── Individual feature builders ───────────────────────────────────────────────

def _add_rolling_points_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    pts_last_1gw, pts_last_3gw_avg, pts_last_5gw_avg, pts_last_5gw_std
    All shifted by 1 so we're using past GWs only.
    Uses "gw_points" (raw per-GW) not "total_points" (cumulative after step 5).
    """
    g = df.groupby("player_id")["gw_points"]

    df["pts_last_1gw"]     = g.shift(1).fillna(0)
    df["pts_last_3gw_avg"] = g.transform(
        lambda s: _rolling(s, window=3)
    ).fillna(0)
    df["pts_last_5gw_avg"] = g.transform(
        lambda s: _rolling(s, window=5)
    ).fillna(0)
    df["pts_last_5gw_std"] = g.transform(
        lambda s: _rolling(s, window=5, func="std")
    ).fillna(0)

    return df


def _add_rolling_minutes_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    minutes_last_3gw_avg, minutes_last_5gw_avg
    Key inputs for the availability model.
    """
    g = df.groupby("player_id")["minutes"]

    df["minutes_last_3gw_avg"] = g.transform(
        lambda s: _rolling(s, window=3)
    ).fillna(0)
    df["minutes_last_5gw_avg"] = g.transform(
        lambda s: _rolling(s, window=5)
    ).fillna(0)

    return df


def _add_rolling_ict_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    ict_index_avg, threat_avg, creativity_avg, influence_avg
    Rolling 5-GW averages of attacking involvement metrics.
    """
    for col, out in [
        ("ict_index",  "ict_index_avg"),
        ("threat",     "threat_avg"),
        ("creativity", "creativity_avg"),
        ("influence",  "influence_avg"),
    ]:
        if col in df.columns:
            df[out] = df.groupby("player_id")[col].transform(
                lambda s: _rolling(s, window=5)
            ).fillna(0)
        else:
            logger.warning(f"Column '{col}' not found — filling {out} with 0")
            df[out] = 0.0

    return df


def _add_fixture_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    next_gw_fdr, avg_fdr_next3, is_home_next_gw

    For training data: we use the NEXT row's fixture_fdr as the "next GW fixture".
    Shift(-1) within each player group gives us the fixture they'll face next.
    For inference, these columns are injected by predict_next_gw.py directly.
    """
    g_fdr  = df.groupby("player_id")["fixture_fdr"]
    g_home = df.groupby("player_id")["was_home"]

    df["next_gw_fdr"] = g_fdr.shift(-1).fillna(FDR_NEUTRAL).astype(float)
    df["is_home_next_gw"] = g_home.shift(-1).fillna(False).astype(float)

    df["avg_fdr_next3"] = (
        df.groupby("player_id")["fixture_fdr"]
        .transform(
            lambda s: s.shift(-1).rolling(window=3, min_periods=1).mean()
        )
        .fillna(FDR_NEUTRAL)
        .astype(float)
    )

    return df


def _add_cumulative_season_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Cumulative season totals up to (but NOT including) the current GW.
    goals_scored, assists, clean_sheets, bonus — all shifted by 1.

    IMPORTANT: writes to "season_total_pts" not "total_points".
    Overwriting "total_points" here was the root cause of the leakage bug —
    attach_targets would then shift the cumulative total as the points target
    instead of the raw per-GW score.
    """
    for col in ["goals_scored", "assists", "clean_sheets", "bonus"]:
        if col in df.columns:
            df[col] = (
                df.groupby("player_id")[col]
                .transform(lambda s: s.shift(1).cumsum())
                .fillna(0)
                .astype(float)
            )
        else:
            logger.warning(f"Column '{col}' missing — filling with 0")
            df[col] = 0.0

    # Use "gw_points" (raw) as source — writes to new column "season_total_pts"
    df["season_total_pts"] = (
        df.groupby("player_id")["gw_points"]
        .transform(lambda s: s.shift(1).cumsum())
        .fillna(0)
        .astype(float)
    )

    return df


def _add_pts_per_game(df: pd.DataFrame) -> pd.DataFrame:
    """
    pts_per_game = season_total_pts / games_played

    Better quality signal than raw season total. Normalises for games played,
    so a player who has played fewer games is not unfairly penalised.
    Must run after _add_cumulative_season_features.
    """
    # games_played = GWs where the player had > 0 minutes, cumulative, shifted
    df["_games_played"] = (
        df.groupby("player_id")["minutes"]
        .transform(lambda s: (s.shift(1) > 0).cumsum())
        .fillna(0)
    )

    # Clip lower=1 to avoid division by zero for players with no prior games
    df["pts_per_game"] = (
        df["season_total_pts"] / df["_games_played"].clip(lower=1)
    ).fillna(0).round(3)

    df = df.drop(columns=["_games_played"])
    return df


def _add_availability_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    chance_of_playing: numeric 0-100 derived from status.
    The DB has chanceOfPlayingNextRound but it's not always set.
    We map status to a sensible default if missing.
    """
    STATUS_CHANCE = {
        "a": 100.0,
        "d": 50.0,
        "i": 0.0,
        "s": 0.0,
        "u": 0.0,
    }

    if "chance_of_playing" not in df.columns:
        df["chance_of_playing"] = (
            df["status"].map(STATUS_CHANCE).fillna(75.0)
        )
    else:
        df["chance_of_playing"] = df["chance_of_playing"].fillna(
            df["status"].map(STATUS_CHANCE).fillna(75.0)
        )

    return df


def _add_form_feature(df: pd.DataFrame) -> pd.DataFrame:
    """
    form: FPL's own form score (rolling 5-GW avg pts from the API).
    If it's missing for some reason, fall back to our own pts_last_5gw_avg.
    """
    if "form" in df.columns:
        df["form"] = df["form"].fillna(df.get("pts_last_5gw_avg", 0)).astype(float)
    else:
        df["form"] = df.get("pts_last_5gw_avg", 0).astype(float)
    return df


def _add_metadata_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    position, now_cost, selected_by_percent — pass-through with type enforcement.
    """
    df["position"]            = df["position"].astype(int)
    df["now_cost"]            = df["now_cost"].astype(float)
    df["selected_by_percent"] = df["selected_by_percent"].fillna(0).astype(float)
    return df


# ── Master builder ────────────────────────────────────────────────────────────

def build_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Takes the raw extracted DataFrame and returns it with all FEATURE_COLS added.

    Call this on the raw extract before attaching targets.
    Order of operations matters — some features depend on others.
    """
    logger.info(f"Building features for {len(df):,} rows, {df['player_id'].nunique()} players...")

    # Ensure sorted — rolling computations require chronological order per player
    df = df.sort_values(["player_id", "gameweek"]).copy()

    # 0. Preserve raw per-GW points FIRST — before anything overwrites total_points
    df = _preserve_raw_gw_points(df)

    # 1. Availability (needed before form fallback)
    df = _add_availability_features(df)

    # 2. Rolling points — uses gw_points (raw), must run before cumulative step
    df = _add_rolling_points_features(df)

    # 3. Rolling minutes
    df = _add_rolling_minutes_features(df)

    # 4. Rolling ICT/threat/creativity/influence
    df = _add_rolling_ict_features(df)

    # 5. Cumulative season totals — writes to season_total_pts, NOT total_points
    df = _add_cumulative_season_features(df)

    # 6. pts_per_game — depends on season_total_pts from step 5
    df = _add_pts_per_game(df)

    # 7. Fixture features
    df = _add_fixture_features(df)

    # 8. Form (uses pts_last_5gw_avg as fallback if FPL form missing)
    df = _add_form_feature(df)

    # 9. Metadata pass-through
    df = _add_metadata_features(df)

    # ── Final validation ──────────────────────────────────────────────────────
    missing = [c for c in FEATURE_COLS if c not in df.columns]
    if missing:
        raise ValueError(f"Feature engineering failed — missing columns: {missing}")

    nan_counts = df[FEATURE_COLS].isna().sum()
    nan_cols   = nan_counts[nan_counts > 0]
    if not nan_cols.empty:
        logger.warning(f"NaN values remaining in features (will be filled with 0):\n{nan_cols}")
        df[FEATURE_COLS] = df[FEATURE_COLS].fillna(0)

    logger.info(
        f"Feature engineering complete: {len(FEATURE_COLS)} features, "
        f"{len(df):,} rows, 0 NaN values in feature columns"
    )
    return df