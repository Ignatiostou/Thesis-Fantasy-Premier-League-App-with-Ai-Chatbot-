from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field, field_validator



class RawPlayerGwRow(BaseModel):
    """One row from extract_player_gw_history.py"""
    player_id:                int
    web_name:                 str
    team_id:                  int
    team_short_name:          str
    position:                 int        
    now_cost:                 int        
    status:                   str
    selected_by_percent:      Optional[float]
    form:                     Optional[float]

    gameweek:                 int
    minutes:                  int
    total_points:             int
    goals_scored:             int
    assists:                  int
    clean_sheets:             bool
    goals_conceded:           int
    bonus:                    int
    bps:                      int
    influence:                Optional[float]
    creativity:               Optional[float]
    threat:                   Optional[float]
    ict_index:                Optional[float]

    
    fixture_fdr:              Optional[int]    
    was_home:                 Optional[bool]

    @field_validator("position")
    @classmethod
    def valid_position(cls, v: int) -> int:
        if v not in (1, 2, 3, 4):
            raise ValueError(f"Invalid position: {v}")
        return v

    @field_validator("gameweek")
    @classmethod
    def valid_gameweek(cls, v: int) -> int:
        if not (1 <= v <= 38):
            raise ValueError(f"Invalid gameweek: {v}")
        return v


# ── Feature row ───────────────────────────────────────────────────────────────
# One row = one player at a given target GW — ready to feed into models.

class FeatureRow(BaseModel):
    """One engineered feature row ready for training or inference."""
    player_id:              int
    web_name:               str
    position:               int
    now_cost:               int
    gameweek:               int          

    # Features (all required — NaN handling done in feature engineering)
    form:                   float
    pts_last_1gw:           float
    pts_last_3gw_avg:       float
    pts_last_5gw_avg:       float
    pts_last_5gw_std:       float
    minutes_last_3gw_avg:   float
    minutes_last_5gw_avg:   float
    chance_of_playing:      float        
    next_gw_fdr:            float        
    avg_fdr_next3:          float
    is_home_next_gw:        float        
    season_total_points:    float
    pts_per_game:           float
    goals_scored:           float
    assists:                float
    clean_sheets:           float
    bonus:                  float
    ict_index_avg:          float
    threat_avg:             float
    creativity_avg:         float
    influence_avg:          float
    selected_by_percent:    float

    # Target values (present in training data, absent in inference)
    total_points_next_gw:   Optional[float] = None
    minutes_next_gw:        Optional[float] = None
    played_next_gw:         Optional[int]   = None   


# ── Prediction row ────────────────────────────────────────────────────────────
# Output of inference/predict_next_gw.py — written back to DB.

class PlayerPrediction(BaseModel):
    """One prediction row to be upserted into player_predictions table."""
    player_id:            int
    gameweek:             int

    predicted_pts_gw1:    float   
    predicted_pts_gw3:    float   
    predicted_pts_gw5:    float   

    prob_playing:         float  
    prob_60_plus_mins:    float   

    model_version:        str     
    confidence:           str     
    generated_at:         datetime = Field(default_factory=datetime.utcnow)

    @field_validator("prob_playing", "prob_60_plus_mins")
    @classmethod
    def valid_probability(cls, v: float) -> float:
        if not (0.0 <= v <= 1.0):
            raise ValueError(f"Probability must be 0-1, got {v}")
        return round(v, 4)

    @field_validator("confidence")
    @classmethod
    def valid_confidence(cls, v: str) -> str:
        if v not in ("HIGH", "MEDIUM", "LOW"):
            raise ValueError(f"confidence must be HIGH/MEDIUM/LOW, got {v}")
        return v