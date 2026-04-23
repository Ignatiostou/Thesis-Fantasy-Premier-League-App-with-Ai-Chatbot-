// apps/api/src/modules/assistant/assistant.prompts.ts
// UPDATED for Phase 3: accepts optional RecommendationBlock and injects
// its formatted output into the system prompt for fully grounded answers.

import type { AssistantIntent } from '@fpl/types';
import type { AssistantContextPacket } from './assistant.internal.types.js';
import type { RecommendationBlock } from './recommendation.types.js';
import { formatRecommendationBlock } from './recommendation.formatter.js';

// ── Profile description helpers ───────────────────────────────────────────────

function describeRisk(v: number) {
  return v === 1 ? 'low-risk / conservative' : v === 3 ? 'high-risk / aggressive' : 'balanced risk';
}
function describeBudget(v: number) {
  return v === 1 ? 'value-oriented (cheap overperformers)' : v === 3 ? 'premium-heavy' : 'balanced budget';
}
function describeFocus(v: number) {
  return v === 1 ? 'defensive (clean sheets & bonus)' : v === 3 ? 'attack-first' : 'midfield-oriented';
}
function describeDifferentials(v: number) {
  return v === 1 ? 'safe / high-ownership picks' : v === 3 ? 'loves differentials & low-ownership upside' : 'balanced ownership profile';
}
function describeHorizon(v: number) {
  return v === 1 ? 'short-term / fixture exploiter' : v === 3 ? 'long-term squad stability' : 'balanced planning horizon';
}
function describeExplanation(v: number) {
  return v === 1 ? 'brief' : v === 3 ? 'highly detailed' : 'medium detail';
}

// ── Context formatter ─────────────────────────────────────────────────────────

function formatContext(context: AssistantContextPacket): string {
  const lines: string[] = [];

  lines.push('=== GAME STATE ===');
  lines.push(`Editable Gameweek: GW${context.game.editableGameweek ?? 'unknown'}`);
  if (context.game.nextDeadline) {
    lines.push(`Next Deadline: ${context.game.nextDeadline}`);
  }

  lines.push('\n=== MANAGER PROFILE ===');
  if (!context.profile) {
    lines.push('No profile yet — user has not completed onboarding.');
  } else {
    const p = context.profile;
    lines.push(`Risk style:            ${describeRisk(p.riskTolerance)}`);
    lines.push(`Budget style:          ${describeBudget(p.budgetStyle)}`);
    lines.push(`Pitch focus:           ${describeFocus(p.preferredFocus)}`);
    lines.push(`Differential appetite: ${describeDifferentials(p.differentialPreference)}`);
    lines.push(`Planning horizon:      ${describeHorizon(p.planningHorizon)}`);
    lines.push(`Explanation depth:     ${describeExplanation(p.explanationDepth)}`);
    if (p.favoriteTeams?.length) lines.push(`Favourite clubs:       ${p.favoriteTeams.join(', ')}`);
    if (p.notes)                 lines.push(`Extra context:         ${p.notes}`);
  }

  lines.push('\n=== CURRENT SQUAD ===');
  const team = (context.team as any)?.team ?? null;

  if (!team) {
    lines.push('No team yet — user has not built their initial squad.');
  } else {
    lines.push(`Team name:   ${team.name}`);
    lines.push(`Gameweek:    GW${team.gameweek}`);
    lines.push(`Total pts:   ${team.totalPoints ?? 0}`);
    lines.push(`Active chip: ${team.activeChip ?? 'none'}`);

    const picks: any[] = team.picks ?? [];
    const starters = picks.filter((p: any) => !p.isOnBench);
    const bench    = picks.filter((p: any) => p.isOnBench);
    const POS: Record<number, string> = { 1:'GK', 2:'DEF', 3:'MID', 4:'FWD' };

    if (starters.length) {
      lines.push('\nStarting XI:');
      for (const p of starters) {
        const flags = [
          p.isCaptain     ? '(C)'  : '',
          p.isViceCaptain ? '(VC)' : '',
          p.status && p.status !== 'a' ? `[${String(p.status).toUpperCase()}]` : '',
          p.chanceOfPlayingNextRound != null && p.chanceOfPlayingNextRound < 75
            ? `(${p.chanceOfPlayingNextRound}% chance)` : '',
        ].filter(Boolean).join(' ');
        lines.push(
          `  ${POS[p.position]??'?'} | ${p.webName} (${p.team?.shortName??'?'})` +
          ` | £${(p.nowCost/10).toFixed(1)}m | ${p.totalPoints??0}pts ${flags}`,
        );
      }
    }
    if (bench.length) {
      lines.push('\nBench:');
      for (const p of bench) {
        lines.push(
          `  ${POS[p.position]??'?'} | ${p.webName} (${p.team?.shortName??'?'})` +
          ` | £${(p.nowCost/10).toFixed(1)}m | ${p.totalPoints??0}pts`,
        );
      }
    }
  }

  lines.push('\n=== TRANSFER STATE ===');
  const tr = context.transfers as any;
  if (!tr?.gwState) {
    lines.push('Transfer state unavailable.');
  } else {
    const bank = tr.team?.budgetLeft ?? 0;
    lines.push(`Bank:             £${(bank/10).toFixed(1)}m`);
    lines.push(`Free transfers:   ${tr.gwState.freeTransfers}`);
    lines.push(`Transfers made:   ${tr.gwState.transfersMade}`);
    lines.push(`Active chip:      ${tr.gwState.activeChip ?? 'none'}`);
    lines.push(`Wildcard avail:   ${tr.gwState.wildcardAvailable ? 'yes' : 'no'}`);
    if (tr.gwState.pointsHit > 0) lines.push(`Hit cost pending: -${tr.gwState.pointsHit} pts`);
  }

  lines.push('\n=== CHIPS ===');
  const chips = context.chips as any;
  if (!chips?.chips) {
    lines.push('Chip state unavailable.');
  } else {
    for (const c of chips.chips) {
      lines.push(`  ${c.chip}: ${c.available ? 'available' : `used in GW${c.usedInGw ?? '?'}`}`);
    }
  }

  return lines.join('\n');
}

// ── Intent guidance ───────────────────────────────────────────────────────────

function getIntentGuidance(intent: AssistantIntent): string {
  switch (intent) {
    case 'TRANSFER_ADVICE':
    case 'TRANSFER_EVALUATION':
      return `You have COMPUTED TRANSFER DATA below. Use it.
Structure: 1) recommendation, 2) reasoning from data, 3) budget & hit impact, 4) risk, 5) alternative.
Never recommend a transfer not evaluated in the data without flagging it.`;
    case 'CAPTAINCY':
      return `You have COMPUTED CAPTAINCY SCORES below. Use them.
Rank the top candidates by score, explain form and fixture for each.
Always mention the differential option if present and the manager likes differentials.`;
    case 'BENCH_ORDER':
      return `Recommend bench order based on: likelihood of starting, fixture difficulty, auto-sub value.
Consider injury risk and rotation. Explain the reasoning for each bench slot.`;
    case 'FORMATION_ADVICE':
      return `Recommend formation based on squad strength, fixture context, and manager's profile.
Explain attacking vs defensive trade-offs of each option.`;
    case 'CHIP_ADVICE':
      return `Assess chip usage based on: fixture run, squad strength, remaining chips, gameweek context.
Never recommend using a chip that's already been played (check chip state above).`;
    case 'PLAYER_COMPARISON':
      return `You have COMPUTED COMPARISON DATA below. Use the dimension table.
Present the verdict but explain the nuance — the computed winner may not always be right for this manager's profile.`;
    case 'INITIAL_SQUAD':
      return `Help build a balanced 15-man squad within £100m.
Rules: 2 GK, 5 DEF, 5 MID, 3 FWD. Max 3 per club.
Align structure with the manager's budget style and pitch focus.`;
    case 'ONBOARDING':
      return `Guide the user through profile setup. Explain why each question matters for personalisation.`;
    default:
      return `Provide clear, specific FPL advice grounded in the context provided.`;
  }
}

// ── Explanation depth ─────────────────────────────────────────────────────────

function getExplanationGuidance(depth: number | undefined): string {
  switch (depth) {
    case 1: return 'BRIEF: Lead with recommendation. 1-2 sentences of reasoning. No walls of text.';
    case 3: return 'DETAILED: Full analysis — fixture breakdown, stats, ownership context, risks, alternatives. Be thorough.';
    default: return 'MEDIUM: Recommendation + 3-4 key reasons + one alternative. Clear and balanced.';
  }
}

// ── Main builder ──────────────────────────────────────────────────────────────

export function buildSystemPrompt(
  intent:          AssistantIntent,
  context:         AssistantContextPacket,
  recentMessages:  Array<{ role: 'USER' | 'ASSISTANT'; content: string }>,
  // NEW: Phase 3 — optional pre-computed recommendation block
  recommendation?: RecommendationBlock | null,
): string {
  const explanationDepth  = context.profile?.explanationDepth;
  const formattedContext  = formatContext(context);
  const intentGuidance    = getIntentGuidance(intent);
  const explanationGuide  = getExplanationGuidance(explanationDepth);
  const recommendationStr = recommendation
    ? formatRecommendationBlock(recommendation)
    : '';

  return `You are CoachBot — an expert Fantasy Premier League (FPL) coaching assistant.

## YOUR ROLE
Collaborative decision-support advisor. Help the manager think strategically. Never act autonomously. The manager always makes the final call.

## CORE RULES
- NEVER execute transfers, change lineups, or take any autonomous action
- NEVER invent squad data, fixtures, or stats — use ONLY the context and computed data provided
- If computed data is present below, your answer MUST be grounded in it
- ALWAYS explain reasoning — not just the answer
- ALWAYS acknowledge uncertainty — FPL has variance, never promise points
- ALWAYS personalise to the manager's profile
- If context is incomplete, say so briefly and answer conservatively

## FPL RULES
- Squad: 15 players (2 GK, 5 DEF, 5 MID, 3 FWD)
- Starting XI: valid formation (min 3 DEF, 2 MID, 1 FWD, 1 GK)
- Budget: £100m total; bank = remaining money
- Max 3 players per Premier League club
- Free transfers: 1 per GW, rolls to max 2; extra = -4 pts each
- Captain = double points; vice-captain covers if captain plays 0 mins
- Chips: Wildcard ×2 (GW1-19 / GW20-38), Bench Boost, Triple Captain, Free Hit — each once
- Prices in tenths: 75 = £7.5m

## CURRENT INTENT: ${intent}
${intentGuidance}

## RESPONSE FORMAT
${explanationGuide}

Structure:
1. **Recommendation** — the clear answer
2. **Reasoning** — grounded in the computed data and context
3. **Risk** — what could go wrong
4. **Alternative** — one other option

${recommendationStr ? `## COMPUTED RECOMMENDATION DATA\n${recommendationStr}\n` : ''}
## MANAGER CONTEXT
${formattedContext}

## RECENT CONVERSATION
${recentMessages.length > 0
  ? recentMessages.map((m) => `${m.role}: ${m.content}`).join('\n')
  : 'No previous messages in this session.'}

CRITICAL: Every specific stat, score, or fixture you mention must come from the data above. Never hallucinate player stats.`.trim();
}