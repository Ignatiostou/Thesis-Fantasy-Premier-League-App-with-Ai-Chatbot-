import { prisma } from '../../db/prisma.js';
import {
  buildEligibilitySnapshots,
  checkEligibility,
  type EligibilityMode,
} from './player-eligibility.service.js';

function tokenize(message: string): string[] {
  return message
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);
}

export interface FindMentionedPlayersOptions {
  
  eligibilityMode?: EligibilityMode;
}

export interface MentionedPlayerResult {
  
  players: Awaited<ReturnType<typeof rawNameMatch>>;
  excluded: Array<{ webName: string; reasons: string[] }>;
}

async function rawNameMatch(message: string, limit: number) {
  const tokens = [...new Set(tokenize(message))];
  if (!tokens.length) return [];

  const players = await prisma.fplPlayer.findMany({
    where: {
      OR: tokens.flatMap((token) => [
        { webName: { contains: token, mode: 'insensitive' } },
        { firstName: { contains: token, mode: 'insensitive' } },
        { secondName: { contains: token, mode: 'insensitive' } },
      ]),
    },
    include: { team: true },
    take: 20,
  });

  const scored = players.map((p) => {
    const haystack = `${p.webName} ${p.firstName} ${p.secondName}`.toLowerCase();
    let score = 0;
    for (const token of tokens) {
      if (p.webName.toLowerCase() === token) score += 5;
      if (haystack.includes(token)) score += 2;
    }
    return { player: p, score };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit * 3) // overfetch — eligibility filtering may remove some
    .map((x) => x.player);
}


export async function findMentionedPlayers(
  message: string,
  limit = 6,
  options: FindMentionedPlayersOptions = {},
) {
  const { players, excluded } = await findMentionedPlayersDetailed(message, limit, options);
  void excluded; // available via findMentionedPlayersDetailed for callers that want the reason text
  return players;
}


export async function findMentionedPlayersDetailed(
  message: string,
  limit = 6,
  options: FindMentionedPlayersOptions = {},
): Promise<MentionedPlayerResult> {
  const mode = options.eligibilityMode ?? 'PERMISSIVE';
  const candidates = await rawNameMatch(message, limit);
  if (!candidates.length) return { players: [], excluded: [] };

  const snapshots = await buildEligibilitySnapshots(candidates.map((c) => c.id));

  const players: typeof candidates = [];
  const excluded: Array<{ webName: string; reasons: string[] }> = [];

  for (const c of candidates) {
    const result = checkEligibility(snapshots.get(c.id), mode);
    if (result.eligible) {
      players.push(c);
      if (players.length >= limit) break;
    } else {
      excluded.push({ webName: c.webName, reasons: result.reasons });
    }
  }

  return { players, excluded };
}
