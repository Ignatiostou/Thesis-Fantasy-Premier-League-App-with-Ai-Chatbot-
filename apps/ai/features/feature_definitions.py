from dataclasses import dataclass
from typing import Optional


@dataclass
class FeatureDef:
    description: str
    feature_type: str          
    value_range: str           
    notes: Optional[str] = None


FEATURE_DEFINITIONS: dict[str, FeatureDef] = {

    # ── Rolling points features ───────────────────────────────────────────────

    "form": FeatureDef(
        description="FPL's own form score — rolling 5-GW average points (from API).",
        feature_type="rolling",
        value_range="0.0 – ~12.0",
        notes="Falls back to pts_last_5gw_avg if FPL form field is null.",
    ),
    "pts_last_1gw": FeatureDef(
        description="Total points scored in the most recent gameweek.",
        feature_type="rolling",
        value_range="0 – ~25",
        notes="Shifted by 1 GW — reflects the previous GW only.",
    ),
    "pts_last_3gw_avg": FeatureDef(
        description="Average points scored over the last 3 gameweeks.",
        feature_type="rolling",
        value_range="0.0 – ~15.0",
        notes="Key short-term form indicator. min_periods=1 so partial windows are allowed.",
    ),
    "pts_last_5gw_avg": FeatureDef(
        description="Average points scored over the last 5 gameweeks.",
        feature_type="rolling",
        value_range="0.0 – ~12.0",
        notes="Balances short-term form with medium-term consistency.",
    ),
    "pts_last_5gw_std": FeatureDef(
        description="Standard deviation of points over the last 5 gameweeks.",
        feature_type="rolling",
        value_range="0.0 – ~8.0",
        notes="Consistency metric — low std = reliable scorer, high std = boom/bust.",
    ),

    # ── Rolling minutes features ──────────────────────────────────────────────

    "minutes_last_3gw_avg": FeatureDef(
        description="Average minutes played over the last 3 gameweeks.",
        feature_type="rolling",
        value_range="0 – 90",
        notes="Primary input for the availability model. <30 avg = rotation risk.",
    ),
    "minutes_last_5gw_avg": FeatureDef(
        description="Average minutes played over the last 5 gameweeks.",
        feature_type="rolling",
        value_range="0 – 90",
        notes="Smoother rotation signal over a longer window.",
    ),

    # ── Availability features ─────────────────────────────────────────────────

    "chance_of_playing": FeatureDef(
        description="Estimated percentage chance of playing next GW (0–100).",
        feature_type="availability",
        value_range="0 – 100",
        notes=(
            "Derived from FPL status: a=100, d=50, i=0, s=0, u=0. "
            "If FPL provides a specific value (chanceOfPlayingNextRound), that takes priority."
        ),
    ),

    # ── Fixture difficulty features ───────────────────────────────────────────

    "next_gw_fdr": FeatureDef(
        description="Fixture Difficulty Rating for the next gameweek (1=easiest, 5=hardest).",
        feature_type="fixture",
        value_range="1 – 5",
        notes=(
            "In training: taken from the NEXT row's fixture_fdr (shift -1). "
            "In inference: injected directly from the upcoming fixture."
        ),
    ),
    "avg_fdr_next3": FeatureDef(
        description="Average FDR across the next 3 gameweeks.",
        feature_type="fixture",
        value_range="1.0 – 5.0",
        notes="Short-term fixture run quality. Lower = easier run.",
    ),
    "is_home_next_gw": FeatureDef(
        description="1 if the player's team plays at home next GW, 0 if away.",
        feature_type="fixture",
        value_range="0 or 1",
        notes="Home advantage is a small but consistent positive signal.",
    ),

    # ── Cumulative season totals ──────────────────────────────────────────────

    "season_total_points": FeatureDef(
        description="Cumulative total FPL points scored in the season so far.",
        feature_type="cumulative",
        value_range="0 – ~300",
        notes="Shifted — reflects points up to (not including) the current GW.",
    ),

    "pts_per_game": FeatureDef(
        description="Average points per game played this season.",
        feature_type="cumulative",
        value_range="0.0 – ~6.0",
        notes="Accounts for players with fewer appearances. Shifted cumulative.",
    ),

    "goals_scored": FeatureDef(
        description="Cumulative goals scored this season.",
        feature_type="cumulative",
        value_range="0 – ~30",
        notes="Cumulative up to but not including current GW.",
    ),
    "assists": FeatureDef(
        description="Cumulative assists this season.",
        feature_type="cumulative",
        value_range="0 – ~20",
        notes="Cumulative up to but not including current GW.",
    ),
    "clean_sheets": FeatureDef(
        description="Cumulative clean sheets this season.",
        feature_type="cumulative",
        value_range="0 – ~20",
        notes="Important for GKs and DEFs. Shifted cumulative.",
    ),
    "bonus": FeatureDef(
        description="Cumulative bonus points this season.",
        feature_type="cumulative",
        value_range="0 – ~50",
        notes="Bonus points proxy for consistent high-BPS performance.",
    ),

    # ── Advanced stats (rolling ICT) ──────────────────────────────────────────

    "ict_index_avg": FeatureDef(
        description="Rolling 5-GW average of FPL ICT (Influence + Creativity + Threat) index.",
        feature_type="rolling",
        value_range="0.0 – ~200.0 (raw FPL scale)",
        notes="Composite attacking involvement metric from FPL API.",
    ),
    "threat_avg": FeatureDef(
        description="Rolling 5-GW average of FPL Threat score.",
        feature_type="rolling",
        value_range="0 – ~250",
        notes="Measures goal-scoring involvement. Strong for FWDs and attacking MIDs.",
    ),
    "creativity_avg": FeatureDef(
        description="Rolling 5-GW average of FPL Creativity score.",
        feature_type="rolling",
        value_range="0 – ~150",
        notes="Measures chance creation. Strong for MIDs with assist potential.",
    ),
    "influence_avg": FeatureDef(
        description="Rolling 5-GW average of FPL Influence score.",
        feature_type="rolling",
        value_range="0 – ~200",
        notes="Measures overall match impact. Correlates with bonus points.",
    ),

    # ── Player metadata ───────────────────────────────────────────────────────

    "position": FeatureDef(
        description="FPL position code: 1=GK, 2=DEF, 3=MID, 4=FWD.",
        feature_type="metadata",
        value_range="1 – 4",
        notes="Integer-encoded. Models use this to learn position-specific scoring patterns.",
    ),
    "now_cost": FeatureDef(
        description="Current player price in FPL tenths (e.g. 75 = £7.5m).",
        feature_type="metadata",
        value_range="40 – 150 (tenths)",
        notes="Proxy for player quality tier. Expensive players generally score more.",
    ),
    "selected_by_percent": FeatureDef(
        description="Percentage of FPL managers who own the player.",
        feature_type="metadata",
        value_range="0.0 – 100.0",
        notes="Ownership indicates template status. Not a direct predictor but useful context.",
    ),
}


def print_feature_summary() -> None:
    """Prints a formatted table of all features. Run directly for documentation."""
    print(f"\n{'Feature':<28} {'Type':<14} {'Range':<22} Description")
    print("-" * 100)
    for name, defn in FEATURE_DEFINITIONS.items():
        print(
            f"{name:<28} {defn.feature_type:<14} {defn.value_range:<22} {defn.description[:60]}"
        )
    print(f"\nTotal features: {len(FEATURE_DEFINITIONS)}")


if __name__ == "__main__":
    print_feature_summary()