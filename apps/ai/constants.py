import pandas as pd

POSITION_GK  = 1
POSITION_DEF = 2
POSITION_MID = 3
POSITION_FWD = 4

POSITION_LABEL = {
    POSITION_GK:  "GK",
    POSITION_DEF: "DEF",
    POSITION_MID: "MID",
    POSITION_FWD: "FWD",
}

# ── FPL player status codes ───────────────────────────────────────────────────
STATUS_AVAILABLE   = "a"
STATUS_DOUBTFUL    = "d"
STATUS_INJURED     = "i"
STATUS_SUSPENDED   = "s"
STATUS_UNAVAILABLE = "u"

AVAILABLE_STATUSES = {STATUS_AVAILABLE, STATUS_DOUBTFUL}

# ── FDR (Fixture Difficulty Rating) ──────────────────────────────────────────
FDR_MIN     = 1
FDR_MAX     = 5
FDR_NEUTRAL = 3

FDR_MULTIPLIER = {1: 1.25, 2: 1.12, 3: 1.00, 4: 0.88, 5: 0.75}

# ── Points thresholds ────────────────────────────────────────────────────────
HAUL_THRESHOLD     = 10
MIN_MINUTES_PLAYED = 30

# ── Season ────────────────────────────────────────────────────────────────────
# Bump this at the season boundary, alongside running scripts/rollover_season.py —
# it's what tags newly-extracted live rows so they merge correctly with archived
# prior seasons (see data/extract_player_gw_history.extract_with_history).
CURRENT_SEASON  = "2026-27"
TOTAL_GAMEWEEKS = 38


def season_start_year(season: str) -> int:
    """'2025-26' -> 2025. Used to order seasons chronologically."""
    return int(season.split("-")[0])


def season_round_key(df: pd.DataFrame) -> pd.Series:
    """
    Sortable integer combining season + gameweek, e.g. 2025-26 GW10 -> 202510,
    2026-27 GW3 -> 202603. Gameweek never exceeds TOTAL_GAMEWEEKS (38) so this
    never collides across season boundaries.

    Falls back to the plain 'gameweek' column when no 'season' column is
    present (single-season datasets, or code paths that predate the
    cross-season history merge).
    """
    if "season" not in df.columns:
        return df["gameweek"]
    return df["season"].apply(season_start_year) * 100 + df["gameweek"]



BASELINE_FEATURE_COLS = [
    # Form & recent output
    "form",
    "pts_last_1gw",
    "pts_last_3gw_avg",
    "pts_last_5gw_avg",
    "pts_last_5gw_std",

    # Minutes & availability
    "minutes_last_3gw_avg",
    "minutes_last_5gw_avg",
    "chance_of_playing",

    # Fixture difficulty
    "next_gw_fdr",
    "avg_fdr_next3",
    "is_home_next_gw",

    # Season totals (cumulative, shifted — safe as features)
    "season_total_pts",      
    "pts_per_game",         
    "goals_scored",
    "assists",
    "clean_sheets",
    "bonus",

    # Advanced stats
    "ict_index_avg",
    "threat_avg",
    "creativity_avg",
    "influence_avg",

    # Player metadata
    "position",
    "now_cost",
    "selected_by_percent",
]

# Own-team form, adopted into production on 2026-08-15 after rolling-origin
# ablation: MAE 1.0294 -> 1.0209 (-0.83%), better in 11 of 12 folds, p=0.0148.
# R² and within-1pt were flat to marginally worse, so the gain is real but small.
# BASELINE_FEATURE_COLS is kept so that comparison stays reproducible.
#
# Opponent-strength counterparts are deliberately absent: opponent identity was
# never recorded before 2026-27, and recovering it from 2025-26 scorelines was
# only 47.5% unambiguous — not a basis for a feature. Capture starts at GW1
# 2026-27 via player_gameweek_stats.opponentTeamId.
TEAM_FEATURE_COLS = [
    "team_gf_l5",         # goals scored, last 5 team matches (attacking form)
    "team_ga_l5",         # goals conceded, last 5 (defensive form)
    "team_cs_rate_l5",    # clean-sheet rate, last 5
    "team_gd_l5",         # goal difference over the same window
    "team_venue_gf_l5",   # attacking form at the venue of the NEXT fixture
    "team_venue_ga_l5",   # defensive form at the venue of the NEXT fixture
]

# Opponent strength. Implemented and computed end-to-end, but deliberately NOT
# in FEATURE_COLS yet: opponent_team_id only starts being recorded at GW1
# 2026-27, so every 2025-26 training row would carry a constant zero. Training a
# feature that is constant and then serving it a real value is precisely the
# out-of-distribution failure that made the first GW1 predictions meaningless.
#
# Recovering 2025-26 opponents from scorelines was attempted and rejected: the
# best matching violated the double round-robin (47 duplicated pairings, teams
# with 22-35 matches instead of 38), and there is no ground truth to validate
# against.
#
# TO ADOPT once ~6-8 gameweeks of 2026-27 are played (check with
# features.player_features.opponent_data_coverage): append OPPONENT_FEATURE_COLS
# to FEATURE_COLS below, rebuild the dataset, retrain, and re-run the ablation.
OPPONENT_FEATURE_COLS = [
    "opp_gf_l5",         # how much the opponent has been scoring
    "opp_ga_l5",         # how leaky they have been — the striker's signal
    "opp_cs_rate_l5",    # how often they shut teams out
    "opp_gd_l5",         # overall strength over the same window
    "opp_venue_ga_l5",   # what they concede at the venue THEY will be playing
]

# The production feature set. Anything that trains, scores, or serves reads this.
FEATURE_COLS = BASELINE_FEATURE_COLS + TEAM_FEATURE_COLS

# Backwards-compatible alias for the ablation script.
FEATURE_COLS_EXTENDED = FEATURE_COLS

# Target columns
TARGET_POINTS  = "total_points_next_gw"
TARGET_MINUTES = "minutes_next_gw"
TARGET_PLAYED  = "played_next_gw"         