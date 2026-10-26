"""
Regression coverage for the cross-season history merge built this session:

  - extract_with_history() merges live current-season rows with archived
    prior seasons (written by scripts/rollover_season.py) instead of training
    going in blind at every season boundary.
  - The merge must skip an archive that's still tagged as the *current*
    season (the guard that prevents double-counting live rows if
    CURRENT_SEASON in constants.py hasn't been bumped yet).
  - Rolling-window features (pts_last_1gw etc.) must bridge the season
    boundary correctly instead of resetting to zero at the new season's GW1.
  - temporal_split's validation window must be picked by true chronological
    order, not by raw "gameweek" number (which resets to 1 every season).

Uses a small synthetic archive via tmp_path/monkeypatch rather than the real
artifacts/datasets/history/ directory — that directory is gitignored (models
and season data can be large), so a fresh checkout or CI run won't have it.
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
import pandas as pd

import data.extract_player_gw_history as ext_mod
from features.player_features import build_features
from data.build_training_dataset import attach_targets, temporal_split
from constants import TARGET_POINTS


# ── Fixtures ──────────────────────────────────────────────────────────────────

def make_row(player_id: int, gameweek: int, total_points: int, minutes: int = 90) -> dict:
    """Mimics extract_player_gw_history.extract()'s output schema for one row."""
    return {
        "player_id":           player_id,
        "web_name":             f"Player{player_id}",
        "team_id":              player_id,
        "team_short_name":      f"T{player_id}",
        "position":             3,
        "now_cost":             75,
        "status":               "a",
        "selected_by_percent":  10.0,
        "form":                 3.0,
        "gameweek":             gameweek,
        "minutes":              minutes,
        "total_points":         total_points,
        "goals_scored":         0,
        "assists":              0,
        "clean_sheets":         False,
        "goals_conceded":       0,
        "own_goals":            0,
        "penalties_saved":      0,
        "penalties_missed":     0,
        "yellow_cards":         0,
        "red_cards":            0,
        "saves":                0,
        "bonus":                0,
        "bps":                  20,
        "influence":            10.0,
        "creativity":           10.0,
        "threat":               10.0,
        "ict_index":            10.0,
        "fixture_fdr":          3,
        "was_home":             True,
    }


PLAYER_IDS = [1, 2, 3]
PRIOR_SEASON_GWS = 5  # small on purpose — enough to exercise rolling windows (max window=5)


def make_prior_season_archive(season: str = "2025-26") -> pd.DataFrame:
    rows = [
        make_row(pid, gw, total_points=(gw + pid) % 10)
        for pid in PLAYER_IDS
        for gw in range(1, PRIOR_SEASON_GWS + 1)
    ]
    df = pd.DataFrame(rows)
    df["season"] = season
    return df


def make_live_gw1_rows(points_by_player: dict[int, int]) -> pd.DataFrame:
    """The 'live' current-season rows extract() would return — no 'season' column,
    extract_with_history() tags that itself with CURRENT_SEASON."""
    return pd.DataFrame([make_row(pid, 1, total_points=pts) for pid, pts in points_by_player.items()])


@pytest.fixture
def archived_prior_season(tmp_path, monkeypatch):
    """Writes a synthetic 2025-26 archive and points settings.datasets_dir at it."""
    history_dir = tmp_path / "history"
    history_dir.mkdir(parents=True)
    make_prior_season_archive().to_parquet(history_dir / "player_gw_history_2025-26.parquet", index=False)
    monkeypatch.setattr(ext_mod.settings, "datasets_dir", tmp_path)
    return tmp_path


# ── extract_with_history ─────────────────────────────────────────────────────

class TestExtractWithHistory:

    def test_merges_live_and_archived_seasons(self, archived_prior_season, monkeypatch):
        live = make_live_gw1_rows({1: 6, 2: 2, 3: 9})
        monkeypatch.setattr(ext_mod, "extract", lambda: live)
        monkeypatch.setattr(ext_mod, "CURRENT_SEASON", "2026-27")

        combined = ext_mod.extract_with_history()

        assert set(combined["season"].unique()) == {"2025-26", "2026-27"}
        assert (combined["season"] == "2026-27").sum() == len(PLAYER_IDS)
        assert len(combined) == len(PLAYER_IDS) * PRIOR_SEASON_GWS + len(PLAYER_IDS)

    def test_orders_each_players_rows_chronologically_across_the_boundary(
        self, archived_prior_season, monkeypatch,
    ):
        live = make_live_gw1_rows({pid: 5 for pid in PLAYER_IDS})
        monkeypatch.setattr(ext_mod, "extract", lambda: live)
        monkeypatch.setattr(ext_mod, "CURRENT_SEASON", "2026-27")

        combined = ext_mod.extract_with_history()

        for pid in PLAYER_IDS:
            seasons = combined.loc[combined["player_id"] == pid, "season"].tolist()
            last_prior_idx = max(i for i, s in enumerate(seasons) if s == "2025-26")
            first_new_idx  = min(i for i, s in enumerate(seasons) if s == "2026-27")
            assert last_prior_idx < first_new_idx, (
                f"player {pid}: 2026-27 row is not ordered after every 2025-26 row"
            )

    def test_skips_archive_tagged_as_the_current_season(self, archived_prior_season, monkeypatch):
        """
        The guard this test protects: if CURRENT_SEASON in constants.py is
        never bumped after rollover, newly-extracted live rows would be
        tagged with the SAME season string as the archive. Without this
        guard, that would double-count every archived row as if it were both
        prior-season history AND (wrongly) part of the live season.
        """
        live = make_live_gw1_rows({pid: 5 for pid in PLAYER_IDS})
        monkeypatch.setattr(ext_mod, "extract", lambda: live)
        monkeypatch.setattr(ext_mod, "CURRENT_SEASON", "2025-26")  # NOT bumped — matches the archive

        combined = ext_mod.extract_with_history()

        assert set(combined["season"].unique()) == {"2025-26"}
        assert len(combined) == len(PLAYER_IDS)  # only the live rows — archive was skipped

    def test_falls_back_to_live_only_when_no_archive_exists(self, tmp_path, monkeypatch):
        monkeypatch.setattr(ext_mod.settings, "datasets_dir", tmp_path)  # empty — no history/ dir
        live = make_live_gw1_rows({pid: 5 for pid in PLAYER_IDS})
        monkeypatch.setattr(ext_mod, "extract", lambda: live)
        monkeypatch.setattr(ext_mod, "CURRENT_SEASON", "2026-27")

        combined = ext_mod.extract_with_history()

        assert set(combined["season"].unique()) == {"2026-27"}
        assert len(combined) == len(PLAYER_IDS)


# ── Rolling features across the boundary ─────────────────────────────────────

class TestFeatureBridging:

    def test_rolling_window_uses_prior_season_history_not_zero(
        self, archived_prior_season, monkeypatch,
    ):
        """
        The whole point of the merge: a player's rolling "last GW" feature at
        the new season's GW1 should reflect their real prior-season form, not
        reset to 0 the way it would if features were built from live data
        alone (which is exactly what caused the GW2-GW5 blackout this session
        fixed — retraining had nowhere near enough history to pass the
        minimum-history filter without the archive).
        """
        live = make_live_gw1_rows({1: 6, 2: 2, 3: 9})
        monkeypatch.setattr(ext_mod, "extract", lambda: live)
        monkeypatch.setattr(ext_mod, "CURRENT_SEASON", "2026-27")

        combined = ext_mod.extract_with_history()
        featured = build_features(combined)

        for pid, last_season_final_gw_points in [(1, (PRIOR_SEASON_GWS + 1) % 10),
                                                   (2, (PRIOR_SEASON_GWS + 2) % 10),
                                                   (3, (PRIOR_SEASON_GWS + 3) % 10)]:
            row = featured[(featured["player_id"] == pid) & (featured["season"] == "2026-27")]
            assert len(row) == 1
            assert row.iloc[0]["pts_last_1gw"] == last_season_final_gw_points


# ── Target attachment + temporal split across the boundary ──────────────────

class TestTemporalSplitAcrossBoundary:

    def test_validation_window_spans_the_season_boundary(self, archived_prior_season, monkeypatch):
        live = make_live_gw1_rows({pid: 5 for pid in PLAYER_IDS})
        monkeypatch.setattr(ext_mod, "extract", lambda: live)
        monkeypatch.setattr(ext_mod, "CURRENT_SEASON", "2026-27")

        combined = ext_mod.extract_with_history()
        featured = build_features(combined)
        with_targets = attach_targets(featured)
        train_df, val_df = temporal_split(with_targets)

        assert len(train_df) > 0
        assert len(val_df) > 0
        # The validation window (last VALIDATION_GW_COUNT=5 rounds) should reach
        # into the new season, not get stuck re-selecting old-season rounds
        # because raw "gameweek" numbers collide across the two seasons.
        assert "2026-27" in set(val_df["season"].unique())

    def test_last_prior_season_gw_gets_a_target_from_the_new_seasons_opener(
        self, archived_prior_season, monkeypatch,
    ):
        """
        attach_targets shifts each row's target to the NEXT chronological row.
        For a player's final prior-season gameweek, that next row is now the
        new season's GW1 (once it exists), not NaN as it would be with no
        merge — this is what lets last season's closing form contribute a
        real training example instead of being silently dropped.
        """
        live = make_live_gw1_rows({1: 7})
        monkeypatch.setattr(ext_mod, "extract", lambda: live)
        monkeypatch.setattr(ext_mod, "CURRENT_SEASON", "2026-27")

        combined = ext_mod.extract_with_history()
        featured = build_features(combined)
        with_targets = attach_targets(featured)

        last_prior_row = with_targets[
            (with_targets["player_id"] == 1)
            & (with_targets["season"] == "2025-26")
            & (with_targets["gameweek"] == PRIOR_SEASON_GWS)
        ]
        assert len(last_prior_row) == 1
        assert last_prior_row.iloc[0][TARGET_POINTS] == 7
