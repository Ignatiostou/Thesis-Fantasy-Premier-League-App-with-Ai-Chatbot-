import type {
  PlayerPredictionDto,
  SquadPredictionSummary,
} from './ml-prediction.types.js';

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function line(p: PlayerPredictionDto): string {
  // Explicit, disambiguated labels — these are the strings the LLM reads.
  return (
    `${p.webName} (${p.club}, ${p.position}): ` +
    `xPts NEXT GW = ${p.predictedPtsGw1.toFixed(2)}, ` +
    `xPts TOTAL over next 3 GWs = ${p.predictedPtsGw3.toFixed(2)}, ` +
    `xPts TOTAL over next 5 GWs = ${p.predictedPtsGw5.toFixed(2)}, ` +
    `predicted minutes = ${p.predictedMinutes}, ` +
    `playing probability = ${pct(p.probPlaying)}, ` +
    `confidence ${p.confidence}`
  );
}

export function formatPredictionList(
  title:   string,
  players: PlayerPredictionDto[],
): string {
  if (!players.length) return `${title}: none available.`;
  return [
    `${title}:`,
    ...players.map((p, i) => `${i + 1}. ${line(p)}`),
  ].join('\n');
}

export function formatSquadPredictionSummary(
  summary: SquadPredictionSummary | null,
): string {
  if (!summary) {
    return [
      'ML prediction context:',
      'No ML predictions are currently available.',
      'Use existing rule-based recommendation logic only.',
    ].join('\n');
  }

  if (!summary.players.length) {
    return [
      'ML prediction context:',
      `Predictions exist for GW${summary.gameweek}, but none matched the current squad.`,
      'Use existing squad/context logic only.',
    ].join('\n');
  }

  const coverageLabel = summary.mlCoverage >= 80
    ? `ML-backed (${summary.mlCoverage}% of squad)`
    : summary.mlCoverage > 0
    ? `partial ML coverage (${summary.mlCoverage}% of squad) — remaining players use heuristic estimates`
    : `no ML coverage — all values are heuristic estimates`;

  return [
    'ML prediction context:',
    `Gameweek: ${summary.gameweek}`,
    `Model version: ${summary.modelVersion ?? 'unknown'}`,
    `Coverage: ${coverageLabel}`,
    '',
    '┌─ HOW TO READ THE NUMBERS BELOW ─────────────────────────────────────┐',
    '│ "xPts NEXT GW"          = expected points in the NEXT gameweek only │',
    '│                            (typical range 2-12 for starters)        │',
    '│ "xPts TOTAL over 3 GWs" = CUMULATIVE total over the next 3 GWs      │',
    '│                            (typical range 8-25)                     │',
    '│ "xPts TOTAL over 5 GWs" = CUMULATIVE total over the next 5 GWs      │',
    '│                            (typical range 12-40)                    │',
    '│                                                                     │',
    '│ When stating a per-GW projection, ONLY use "xPts NEXT GW".          │',
    '│ Never state a single-match projection above 15. If you need to      │',
    '│ mention 3 or 5 GW totals, always say "across the next N GWs".       │',
    '└─────────────────────────────────────────────────────────────────────┘',
    '',
    formatPredictionList(
      'Strongest squad players by projected NEXT-GW points',
      summary.strongestPlayers,
    ),
    '',
    formatPredictionList(
      'Best captain candidates by ML projection',
      summary.topCaptainCandidates,
    ),
    '',
    formatPredictionList(
      'Rotation / minutes risks',
      summary.rotationRisks,
    ),
    '',
    formatPredictionList(
      'Potential weak links',
      summary.weakLinks,
    ),
    '',
    'Instruction for assistant:',
    '- Use these ML predictions as decision-support signals, not absolute truth.',
    '- When stating a per-GW projection, ALWAYS use the "xPts NEXT GW" field.',
    '- Never quote a per-GW projection above 15 — if the value is from "over 3 GWs" or "over 5 GWs", say so explicitly.',
    '- When coverage is partial, note which players have ML predictions vs estimates.',
    '- Mention uncertainty when confidence is MEDIUM or LOW.',
    '- Do not invent xPts, minutes, probabilities, or model outputs not shown above.',
    '- When coverage is 0%, rely only on rule-based context and note predictions are unavailable.',
  ].join('\n');
}