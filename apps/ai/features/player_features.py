import pandas as pd
import numpy as np
from constants import FEATURE_COLS, FDR_NEUTRAL, season_round_key
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
    # Same trap for the team-form inputs: _add_cumulative_season_features
    # replaces goals_scored and clean_sheets with cumulative season totals, so
    # anything reading them later gets a running count instead of that GW's
    # result. goals_conceded is not on that list, but is copied here too so all
    # three team inputs are read from one consistent, clearly-named place.
    df["gw_goals_scored"]  = df["goals_scored"].astype(float)
    df["gw_clean_sheets"]  = df["clean_sheets"].astype(float)
    df["gw_goals_conceded"] = df["goals_conceded"].astype(float)
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


def build_team_round_table(df: pd.DataFrame, key: list[str]) -> pd.DataFrame:
    """One row per team per round: goals for/against, clean sheet, venue.

    goals_for is the sum of the squad's goals that round. goals_against and the
    clean-sheet flag are taken as the median/majority across players who lasted
    60+ minutes — they all played the same match, so the consensus is robust to
    a substitute who came on after a goal.
    """
    anchored = df[df["minutes"] >= 60]

    # gw_* copies, not the raw column names — by this point in the pipeline
    # goals_scored and clean_sheets hold cumulative season totals.
    gf = df.groupby(key + ["_round_key"])["gw_goals_scored"].sum().rename("team_gf")
    ga = anchored.groupby(key + ["_round_key"])["gw_goals_conceded"].median().rename("team_ga")
    cs = (anchored.groupby(key + ["_round_key"])["gw_clean_sheets"]
          .mean().gt(0.5).astype(float).rename("team_cs"))
    home = df.groupby(key + ["_round_key"])["was_home"].first().rename("was_home")
    # Blank gameweeks: the squad still has rows for the round, all with zero
    # minutes. Left in, they read as a 0-0 draw — dragging attacking form down
    # and consuming a slot in the 5-match window with a match that never
    # happened. A round only counts if somebody actually played in it.
    played = df.groupby(key + ["_round_key"])["minutes"].max().rename("_max_minutes")

    t = pd.concat([gf, ga, cs, home, played], axis=1).reset_index()
    t = t[t["_max_minutes"] > 0].drop(columns=["_max_minutes"])
    return t.sort_values(key + ["_round_key"])


def season_scope(df: pd.DataFrame) -> list[str]:
    """Grouping keys for anything that must restart each season.

    Rolling form deliberately spans the season boundary — a player's opening
    fixture is best predicted from how he finished the last one. Cumulative
    season totals must NOT: they describe one season by definition, and that is
    what inference reads back out of player_gameweek_stats.
    """
    return ["player_id", "season"] if "season" in df.columns else ["player_id"]


def team_key(df: pd.DataFrame) -> list[str]:
    """Columns that identify a club. Team ids are renumbered between seasons, so
    a club is only pinned down by (season, team_id) once more than one season is
    in play."""
    return ["season", "team_id"] if "season" in df.columns else ["team_id"]


def build_team_form_table(df: pd.DataFrame, key: list[str]) -> pd.DataFrame:
    """Team-round table with rolling form columns attached.

    Shared by the own-team and opponent features so a club's "form" has exactly
    one definition regardless of which side of the fixture is being described.
    Columns are named neutrally (gf_l5, ga_l5, ...) and renamed by the caller.
    """
    t = build_team_round_table(df, key)
    g = t.groupby(key, sort=False)
    t["gf_l5"] = g["team_gf"].transform(lambda s: _rolling(s, 5))
    t["ga_l5"] = g["team_ga"].transform(lambda s: _rolling(s, 5))
    t["cs_l5"] = g["team_cs"].transform(lambda s: _rolling(s, 5))
    t["gd_l5"] = t["gf_l5"] - t["ga_l5"]

    # Venue splits: roll home matches and away matches as separate series, then
    # carry each forward so any round can read "as of the last home/away match
    # before now". Forward-fill happens within the team, after the shift, so no
    # future result can leak backwards.
    for venue, label in ((True, "home"), (False, "away")):
        sub = t[t["was_home"] == venue]
        if sub.empty:
            t[f"{label}_gf"] = np.nan
            t[f"{label}_ga"] = np.nan
            continue
        sg = sub.groupby(key, sort=False)
        vals = pd.DataFrame({
            f"{label}_gf": sg["team_gf"].transform(lambda s: _rolling(s, 5)),
            f"{label}_ga": sg["team_ga"].transform(lambda s: _rolling(s, 5)),
        }, index=sub.index)
        t = t.join(vals)
        t[f"{label}_gf"] = t.groupby(key, sort=False)[f"{label}_gf"].ffill()
        t[f"{label}_ga"] = t.groupby(key, sort=False)[f"{label}_ga"].ffill()

    return t


def _add_team_form_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    team_gf_l5, team_ga_l5, team_cs_rate_l5, team_gd_l5,
    team_venue_gf_l5, team_venue_ga_l5

    The player's OWN club's attacking and defensive form. Player-level features
    describe the individual; these describe the side he plays for, which is what
    actually drives clean-sheet points for defenders and keepers.

    Rolls team results with the same shift(1) convention as the player features,
    so a row never sees its own gameweek. Must run AFTER _add_fixture_features —
    the venue-split columns are selected using is_home_next_gw.

    Depends on team_id being the club for THAT gameweek. That holds for rows
    written with player_gameweek_stats.teamId, and for extracts taken before the
    season rolled over. Where it is missing the features fall back to zeros.
    """
    out_cols = ["team_gf_l5", "team_ga_l5", "team_cs_rate_l5", "team_gd_l5",
                "team_venue_gf_l5", "team_venue_ga_l5"]

    if "team_id" not in df.columns or df["team_id"].isna().all():
        logger.warning("team_id unavailable — team form features filled with 0")
        for c in out_cols:
            df[c] = 0.0
        return df

    df["_round_key"] = season_round_key(df)
    key = team_key(df)

    t = build_team_form_table(df, key)

    merge_cols = key + ["_round_key"] + ["gf_l5", "ga_l5", "cs_l5", "gd_l5",
                                         "home_gf", "home_ga", "away_gf", "away_ga"]
    df = df.merge(t[merge_cols], on=key + ["_round_key"], how="left")
    df = df.rename(columns={"gf_l5": "team_gf_l5", "ga_l5": "team_ga_l5",
                            "cs_l5": "team_cs_rate_l5", "gd_l5": "team_gd_l5",
                            "home_gf": "_home_gf", "home_ga": "_home_ga",
                            "away_gf": "_away_gf", "away_ga": "_away_ga"})

    at_home = df["is_home_next_gw"].astype(float) == 1.0
    df["team_venue_gf_l5"] = np.where(at_home, df["_home_gf"], df["_away_gf"])
    df["team_venue_ga_l5"] = np.where(at_home, df["_home_ga"], df["_away_ga"])

    df = df.drop(columns=["_home_gf", "_home_ga", "_away_gf", "_away_ga", "_round_key"])
    for c in out_cols:
        df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0.0)

    logger.info("Team form features built for %d teams",
                df.groupby(key, sort=False).ngroups)
    return df


def opponent_data_coverage(df: pd.DataFrame) -> float:
    """Share of rows that know who the NEXT opponent is."""
    if "opponent_team_id" not in df.columns:
        return 0.0
    nxt = df.groupby("player_id")["opponent_team_id"].shift(-1)
    return float(nxt.notna().mean())


def _add_opponent_strength_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    opp_gf_l5, opp_ga_l5, opp_cs_rate_l5, opp_gd_l5, opp_venue_ga_l5

    How good the side he is about to face has been. A striker facing a leaky
    defence and a striker facing a miserly one look identical to the model
    otherwise — fdr compresses the whole opponent into one 1-5 integer shared by
    every player in the squad.

    Requires opponent_team_id, recorded on the stat row from GW1 2026-27 onward.
    It CANNOT be reconstructed for earlier seasons: opponent identity was never
    stored, and recovering it from scorelines produced a fixture list that
    violated the round-robin structure (47 duplicated pairings, teams with 22-35
    matches instead of 38), so those rows are left at zero rather than guessed.

    The opponent's form is read as of the same round as the player's row, using
    the same rolling definition as the own-team features, and the venue split is
    inverted — the player at home means the opponent is away.
    """
    out_cols = ["opp_gf_l5", "opp_ga_l5", "opp_cs_rate_l5", "opp_gd_l5", "opp_venue_ga_l5"]

    coverage = opponent_data_coverage(df)
    if coverage == 0.0:
        logger.info("No opponent_team_id available — opponent features are 0 "
                    "(expected until 2026-27 data accumulates)")
        for c in out_cols:
            df[c] = 0.0
        return df
    if coverage < 0.5:
        logger.warning("Only %.1f%% of rows know their next opponent — opponent "
                       "features will be mostly zero", coverage * 100)

    df["_round_key"] = season_round_key(df)
    key = team_key(df)
    t = build_team_form_table(df, key)

    # Who they face NEXT — the fixture being predicted, known in advance.
    df["_next_opp"] = df.groupby("player_id")["opponent_team_id"].shift(-1)

    right = t[key + ["_round_key", "gf_l5", "ga_l5", "cs_l5", "gd_l5", "home_ga", "away_ga"]]
    left_on = (["season", "_next_opp", "_round_key"] if "season" in key
               else ["_next_opp", "_round_key"])
    df = df.merge(right, left_on=left_on, right_on=key + ["_round_key"],
                  how="left", suffixes=("", "_opp"))

    df = df.rename(columns={"gf_l5": "opp_gf_l5", "ga_l5": "opp_ga_l5",
                            "cs_l5": "opp_cs_rate_l5", "gd_l5": "opp_gd_l5"})

    # Venue is inverted relative to the player: he is home, they are away.
    at_home = df["is_home_next_gw"].astype(float) == 1.0
    df["opp_venue_ga_l5"] = np.where(at_home, df["away_ga"], df["home_ga"])

    drop = [c for c in ["home_ga", "away_ga", "_next_opp", "_round_key",
                        "team_id_opp", "season_opp"] if c in df.columns]
    df = df.drop(columns=drop)
    for c in out_cols:
        df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0.0)

    logger.info("Opponent strength features built (next-opponent known for %.1f%% of rows)",
                coverage * 100)
    return df


def _add_cumulative_season_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Cumulative season totals up to (but NOT including) the current GW.
    goals_scored, assists, clean_sheets, bonus — all shifted by 1.

    IMPORTANT: writes to "season_total_pts" not "total_points".
    Overwriting "total_points" here was the root cause of the leakage bug —
    attach_targets would then shift the cumulative total as the points target
    instead of the raw per-GW score.

    The cumsum resets at each season. Grouping by player alone turns these into
    career totals the moment a second season is merged in: a 2026-27 GW2 row
    would inherit the whole of 2025-26 (measured: season_total_pts 194 instead
    of 4). Inference reads them from player_gameweek_stats, which the rollover
    clears, so it always reports the current season — without the reset the two
    sides disagree on the 3rd most important feature.
    """
    keys = season_scope(df)

    for col in ["goals_scored", "assists", "clean_sheets", "bonus"]:
        if col in df.columns:
            df[col] = (
                df.groupby(keys)[col]
                .transform(lambda s: s.shift(1).cumsum())
                .fillna(0)
                .astype(float)
            )
        else:
            logger.warning(f"Column '{col}' missing — filling with 0")
            df[col] = 0.0

    # Use "gw_points" (raw) as source — writes to new column "season_total_pts"
    df["season_total_pts"] = (
        df.groupby(keys)["gw_points"]
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
    # games_played = GWs where the player had > 0 minutes, cumulative, shifted.
    # Season-scoped for the same reason as the totals it divides.
    df["_games_played"] = (
        df.groupby(season_scope(df))["minutes"]
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

    # Ensure sorted — rolling computations require chronological order per player.
    # season_round_key orders correctly across a season boundary (where 'gameweek'
    # alone resets to 1 each season); every groupby("player_id") below relies on
    # row ORDER within the group, not on the raw gameweek value, so this single
    # sort is enough to make shift()/rolling()/cumsum() correct across seasons.
    df = df.copy()
    df["_round_key"] = season_round_key(df)
    df = df.sort_values(["player_id", "_round_key"]).drop(columns=["_round_key"])

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

    # 10. Own-team form — after step 7, which supplies is_home_next_gw for the
    #     venue split. Re-sorts internally via the merge, so it runs last.
    df = _add_team_form_features(df)

    # 11. Opponent strength — zeros until opponent_team_id has been captured
    #     (from GW1 2026-27). Same venue dependency as step 10.
    df = _add_opponent_strength_features(df)

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