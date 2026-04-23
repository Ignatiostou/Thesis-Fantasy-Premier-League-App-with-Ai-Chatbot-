// apps/api/src/modules/ai/captaincy.service.ts

import { prisma } from '../../db/prisma.js';
import { getEditableGameweekId } from '../../utils/gameweek.js';
import type { CaptainCandidateSummary } from './recommendation.types.js';

const POSITION_LABEL: Record<number, string> = {
  1: 'GK',
  2: 'DEF',
  3: 'MID',
  4: 'FWD',
};

function safeNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function getFixtureDifficultyForPlayerTeam(
  fixtures: Array<{
    teamHId:         number;
    teamAId:         number;
    teamHDifficulty: number | null;
    teamADifficulty: number | null;
  }>,
  teamId: number,
): number {
  const relevant = fixtures.filter((f) => f.teamHId === teamId || f.teamAId === teamId);

  if (!relevant.length) return 3;

  const difficultyValues = relevant.map((f) =>
    f.teamHId === teamId ? (f.teamHDifficulty ?? 3) : (f.teamADifficulty ?? 3),
  );

  return difficultyValues.reduce((a, b) => a + b, 0) / difficultyValues.length;
}

export async function getCaptainRecommendations(
  userId: string,
): Promise<CaptainCandidateSummary[]> {
  const gameweek = await getEditableGameweekId();

  const team = await prisma.userTeam.findUnique({
    where:  { userId },
    select: { id: true },
  });

  if (!team) return [];

  const [picks, fixtures] = await Promise.all([
    prisma.userPick.findMany({
      where: {
        userTeamId: team.id,
        gameweek,
        isOnBench:  false,
      },
      orderBy: { position: 'asc' },
      include: {
        player: { include: { team: true } },
      },
    }),
    prisma.fplFixture.findMany({
      where: {
        event:    gameweek,
        finished: false,
      },
      select: {
        teamHId:         true,
        teamAId:         true,
        teamHDifficulty: true,
        teamADifficulty: true,
      },
    }),
  ]);

  const candidates: CaptainCandidateSummary[] = picks
    .filter((pick) => pick.player.position !== 1)  // exclude GKs
    .map((pick) => {
      const form             = safeNumber(pick.player.form, 0);
      const totalPoints      = pick.player.totalPoints ?? 0;
      const chance           = pick.player.chanceOfPlayingNextRound ?? 100;
      const fixtureDifficulty = getFixtureDifficultyForPlayerTeam(fixtures, pick.player.teamId);

      let score = 0;
      score += form * 4;
      score += totalPoints * 0.08;
      score += chance >= 75 ? 8 : chance >= 50 ? 3 : -4;
      score += (6 - fixtureDifficulty) * 3;

      // Position bonus: FWD > MID > DEF
      if (pick.player.position === 4) score += 5;
      if (pick.player.position === 3) score += 4;
      if (pick.player.position === 2) score += 1;

      const reasons: string[] = [];
      const risk:    string[] = [];

      if (form >= 5)      reasons.push(`strong recent form (${form.toFixed(1)})`);
      else if (form >= 3) reasons.push(`decent recent form (${form.toFixed(1)})`);

      if (fixtureDifficulty <= 2)      reasons.push('very favorable fixture');
      else if (fixtureDifficulty <= 3) reasons.push('reasonable fixture');

      if (chance >= 75)   reasons.push('good likelihood of starting');
      else                risk.push(`minutes/availability risk (${chance}% chance)`);

      if (pick.player.status !== 'a') risk.push(`status flag: ${pick.player.status}`);

      return {
        playerId: pick.player.id,
        webName:  pick.player.webName,
        club:     pick.player.team.shortName,
        position: POSITION_LABEL[pick.player.position] ?? 'UNK',
        score:    Number(score.toFixed(2)),
        reasons,
        risk,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  return candidates;
}