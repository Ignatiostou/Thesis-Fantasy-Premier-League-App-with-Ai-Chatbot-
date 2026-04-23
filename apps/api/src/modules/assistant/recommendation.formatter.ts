// apps/api/src/modules/assistant/recommendation.formatter.ts
// Converts structured RecommendationBlock into human-readable prompt sections.
// This text is injected into the system prompt so the LLM answers are
// fully grounded in computed data rather than hallucinated facts.

import type {
  RecommendationBlock,
  CaptainRecommendation,
  PlayerComparisonRichResult,
  TransferEvaluation,
  PlayerSnapshot,
  FixtureSummary,
} from './recommendation.types.js';

// ── Shared helpers ────────────────────────────────────────────────────────────

function fmtCost(tenths: number): string {
  return `£${(tenths / 10).toFixed(1)}m`;
}

function fmtFixtures(fixtures: FixtureSummary[], max = 3): string {
  return fixtures
    .slice(0, max)
    .map((f) => `GW${f.gameweek} ${f.isHome ? 'H' : 'A'} vs ${f.opponent} (FDR ${f.difficulty})`)
    .join(' | ');
}

function fmtPlayer(p: PlayerSnapshot): string {
  const availability = p.chanceOfPlaying < 100 ? ` [${p.chanceOfPlaying}% fit]` : '';
  return (
    `${p.webName} (${p.club}, ${p.position}) | ` +
    `${fmtCost(p.nowCost)} | ` +
    `${p.totalPoints}pts | ` +
    `form ${p.form.toFixed(1)} | ` +
    `${p.selectedByPercent.toFixed(1)}% owned` +
    availability
  );
}

// ── Captain formatter ─────────────────────────────────────────────────────────

function formatCaptainBlock(rec: CaptainRecommendation): string {
  const lines: string[] = [
    `=== CAPTAINCY RECOMMENDATION DATA (GW${rec.gameweek}) ===`,
    `Computed top picks from squad — use these numbers in your response:`,
    '',
  ];

  rec.candidates.forEach((c, i) => {
    lines.push(`${i + 1}. ${fmtPlayer(c.player)}`);
    lines.push(`   Score: ${c.score}/100 | Form rating: ${c.formRating}/5 | Fixture rating: ${c.fixtureRating}/5`);
    lines.push(`   Next fixtures: ${fmtFixtures(c.player.nextFixtures)}`);
    lines.push(`   Reasoning: ${c.reasoning}`);
    if (c.isCurrentCaptain) lines.push(`   ⚠️  Currently captain`);
    lines.push('');
  });

  lines.push(`TOP PICK: ${rec.topPick.player.webName} (score ${rec.topPick.score}/100)`);

  if (rec.differential) {
    lines.push('');
    lines.push(`DIFFERENTIAL OPTION: ${fmtPlayer(rec.differential.player)}`);
    lines.push(`  Score ${rec.differential.score}/100 | ${rec.differential.player.selectedByPercent.toFixed(1)}% owned`);
    lines.push(`  Suitable if manager wants to differentiate from the template captain.`);
  }

  lines.push('');
  lines.push(`INSTRUCTION: Present these candidates ranked, use the computed scores and reasoning above.`);
  lines.push(`Do NOT invent alternative candidates not listed here.`);

  return lines.join('\n');
}

// ── Player comparison formatter ───────────────────────────────────────────────

function formatComparisonBlock(rec: PlayerComparisonRichResult): string {
  const lines: string[] = [
    `=== PLAYER COMPARISON DATA ===`,
    '',
    `Player A: ${fmtPlayer(rec.playerA)}`,
    `  Fixtures: ${fmtFixtures(rec.playerA.nextFixtures)}`,
    '',
    `Player B: ${fmtPlayer(rec.playerB)}`,
    `  Fixtures: ${fmtFixtures(rec.playerB.nextFixtures)}`,
    '',
    `HEAD-TO-HEAD BREAKDOWN:`,
  ];

  for (const d of rec.dimensions) {
    const winnerLabel = d.winner === 'A'
      ? `→ ${rec.playerA.webName} wins`
      : d.winner === 'B'
      ? `→ ${rec.playerB.webName} wins`
      : '→ Draw';
    lines.push(`  ${d.label.padEnd(28)} A: ${String(d.playerA).padEnd(20)} B: ${String(d.playerB).padEnd(20)} ${winnerLabel}`);
  }

  lines.push('');

  const winnerName = rec.verdict === 'A'
    ? rec.playerA.webName
    : rec.verdict === 'B'
    ? rec.playerB.webName
    : null;

  if (winnerName) {
    lines.push(`COMPUTED VERDICT: ${winnerName} — ${rec.reasoning}`);
  } else {
    lines.push(`COMPUTED VERDICT: Draw — ${rec.reasoning}`);
  }

  if (rec.priceDiff !== 0) {
    const expensive = rec.priceDiff > 0 ? rec.playerA.webName : rec.playerB.webName;
    const cheaper   = rec.priceDiff > 0 ? rec.playerB.webName : rec.playerA.webName;
    lines.push(`Price note: ${expensive} costs ${fmtCost(Math.abs(rec.priceDiff))} more than ${cheaper}.`);
  }

  lines.push('');
  lines.push(`INSTRUCTION: Use the dimension table above to structure your comparison.`);
  lines.push(`Present the computed verdict but explain the nuance. Do NOT invent stats.`);

  return lines.join('\n');
}

// ── Transfer evaluation formatter ─────────────────────────────────────────────

function formatTransferBlock(rec: TransferEvaluation): string {
  const lines: string[] = [
    `=== TRANSFER EVALUATION DATA (GW${rec.gameweek}) ===`,
    `Bank: ${fmtCost(rec.bank)} | Free transfers: ${rec.freeTransfers}`,
    '',
  ];

  if (rec.options.length === 0) {
    lines.push(`No specific transfer pair identified from message.`);
    lines.push(`Advise the manager on general transfer strategy given their bank and free transfers.`);
    return lines.join('\n');
  }

  rec.options.forEach((opt, i) => {
    lines.push(`Transfer ${i + 1}:`);
    lines.push(`  OUT: ${fmtPlayer(opt.playerOut)}`);
    lines.push(`       Fixtures: ${fmtFixtures(opt.playerOut.nextFixtures)}`);
    lines.push(`  IN:  ${fmtPlayer(opt.playerIn)}`);
    lines.push(`       Fixtures: ${fmtFixtures(opt.playerIn.nextFixtures)}`);
    lines.push(`  Budget impact:    ${opt.budgetImpact >= 0 ? '+' : ''}${fmtCost(opt.budgetImpact)} (new bank: ${fmtCost(rec.bank + opt.budgetImpact)})`);
    lines.push(`  Affordable:       ${opt.isAffordable ? 'Yes' : 'NO — insufficient budget'}`);
    lines.push(`  Position match:   ${opt.positionMatch ? 'Yes' : 'NO — different positions'}`);
    lines.push(`  Club limit ok:    ${opt.clubLimitOk  ? 'Yes' : 'NO — would exceed 3-per-club rule'}`);
    lines.push(`  Form delta:       ${opt.pointsDelta >= 0 ? '+' : ''}${opt.pointsDelta} pts (IN form vs OUT form)`);
    lines.push(`  Fixture swing:    ${opt.fixtureSwing >= 0 ? '+' : ''}${opt.fixtureSwing} (next 3 GWs avg)`);
    lines.push(`  Hit required:     ${opt.isHitRequired ? `Yes (-${opt.hitCost} pts)` : 'No'}`);
    lines.push(`  Net benefit est:  ${opt.netBenefit >= 0 ? '+' : ''}${opt.netBenefit} pts`);
    lines.push(`  Strength:         ${opt.recommendationStrength}`);
    lines.push('');
  });

  lines.push(`HIT ADVICE: ${rec.hitAdvice}`);
  lines.push(`Reason: ${rec.hitAdviceReason}`);

  if (rec.topOption) {
    lines.push('');
    lines.push(`BEST OPTION: ${rec.topOption.playerIn.webName} in for ${rec.topOption.playerOut.webName}`);
    lines.push(`  Strength: ${rec.topOption.recommendationStrength} | Net benefit: ${rec.topOption.netBenefit >= 0 ? '+' : ''}${rec.topOption.netBenefit} pts`);
  }

  lines.push('');
  lines.push(`INSTRUCTION: Ground your transfer advice in the data above.`);
  lines.push(`Mention affordability, position match, and hit cost explicitly if relevant.`);
  lines.push(`Do NOT recommend transfers not evaluated above without flagging they are not data-verified.`);

  return lines.join('\n');
}

// ── Main export ───────────────────────────────────────────────────────────────

export function formatRecommendationBlock(block: RecommendationBlock): string {
  if (!block.data) return '';

  switch (block.data.intent) {
    case 'CAPTAINCY':
      return formatCaptainBlock(block.data as CaptainRecommendation);
    case 'PLAYER_COMPARISON':
      return formatComparisonBlock(block.data as PlayerComparisonRichResult);
    case 'TRANSFER_ADVICE':
    case 'TRANSFER_EVALUATION':
      return formatTransferBlock(block.data as TransferEvaluation);
    default:
      return '';
  }
}