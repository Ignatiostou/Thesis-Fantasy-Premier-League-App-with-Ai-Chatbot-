import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
import pandas as pd
import numpy as np
from features.player_features import build_features
from constants import FEATURE_COLS


# ── Fixtures ──────────────────────────────────────────────────────────────────

def make_raw_df(
    n_players: int = 3,
    n_gameweeks: int = 10,
) -> pd.DataFrame:
    """Creates a minimal raw DataFrame that mimics extract_player_gw_history output."""
    rows = []
    for pid in range(1, n_players + 1):
        for gw in range(1, n_gameweeks + 1):
            rows.append({
                "player_id":           pid,
                "web_name":            f"Player{pid}",
                "team_id":             pid,
                "team_short_name":     f"T{pid}",
                "position":            (pid % 4) + 1,  # cycles 2, 3, 4, 1
                "now_cost":            75 + pid * 5,
                "status":              "a",
                "selected_by_percent": 10.0 + pid,
                "form":                float(gw % 5),
                "gameweek":            gw,
                "minutes":             90 if gw % 4 != 0 else 0,
                "total_points":        gw % 7 + pid,
                "goals_scored":        1 if gw % 5 == 0 else 0,
                "assists":             1 if gw % 6 == 0 else 0,
                "clean_sheets":        gw % 3 == 0,
                "goals_conceded":      0,
                "own_goals":           0,
                "penalties_saved":     0,
                "penalties_missed":    0,
                "yellow_cards":        0,
                "red_cards":           0,
                "saves":               0,
                "bonus":               gw % 3,
                "bps":                 20,
                "influence":           float(gw * 2),
                "creativity":          float(gw * 1.5),
                "threat":              float(gw * 3),
                "ict_index":           float(gw * 4),
                "fixture_fdr":         (gw % 5) + 1,
                "was_home":            gw % 2 == 0,
            })
    return pd.DataFrame(rows)


# ── Tests ─────────────────────────────────────────────────────────────────────

class TestBuildFeatures:

    def test_all_feature_cols_present(self):
        """build_features must produce every column in FEATURE_COLS."""
        raw = make_raw_df()
        featured = build_features(raw)
        missing = [c for c in FEATURE_COLS if c not in featured.columns]
        assert missing == [], f"Missing feature columns: {missing}"

    def test_no_nan_in_feature_cols(self):
        """No NaN values should remain in any FEATURE_COLS after build_features."""
        raw = make_raw_df()
        featured = build_features(raw)
        nan_counts = featured[FEATURE_COLS].isna().sum()
        nan_cols   = nan_counts[nan_counts > 0].to_dict()
        assert nan_cols == {}, f"NaN found in feature columns: {nan_cols}"

    def test_row_count_preserved(self):
        """build_features must not drop or duplicate rows."""
        raw      = make_raw_df(n_players=5, n_gameweeks=8)
        featured = build_features(raw)
        assert len(featured) == len(raw)

    def test_pts_last_1gw_is_shifted(self):
        """pts_last_1gw for GW2 should equal the total_points raw value from GW1."""
        raw      = make_raw_df(n_players=1, n_gameweeks=5)
        featured = build_features(raw)
        p        = featured[featured["player_id"] == 1].sort_values("gameweek")

        # GW1 has no previous GW — should be 0
        assert p.iloc[0]["pts_last_1gw"] == 0.0

        # GW2's pts_last_1gw should equal original GW1 total_points in raw
        gw1_pts = raw[(raw["player_id"] == 1) & (raw["gameweek"] == 1)]["total_points"].iloc[0]
        assert p.iloc[1]["pts_last_1gw"] == float(gw1_pts)

    def test_rolling_features_dont_leak_future(self):
        """Rolling features must only look backward — not forward."""
        raw = make_raw_df(n_players=2, n_gameweeks=10)
        featured = build_features(raw)

        # Manually compute what pts_last_3gw_avg should be for player 1, GW6
        # It should be avg of GW3, GW4, GW5 points
        p1_raw = raw[raw["player_id"] == 1].sort_values("gameweek")["total_points"].values
        expected_gw6_avg = np.mean(p1_raw[2:5])  # GW3=index2, GW4=index3, GW5=index4

        actual = featured[
            (featured["player_id"] == 1) & (featured["gameweek"] == 6)
        ]["pts_last_3gw_avg"].iloc[0]

        assert abs(actual - expected_gw6_avg) < 0.01, (
            f"Expected {expected_gw6_avg:.3f}, got {actual:.3f}"
        )

    def test_chance_of_playing_availability_mapping(self):
        """Players with status 'a' should have chance_of_playing = 100."""
        raw = make_raw_df(n_players=1, n_gameweeks=3)
        raw["status"] = "a"
        featured = build_features(raw)
        assert (featured["chance_of_playing"] == 100.0).all()

    def test_injured_player_chance_is_zero(self):
        """Players with status 'i' should have chance_of_playing = 0."""
        raw = make_raw_df(n_players=1, n_gameweeks=3)
        raw["status"] = "i"
        # Remove chance_of_playing column if present so the mapper runs
        if "chance_of_playing" in raw.columns:
            raw = raw.drop(columns=["chance_of_playing"])
        featured = build_features(raw)
        assert (featured["chance_of_playing"] == 0.0).all()

    def test_position_is_integer(self):
        """position column must be integer type after feature engineering."""
        raw      = make_raw_df()
        featured = build_features(raw)
        assert featured["position"].dtype in (int, "int64", "int32")

    def test_fixture_features_neutral_fdr_when_missing(self):
        """If fixture_fdr is null, features should default to FDR_NEUTRAL (3)."""
        raw = make_raw_df(n_players=1, n_gameweeks=5)
        raw["fixture_fdr"] = None
        featured = build_features(raw)
        assert (featured["avg_fdr_next3"] == 3.0).all()