import type { PlayerComparisonSimpleResult } from './recommendation.types.js';
import { findMentionedPlayersDetailed } from './player-search.service.js';

const POSITION_LABEL: Record<number, string> = {
  1: 'GK',
  2: 'DEF',
  3: 'MID',
  4: 'FWD',
};

function safeForm(value: unknown): number | null {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export async function compareMentionedPlayers(
  message: string,
): Promise<PlayerComparisonSimpleResult> {
  // MODERATE: comparisons are informational (not a money-spending action),
  // but we still don't want to compare someone who's clearly left the league.
  const { players, excluded } = await findMentionedPlayersDetailed(message, 4, {
    eligibilityMode: 'MODERATE',
  });

  if (players.length < 2) {
    // IMPROVEMENT #11: if we excluded someone, tell the manager why instead
    // of a generic "could not identify two players" message.
    if (excluded.length > 0) {
      const names = excluded.map((e) => e.webName).join(', ');
      return {
        found: false,
        players: [],
        recommendation:
          `I found a name match for ${names}, but they don't appear to be active in the Premier League right now ` +
          `(${excluded[0].reasons.join('; ')}). Could you confirm the player, or pick someone else to compare?`,
      };
    }
    return {
      found: false,
      players: [],
      recommendation:
        'I could not confidently identify two players to compare from the message.',
    };
  }

  const selected = players.slice(0, 2);

  const mapped = selected.map((p) => {
    const form = safeForm(p.form);
    const pros: string[] = [];
    const cons: string[] = [];

    if ((p.totalPoints ?? 0) >= 100) pros.push('strong season output');
    if (form !== null && form >= 5)   pros.push(`excellent recent form (${form.toFixed(1)})`);
    if ((p.chanceOfPlayingNextRound ?? 100) >= 75) pros.push('good expected availability');

    if ((p.chanceOfPlayingNextRound ?? 100) < 75) cons.push('possible minutes/availability risk');
    if (p.status !== 'a')              cons.push(`status flag: ${p.status}`);
    if ((p.totalPoints ?? 0) < 40)    cons.push('weaker season sample so far');

    return {
      playerId:                p.id,
      webName:                 p.webName,
      club:                    p.team.shortName,
      position:                POSITION_LABEL[p.position] ?? 'UNK',
      nowCost:                 p.nowCost,
      totalPoints:             p.totalPoints ?? 0,
      form,
      chanceOfPlayingNextRound:p.chanceOfPlayingNextRound ?? null,
      status:                  p.status,
      pros,
      cons,
    };
  });

  const [a, b] = mapped;

  const aScore =
    (a.totalPoints * 0.1) +
    ((a.form ?? 0) * 5) +
    ((a.chanceOfPlayingNextRound ?? 100) >= 75 ? 8 : 0) -
    (a.status !== 'a' ? 5 : 0);

  const bScore =
    (b.totalPoints * 0.1) +
    ((b.form ?? 0) * 5) +
    ((b.chanceOfPlayingNextRound ?? 100) >= 75 ? 8 : 0) -
    (b.status !== 'a' ? 5 : 0);

  const recommendation =
    aScore > bScore
      ? `${a.webName} looks like the stronger all-around option right now, although the final choice depends on your squad structure and budget.`
      : `${b.webName} looks like the stronger all-around option right now, although the final choice depends on your squad structure and budget.`;

  return {
    found: true,
    players: mapped,
    recommendation,
  };
}
