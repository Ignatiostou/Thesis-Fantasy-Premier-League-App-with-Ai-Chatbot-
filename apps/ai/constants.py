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
CURRENT_SEASON  = "2025-26"
TOTAL_GAMEWEEKS = 38



FEATURE_COLS = [
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

# Target columns
TARGET_POINTS  = "total_points_next_gw"   
TARGET_MINUTES = "minutes_next_gw"
TARGET_PLAYED  = "played_next_gw"         