import type {
  PlayerProjection,
  SquadProjection,
  TransferDelta,
  CaptainProjection,
} from './projection.types.js';

function fmtCost(tenths: number): string {
  return `£${(tenths / 10).toFixed(1)}m`;
}

function fmtSource(p: PlayerProjection): string {
  return p.source === 'ML'
    ? `ML model, ${p.confidence} confidence`
    : `heuristic estimate`;
}

// ── Single player ─────────────────────────────────────────────────────────────

export function formatPlayerProjection(p: PlayerProjection): string {
  return [
    `${p.webName} (${p.club}, ${p.position}, ${fmtCost(p.nowCost)})`,
    `  xPts next GW:    ${p.xPtsNextGw} pts  [${fmtSource(p)}]`,
    `  xPts next 3 GWs: ${p.xPtsNext3Gw} pts`,
    `  xPts next 5 GWs: ${p.xPtsNext5Gw} pts`,
    `  Form score:       ${p.formScore}/10  (recent form: ${p.form.toFixed(1)})`,
    `  Fixture score:    ${p.fixtureScore}/10 (next FDR: ${p.nextFixtureFdr}, run: ${p.fixtureRun})`,
    `  Availability:     ${p.availabilityScore}/10 (${p.chanceOfPlaying}% chance of playing)`,
    `  Consistency:      ${p.consistencyScore}/10 (avg ${p.avgPts} pts/game)`,
    `  Overall outlook:  ${p.outlook.toUpperCase()}`,
  ].join('\n');
}

// ── Squad projection ──────────────────────────────────────────────────────────

export function formatSquadProjection(sq: SquadProjection): string {
  const coverageLabel = sq.mlCoverage >= 80
    ? `ML-backed (${sq.mlCoverage}% of squad)`
    : sq.mlCoverage > 0
    ? `partial ML coverage (${sq.mlCoverage}% of squad)`
    : `heuristic estimates only (no ML predictions loaded)`;

  const lines: string[] = [
    `=== SQUAD PROJECTION (GW${sq.gameweek}) — ${coverageLabel} ===`,
    `Projected GW score:   ${sq.projectedGwScore} pts  (XI: ${sq.totalXPtsNextGw} + captain bonus: ${sq.captainBonus})`,
    `Next 3 GWs XI total:  ${sq.totalXPtsNext3Gw} pts`,
    `Bench buffer (best):  ${sq.benchBuffer} xPts`,
    '',
    `Top returner:  ${sq.topReturner.webName} — ${sq.topReturner.xPtsNextGw} xPts (${sq.topReturner.outlook}) [${fmtSource(sq.topReturner)}]`,
    `Weakest link:  ${sq.weakestLink.webName} — ${sq.weakestLink.xPtsNextGw} xPts (${sq.weakestLink.outlook}) ← consider replacing`,
  ];

  if (sq.riskPlayers.length > 0) {
    lines.push('');
    lines.push('Risk players (availability concern):');
    sq.riskPlayers.forEach((p) => {
      lines.push(`  ⚠️  ${p.webName} — ${p.chanceOfPlaying}% chance of playing, xPts: ${p.xPtsNextGw}`);
    });
  }

  lines.push('');
  lines.push('All starters projected (● = ML  ○ = heuristic):');
  const starters = [...sq.picks].sort((a, b) => b.xPtsNextGw - a.xPtsNextGw);
  starters.forEach((p) => {
    const dot = p.source === 'ML' ? '●' : '○';
    lines.push(
      `  ${dot} ${p.position} | ${p.webName.padEnd(16)} | ${String(p.xPtsNextGw).padEnd(5)} xPts | ${p.fixtureRun} fixtures | ${p.outlook}`,
    );
  });

  lines.push('');
  lines.push('INSTRUCTION: Use these projections when discussing squad outlook,');
  lines.push('transfer targets, or captain options. Reference xPts values directly.');
  lines.push('For ML-backed players (●) use "projected". For heuristic (○) use "estimated".');
  lines.push('Always qualify statements when confidence is MEDIUM or LOW.');

  return lines.join('\n');
}

// ── Transfer delta ────────────────────────────────────────────────────────────

export function formatTransferDelta(delta: TransferDelta): string {
  const sign = (n: number) => (n >= 0 ? `+${n.toFixed(1)}` : n.toFixed(1));

  return [
    `=== TRANSFER PROJECTION ===`,
    `OUT: ${delta.playerOut.webName} (${delta.playerOut.club}, ${fmtCost(delta.playerOut.nowCost)})`,
    `  xPts next GW: ${delta.playerOut.xPtsNextGw} | next 3 GWs: ${delta.playerOut.xPtsNext3Gw} | outlook: ${delta.playerOut.outlook} | ${fmtSource(delta.playerOut)}`,
    `  Fixture run: ${delta.playerOut.fixtureRun} (avg FDR ${delta.playerOut.avgFdrNext3})`,
    '',
    `IN:  ${delta.playerIn.webName} (${delta.playerIn.club}, ${fmtCost(delta.playerIn.nowCost)})`,
    `  xPts next GW: ${delta.playerIn.xPtsNextGw} | next 3 GWs: ${delta.playerIn.xPtsNext3Gw} | outlook: ${delta.playerIn.outlook} | ${fmtSource(delta.playerIn)}`,
    `  Fixture run: ${delta.playerIn.fixtureRun} (avg FDR ${delta.playerIn.avgFdrNext3})`,
    '',
    `DELTA:`,
    `  xPts gain next GW:  ${sign(delta.xPtsDeltaNextGw)} pts`,
    `  xPts gain 3 GWs:    ${sign(delta.xPtsDeltaNext3Gw)} pts`,
    `  Hit required:       ${delta.hitRequired ? `Yes (-${delta.hitCost} pts)` : 'No'}`,
    `  Net benefit (GW1):  ${sign(delta.netBenefitAfterHit)} pts`,
    `  Verdict:            ${delta.verdict}`,
    `  Reason:             ${delta.verdictReason}`,
    '',
    `INSTRUCTION: Lead with the net benefit after any hit cost.`,
    `If verdict is DOWNGRADE or NEUTRAL with a hit, advise against unless there is a strong medium-term reason.`,
    `Use "projected" for ML-backed values, "estimated" for heuristic values.`,
  ].join('\n');
}

// ── Captain projection ────────────────────────────────────────────────────────

export function formatCaptainProjection(cp: CaptainProjection): string {
  const lines: string[] = [
    `=== CAPTAIN PROJECTION (GW${cp.gameweek}) ===`,
    `Projected captain points if doubled:`,
    '',
  ];

  cp.candidates.forEach((c, i) => {
    const tags: string[] = [];
    if (c.isSafePick)       tags.push('SAFE PICK');
    if (c.isHighUpside)     tags.push('HIGH UPSIDE');
    if (c.isCurrentCaptain) tags.push('CURRENT (C)');
    tags.push(c.source === 'ML' ? `ML ${c.confidence}` : 'heuristic');

    lines.push(`${i + 1}. ${c.webName} (${c.club}, ${c.position})  [${tags.join(', ')}]`);
    lines.push(`   Captain xPts: ${c.captainXPts} pts  (base: ${c.xPtsNextGw})`);
    lines.push(`   Fixture: ${c.fixtureRun}`);
    lines.push('');
  });

  if (cp.topPick.playerId !== cp.safePick.playerId) {
    lines.push(`TOP PICK (highest projected):  ${cp.topPick.webName} — ${cp.topPick.captainXPts} xPts doubled`);
    lines.push(`SAFE PICK (reliable):          ${cp.safePick.webName} — ${cp.safePick.captainXPts} xPts doubled`);
  } else {
    lines.push(`TOP PICK: ${cp.topPick.webName} — ${cp.topPick.captainXPts} xPts doubled (also safest)`);
  }

  if (cp.upside.playerId !== cp.topPick.playerId) {
    lines.push(`UPSIDE PICK (high ceiling):    ${cp.upside.webName} — ${cp.upside.captainXPts} xPts doubled`);
  }

  lines.push('');
  lines.push('INSTRUCTION: Present options ranked by captain xPts.');
  lines.push('Use "projected" for ML-backed values, "estimated" for heuristic values.');
  lines.push('Always mention confidence level. Do NOT invent alternatives not listed here.');

  return lines.join('\n');
}