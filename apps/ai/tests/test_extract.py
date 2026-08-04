import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from pydantic import ValidationError
from schemas import RawPlayerGwRow, FeatureRow, PlayerPrediction
from datetime import datetime


# ── RawPlayerGwRow ────────────────────────────────────────────────────────────

class TestRawPlayerGwRow:

    def _valid_row(self) -> dict:
        return {
            "player_id":            1,
            "web_name":             "Salah",
            "team_id":              14,
            "team_short_name":      "LIV",
            "position":             3,
            "now_cost":             130,
            "status":               "a",
            "selected_by_percent":  42.5,
            "form":                 8.2,
            "gameweek":             15,
            "minutes":              90,
            "total_points":         12,
            "goals_scored":         1,
            "assists":              0,
            "clean_sheets":         False,
            "goals_conceded":       1,
            "bonus":                3,
            "bps":                  45,
            "influence":            78.4,
            "creativity":           52.1,
            "threat":               120.0,
            "ict_index":            43.2,
            "fixture_fdr":          2,
            "was_home":             True,
            # optional fields
            "own_goals":            0,
            "penalties_saved":      0,
            "penalties_missed":     0,
            "yellow_cards":         0,
            "red_cards":            0,
            "saves":                0,
        }

    def test_valid_row_parses(self):
        row = RawPlayerGwRow(**self._valid_row())
        assert row.player_id == 1
        assert row.web_name == "Salah"

    def test_invalid_position_raises(self):
        data = self._valid_row()
        data["position"] = 5   # invalid
        with pytest.raises(ValidationError):
            RawPlayerGwRow(**data)

    def test_invalid_gameweek_raises(self):
        data = self._valid_row()
        data["gameweek"] = 39  # > 38
        with pytest.raises(ValidationError):
            RawPlayerGwRow(**data)

    def test_zero_gameweek_raises(self):
        data = self._valid_row()
        data["gameweek"] = 0
        with pytest.raises(ValidationError):
            RawPlayerGwRow(**data)

    def test_optional_fields_can_be_null(self):
        data = self._valid_row()
        data["influence"]  = None
        data["creativity"] = None
        data["threat"]     = None
        data["ict_index"]  = None
        row = RawPlayerGwRow(**data)
        assert row.influence is None


# ── PlayerPrediction ──────────────────────────────────────────────────────────

class TestPlayerPrediction:

    def _valid_pred(self) -> dict:
        return {
            "player_id":          1,
            "gameweek":           16,
            "predicted_pts_gw1":  6.4,
            "predicted_pts_gw3":  18.2,
            "predicted_pts_gw5":  29.1,
            "prob_playing":       0.95,
            "prob_60_plus_mins":  0.88,
            "model_version":      "xgb_v1",
            "confidence":         "HIGH",
            "generated_at":       datetime.utcnow(),
        }

    def test_valid_prediction_parses(self):
        pred = PlayerPrediction(**self._valid_pred())
        assert pred.player_id == 1
        assert pred.confidence == "HIGH"

    def test_invalid_probability_raises(self):
        data = self._valid_pred()
        data["prob_playing"] = 1.5  # > 1.0
        with pytest.raises(ValidationError):
            PlayerPrediction(**data)

    def test_negative_probability_raises(self):
        data = self._valid_pred()
        data["prob_60_plus_mins"] = -0.1
        with pytest.raises(ValidationError):
            PlayerPrediction(**data)

    def test_invalid_confidence_raises(self):
        data = self._valid_pred()
        data["confidence"] = "VERY_HIGH"
        with pytest.raises(ValidationError):
            PlayerPrediction(**data)

    def test_valid_confidence_values(self):
        for conf in ["HIGH", "MEDIUM", "LOW"]:
            data = self._valid_pred()
            data["confidence"] = conf
            pred = PlayerPrediction(**data)
            assert pred.confidence == conf