// apps/api/src/modules/ai/player-search.service.ts

import { prisma } from '../../db/prisma.js';

function tokenize(message: string): string[] {
  return message
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);
}

export async function findMentionedPlayers(message: string, limit = 6) {
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
    .slice(0, limit)
    .map((x) => x.player);
}