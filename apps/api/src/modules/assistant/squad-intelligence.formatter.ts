

import type {
  FormationRecommendation,
  BenchOrderRecommendation,
  LineupOptimization,
  WeakLinksAnalysis,
  SquadIntelligence,
} from './squad-intelligence.types.js';

function fmtCost(tenths: number): string {
  return `£${(tenths / 10).toFixed(1)}m`;
}

function sign(n: number): string {
  return n >= 0 ? `+${n.toFixed(1)}` : n.toFixed(1);
}

// ── Formation block ───────────────────────────────────────────────────────────

export function formatFormationRecommendation(rec: FormationRecommendation): string {
  const lines: string[] = [
    `=== FORMATION ANALYSIS (GW${rec.gameweek}) ===`,
    `Current formation: ${rec.currentFormation}  (${rec.currentXPts} xPts projected)`,
    '',
    `Formation options ranked by projected GW points:`,
    '',
  ];

  rec.options.slice(0, 4).forEach((opt, i) => {
    const isCurrent = opt.code === rec.currentFormation;
    const isBest    = i === 0;
    const tags      = [isCurrent ? '← current' : '', isBest && !isCurrent ? '← RECOMMENDED' : ''].filter(Boolean).join(' ');
    lines.push(`${i + 1}. ${opt.code}  ${tags}`);
    lines.push(`   Projected XI xPts next GW:  ${opt.totalXPtsNextGw}`);
    lines.push(`   Projected XI xPts 3 GWs:    ${opt.totalXPtsNext3Gw}`);
    lines.push(`   Attacking score: ${opt.attackingScore}/10  |  Defensive score: ${opt.defensiveScore}/10  |  Balance: ${opt.balanceScore}/10`);
    if (opt.starters.length > 0) {
      const topStarterByPos: Record<string, string> = {};
      for (const p of opt.starters) {
        if (!topStarterByPos[p.position]) topStarterByPos[p.position] = `${p.webName}(${p.xPtsNextGw})`;
      }
      lines.push(`   Key starters: ${Object.values(topStarterByPos).join(' | ')}`);
    }
    lines.push('');
  });

  lines.push(`RECOMMENDATION: ${rec.reasoning}`);
  lines.push('');
  lines.push(`Best gain from switching: ${sign(rec.bestGain)} pts projected`);
  lines.push('');
  lines.push('INSTRUCTION: Lead with whether the manager should switch formation.');
  lines.push('Show the top 2-3 options with their projected scores.');
  lines.push('Only recommend a switch if the gain is meaningful (≥1 pt).');

  return lines.join('\n');
}

// ── Bench order block ─────────────────────────────────────────────────────────

export function formatBenchOrder(rec: BenchOrderRecommendation): string {
  const lines: string[] = [
    `=== BENCH ORDER ANALYSIS (GW${rec.gameweek}) ===`,
    '',
  ];

  if (!rec.changed) {
    lines.push(`Current bench order is already optimal.`);
    lines.push('');
  } else {
    lines.push(`⚠️  Bench order should be changed.`);
    lines.push('');
  }

  lines.push(`SUGGESTED BENCH ORDER:`);
  rec.suggestedOrder.forEach((slot) => {
    lines.push(
      `  ${slot.order}. ${slot.player.webName.padEnd(16)} | ${slot.player.position} | ` +
      `${slot.player.xPtsNextGw} xPts | auto-sub value: ${slot.autoSubValue} | ${slot.reasoning}`,
    );
  });

  if (rec.changed) {
    lines.push('');
    lines.push(`CURRENT BENCH ORDER (for comparison):`);
    rec.currentOrder.forEach((slot) => {
      lines.push(
        `  ${slot.order}. ${slot.player.webName.padEnd(16)} | ${slot.player.xPtsNextGw} xPts`,
      );
    });
  }

  lines.push('');
  lines.push(`KEY INSIGHT: ${rec.keyInsight}`);
  lines.push('');
  lines.push('INSTRUCTION: Recommend the bench order above. Explain why the first sub matters most.');
  lines.push('Always confirm the backup GK goes last unless there is an injury concern.');

  return lines.join('\n');
}

// ── Lineup optimizer block ────────────────────────────────────────────────────

export function formatLineupOptimization(opt: LineupOptimization): string {
  const lines: string[] = [
    `=== OPTIMAL LINEUP (GW${opt.gameweek}) ===`,
    `Best formation: ${opt.bestFormation}`,
    `Projected GW score: ${opt.totalXPtsNextGw} xPts  (overall outlook: ${opt.overallOutlook.toUpperCase()})`,
    '',
    `BEST STARTING XI (ranked by projected points):`,
  ];

  opt.bestXI.forEach((p, i) => {
    const isCaptain = p.playerId === opt.captainSuggestion.playerId;
    const isVc      = p.playerId === opt.vcSuggestion.playerId;
    const tag       = isCaptain ? ' (C)' : isVc ? ' (VC)' : '';
    lines.push(
      `  ${i + 1}. ${p.position} | ${p.webName}${tag} (${p.club}) | ` +
      `${p.xPtsNextGw} xPts | ${p.fixtureRun} fixtures | ${p.outlook}`,
    );
  });

  lines.push('');
  lines.push(`SUGGESTED BENCH:`);
  opt.bench.forEach((p, i) => {
    lines.push(
      `  ${i + 1}. ${p.position} | ${p.webName} (${p.club}) | ${p.xPtsNextGw} xPts`,
    );
  });

  lines.push('');
  lines.push(`Captain: ${opt.captainSuggestion.webName} (${opt.captainSuggestion.xPtsNextGw} xPts base)`);
  lines.push(`VC:      ${opt.vcSuggestion.webName} (${opt.vcSuggestion.xPtsNextGw} xPts base)`);

  if (opt.changesFromCurrent.length > 0) {
    lines.push('');
    lines.push(`SUGGESTED CHANGES FROM CURRENT LINEUP:`);
    opt.changesFromCurrent.forEach((c) => {
      lines.push(`  ${c.type === 'START' ? '▲ START' : '▼ BENCH'}: ${c.player.webName} — ${c.reason}`);
    });
  } else {
    lines.push('');
    lines.push(`Current lineup already matches the optimal selection.`);
  }

  lines.push('');
  lines.push('INSTRUCTION: Present the best XI. Highlight any changes from the current lineup.');
  lines.push('Always explain the captain pick. Flag risk players (chanceOfPlaying < 75).');

  return lines.join('\n');
}

// ── Weak links block ──────────────────────────────────────────────────────────

export function formatWeakLinks(analysis: WeakLinksAnalysis): string {
  const lines: string[] = [
    `=== WEAK LINKS & UPGRADE TARGETS (GW${analysis.gameweek}) ===`,
    `Squad strength: ${analysis.squadStrength}`,
    `Summary: ${analysis.squadSummary}`,
    '',
  ];

  analysis.weakLinks.forEach((wl) => {
    lines.push(`${wl.rank}. ${wl.player.webName} (${wl.player.club}, ${wl.player.position})  [${wl.urgency} urgency]`);
    lines.push(`   xPts next GW: ${wl.player.xPtsNextGw}  |  outlook: ${wl.player.outlook}`);
    lines.push(`   Issues: ${wl.reasons.join('; ')}`);

    if (wl.suggestedReplacements.length > 0) {
      lines.push(`   Upgrade options:`);
      wl.suggestedReplacements.forEach((r) => {
        const affordText   = r.isAffordable ? 'affordable' : `${fmtCost(r.budgetGap)} short`;
        const transferText = r.transferCost > 0 ? '-4pt hit' : 'free transfer';
        lines.push(
          `     → ${r.player.webName} (${r.player.club}) | ${r.player.xPtsNextGw} xPts | ` +
          `${sign(r.xPtsDeltaNextGw)} pts gain | ${affordText} | ${transferText}`,
        );
      });
    } else {
      lines.push(`   No clearly better replacements found in same position.`);
    }
    lines.push('');
  });

  lines.push('INSTRUCTION: Rank the weak links by urgency. For each, explain why they are a problem');
  lines.push('and present the best affordable upgrade option. Check budget carefully.');
  lines.push('If no upgrade is clearly better AND affordable, say so — do not force a recommendation.');

  return lines.join('\n');
}

// ── Full squad intelligence block ─────────────────────────────────────────────
// Used when intent is GENERAL_HELP or FORMATION_ADVICE to give the LLM
// a complete picture of the squad.

export function formatSquadIntelligence(intel: SquadIntelligence): string {
  return [
    formatLineupOptimization(intel.lineup),
    '',
    formatFormationRecommendation(intel.formation),
    '',
    formatBenchOrder(intel.benchOrder),
    '',
    formatWeakLinks(intel.weakLinks),
  ].join('\n');
}

// ── Intent-targeted formatter ─────────────────────────────────────────────────
// Returns only the relevant section for a given intent — keeps the prompt lean.

export function formatForIntent(
  intel: SquadIntelligence,
  intent: string,
): string {
  switch (intent) {
    case 'FORMATION_ADVICE':
      return formatFormationRecommendation(intel.formation);
    case 'BENCH_ORDER':
      return formatBenchOrder(intel.benchOrder);
    case 'LINEUP_ADVICE':
      return formatLineupOptimization(intel.lineup);
    case 'WEAK_LINKS':
    case 'TRANSFER_ADVICE':
    case 'TRANSFER_EVALUATION':
      // Transfer questions benefit from weak link context
      return formatWeakLinks(intel.weakLinks);
    default:
      // GENERAL_HELP, INITIAL_SQUAD — full picture
      return formatSquadIntelligence(intel);
  }
}