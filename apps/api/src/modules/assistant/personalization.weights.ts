export interface UserProfileLite {
  riskTolerance:         number;  // 1=low / 2=balanced / 3=aggressive
  budgetStyle:           number;  // 1=value / 2=balanced / 3=premium
  preferredFocus:        number;  // 1=defence / 2=midfield / 3=attack
  differentialPreference:number;  // 1=safe / 2=balanced / 3=loves differentials
  planningHorizon:       number;  // 1=short / 2=balanced / 3=long
  explanationDepth:      number;  // 1=brief / 2=medium / 3=detailed
  topSixAffinity?:       number;  // 1=avoid / 2=neutral / 3=prefer
  captaincyStyle?:       number;  // 1=safe / 2=balanced / 3=bold
  transferFrequency?:    number;  // 1=roll / 2=use weekly / 3=take hits
  fixtureAwareness?:     number;  // 1=ignore / 2=consider / 3=obsess
}

export interface ScoringWeights {
  // Horizon weights — used by player-ranking and transfer scoring.
  // Always sum to 1.0.
  gw1Weight:                 number;
  gw3Weight:                 number;
  gw5Weight:                 number;

  // Penalty / bonus multipliers — applied multiplicatively to the base score.
  availabilityPenalty:       number;  // 1.0 = neutral, >1 = penalise more
  differentialBonus:         number;  // 0.0 = none, ~0.2 = strong preference
  bigSixMultiplier:          number;  // multiplier on score for big-six players
  topSixDefenderBoost:       number;  // extra multiplier specifically on big-six DEFs
  fixtureWeight:             number;  // how much fixture-difficulty matters

  // Captaincy-specific
  captaincyConservatism:     number;  // 1.0 = neutral, higher = punish HIGH risk more

  // Transfer-specific
  hitTolerance:              number;  // 1.0 = neutral, higher = more willing to take -4

  
  defenderStyleBias:         number;
}

// ── Public API ───────────────────────────────────────────────────────────────

export function deriveScoringWeights(profile: UserProfileLite | null): ScoringWeights {
  // Balanced defaults if the user hasn't completed onboarding.
  if (!profile) return defaultWeights();

  // ── Horizon weights ──────────────────────────────────────────────────────
  // planningHorizon 1 (short-term)  → 70/25/5
  // planningHorizon 2 (balanced)    → 55/30/15  (matches old hardcoded weights)
  // planningHorizon 3 (long-term)   → 30/40/30
  let gw1 = 0.55, gw3 = 0.30, gw5 = 0.15;
  if (profile.planningHorizon === 1) { gw1 = 0.70; gw3 = 0.25; gw5 = 0.05; }
  if (profile.planningHorizon === 3) { gw1 = 0.30; gw3 = 0.40; gw5 = 0.30; }

  // ── Availability penalty ─────────────────────────────────────────────────
  // riskTolerance 1 (low risk)  → penalise availability gaps more (×1.5)
  // riskTolerance 2 (balanced)  → neutral (×1.0)
  // riskTolerance 3 (high risk) → tolerate gaps (×0.7)
  const availabilityPenalty =
    profile.riskTolerance === 1 ? 1.5 :
    profile.riskTolerance === 3 ? 0.7 : 1.0;

  // ── Differential bonus ───────────────────────────────────────────────────
  // differentialPreference 1 (safe)         → 0 (no bonus for low ownership)
  // differentialPreference 2 (balanced)     → small bonus (0.05)
  // differentialPreference 3 (differentials)→ strong bonus (0.20)
  const differentialBonus =
    profile.differentialPreference === 1 ? 0.00 :
    profile.differentialPreference === 3 ? 0.20 : 0.05;

  // ── Big-six and top-six defender boost ───────────────────────────────────
  // topSixAffinity 1 (avoid)   → 0.85
  // topSixAffinity 2 (neutral) → 1.00
  // topSixAffinity 3 (prefer)  → 1.15
  const bigSixMultiplier =
    profile.topSixAffinity === 1 ? 0.85 :
    profile.topSixAffinity === 3 ? 1.15 : 1.00;

  // preferredFocus 1 (defence) → extra boost on big-six defenders (×1.10 stacked)
  // preferredFocus 2 (mid)     → neutral
  // preferredFocus 3 (attack)  → neutral on defenders (they're not the focus)
  const topSixDefenderBoost = profile.preferredFocus === 1 ? 1.10 : 1.00;

  // ── Fixture weight ───────────────────────────────────────────────────────
  // fixtureAwareness 1 (ignore)  → 0.5
  // fixtureAwareness 2 (consider)→ 1.0
  // fixtureAwareness 3 (obsess)  → 1.5
  const fixtureWeight =
    profile.fixtureAwareness === 1 ? 0.5 :
    profile.fixtureAwareness === 3 ? 1.5 : 1.0;

  // ── Captaincy conservatism ───────────────────────────────────────────────
  // captaincyStyle 1 (safe)  → 1.4 (penalise HIGH-risk captain candidates more)
  // captaincyStyle 2         → 1.0
  // captaincyStyle 3 (bold)  → 0.7
  const captaincyConservatism =
    profile.captaincyStyle === 1 ? 1.4 :
    profile.captaincyStyle === 3 ? 0.7 : 1.0;

  // ── Hit tolerance ────────────────────────────────────────────────────────
  // transferFrequency 1 (roll)        → 0.6 (avoid -4 hits)
  // transferFrequency 2 (use weekly)  → 1.0
  // transferFrequency 3 (active/hits) → 1.4
  const hitTolerance =
    profile.transferFrequency === 1 ? 0.6 :
    profile.transferFrequency === 3 ? 1.4 : 1.0;

  // ── Defender style bias (IMPROVEMENT #12) ────────────────────────────────
  // preferredFocus 1 (defence) → -0.6 (favour clean-sheet-driven defenders)
  // preferredFocus 2 (mid)     →  0.0 (balanced)
  // preferredFocus 3 (attack)  → +0.6 (favour goal/assist-threat defenders)
  // riskTolerance nudges this further: high-risk users lean a bit more
  // attacking (more variance, higher ceiling); low-risk users lean a bit
  // more defensive (clean sheets are a steadier points source).
  let defenderStyleBias =
    profile.preferredFocus === 1 ? -0.6 :
    profile.preferredFocus === 3 ? 0.6 : 0.0;
  if (profile.riskTolerance === 3) defenderStyleBias = Math.min(1, defenderStyleBias + 0.15);
  if (profile.riskTolerance === 1) defenderStyleBias = Math.max(-1, defenderStyleBias - 0.15);

  return {
    gw1Weight: gw1,
    gw3Weight: gw3,
    gw5Weight: gw5,
    availabilityPenalty,
    differentialBonus,
    bigSixMultiplier,
    topSixDefenderBoost,
    fixtureWeight,
    captaincyConservatism,
    hitTolerance,
    defenderStyleBias,
  };
}

export function defaultWeights(): ScoringWeights {
  return {
    gw1Weight:             0.55,
    gw3Weight:             0.30,
    gw5Weight:             0.15,
    availabilityPenalty:   1.0,
    differentialBonus:     0.05,
    bigSixMultiplier:      1.0,
    topSixDefenderBoost:   1.0,
    fixtureWeight:         1.0,
    captaincyConservatism: 1.0,
    hitTolerance:          1.0,
    defenderStyleBias:     0.0,
  };
}

// ── Helper for the differential bonus ────────────────────────────────────────
// Maps ownership % to a bonus contribution. Owned by 90 % = 0 bonus; owned by
// 1 % = full bonus. Multiplied by the user's differentialBonus coefficient.

export function differentialContribution(
  ownershipPercent: number,
  bonus:            number,
): number {
  if (bonus <= 0) return 0;
  // Clamp ownership to [0, 100], then invert so low ownership → high signal.
  const inverted = Math.max(0, Math.min(100, 100 - ownershipPercent)) / 100;
  return bonus * inverted;
}

// ── Big-six club IDs ─────────────────────────────────────────────────────────
// These should ideally come from the DB, but for performance we keep them as
// a constant set. Update when the "big six" changes.

export const BIG_SIX_SHORT_NAMES = new Set(['ARS', 'CHE', 'LIV', 'MCI', 'MUN', 'TOT']);

/**
 * IMPROVEMENT #12: combines a defender's team's clean-sheet-rate ratio and
 * attacking-returns ratio (both pre-computed elsewhere, e.g. from
 * team-strength.service.ts's TeamStrengthFacts, expressed relative to the
 * league average so 1.0 = average) into a single multiplier, using the
 * profile's defenderStyleBias to decide how much weight goes on each side.
 * This keeps the TS-side ranking logic consistent with the Python ILP
 * optimiser's compute_objective(), which performs the same blend.
 */
export function defenderTeamContextMultiplier(
  defenceRatio: number,   // team's clean-sheet/conceded strength vs league avg (1.0 = average)
  attackRatio:  number,   // team's goals+assists output vs league avg (1.0 = average)
  defenderStyleBias: number,
): number {
  const weightDefence = 0.5 - 0.3 * defenderStyleBias;
  const weightAttack  = 0.5 + 0.3 * defenderStyleBias;
  const blended = weightDefence * defenceRatio + weightAttack * attackRatio;
  return Math.max(0.75, Math.min(1.30, blended));
}
