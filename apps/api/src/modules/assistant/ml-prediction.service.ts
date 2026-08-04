// apps/api/src/modules/ai/ml-prediction.service.ts

import { prisma } from '../../db/prisma.js';
import type {
  PlayerPredictionDto,
  PlayerPredictionLookupResult,
  SquadPredictionSummary,
} from './ml-prediction.types.js';

const POSITION_LABEL: Record<number, 'GK' | 'DEF' | 'MID' | 'FWD'> = {
  1: 'GK',
  2: 'DEF',
  3: 'MID',
  4: 'FWD',
};

function round2(value: number | null | undefined): number {
  return Number((value ?? 0).toFixed(2));
}

function round4(value: number | null | undefined): number {
  return Number((value ?? 0).toFixed(4));
}

function toDto(row: any): PlayerPredictionDto {
  return {
    playerId:         row.playerId,
    webName:          row.player?.webName ?? `Player ${row.playerId}`,
    club:             row.player?.team?.shortName ?? 'UNK',
    position:         POSITION_LABEL[row.player?.position] ?? 'UNK',
    gameweek:         row.gameweek,
    predictedPtsGw1:  round2(row.predictedPtsGw1),
    predictedPtsGw3:  round2(row.predictedPtsGw3),
    predictedPtsGw5:  round2(row.predictedPtsGw5),
    predictedMinutes: round2(row.predictedMinutes),
    probPlaying:      round4(row.probPlaying),
    prob60PlusMins:   round4(row.prob60PlusMins),
    confidence:       row.confidence,
    modelVersion:     row.modelVersion,
    generatedAt:      row.generatedAt.toISOString(),
  };
}

export async function getLatestPredictionGameweek(): Promise<number | null> {
  const latest = await prisma.playerPrediction.findFirst({
    orderBy: [{ gameweek: 'desc' }, { generatedAt: 'desc' }],
    select:  { gameweek: true },
  });
  return latest?.gameweek ?? null;
}

export async function getLatestModelVersionForGameweek(
  gameweek: number,
): Promise<string | null> {
  const latest = await prisma.playerPrediction.findFirst({
    where:   { gameweek },
    orderBy: { generatedAt: 'desc' },
    select:  { modelVersion: true },
  });
  return latest?.modelVersion ?? null;
}

export async function getPredictionsForGameweek(
  gameweek: number,
): Promise<PlayerPredictionDto[]> {
  const modelVersion = await getLatestModelVersionForGameweek(gameweek);

  const rows = await prisma.playerPrediction.findMany({
    where: {
      gameweek,
      ...(modelVersion ? { modelVersion } : {}),
    },
    include: {
      player: { include: { team: true } },
    },
    orderBy: [{ predictedPtsGw1: 'desc' }],
  });

  return rows.map(toDto);
}

export async function getPredictionLookupForGameweek(
  gameweek?: number | null,
): Promise<PlayerPredictionLookupResult> {
  const resolvedGameweek = gameweek ?? (await getLatestPredictionGameweek());

  if (!resolvedGameweek) {
    return { gameweek: null, modelVersion: null, byPlayerId: new Map() };
  }

  const modelVersion = await getLatestModelVersionForGameweek(resolvedGameweek);

  const rows = await prisma.playerPrediction.findMany({
    where: {
      gameweek: resolvedGameweek,
      ...(modelVersion ? { modelVersion } : {}),
    },
    include: {
      player: { include: { team: true } },
    },
  });

  const byPlayerId = new Map<number, PlayerPredictionDto>();
  for (const row of rows) {
    byPlayerId.set(row.playerId, toDto(row));
  }

  return { gameweek: resolvedGameweek, modelVersion, byPlayerId };
}

export async function getPredictionsForPlayerIds(
  playerIds: number[],
  gameweek?: number | null,
): Promise<PlayerPredictionDto[]> {
  if (!playerIds.length) return [];
  const lookup = await getPredictionLookupForGameweek(gameweek);
  return playerIds
    .map((id) => lookup.byPlayerId.get(id))
    .filter((p): p is PlayerPredictionDto => Boolean(p));
}

export async function buildSquadPredictionSummary(
  playerIds: number[],
  gameweek?: number | null,
): Promise<SquadPredictionSummary | null> {
  const lookup = await getPredictionLookupForGameweek(gameweek);

  if (!lookup.gameweek) return null;

  const players = playerIds
    .map((id) => lookup.byPlayerId.get(id))
    .filter((p): p is PlayerPredictionDto => Boolean(p));

  // mlCoverage: what % of the requested playerIds have ML predictions
  const mlCoverage = playerIds.length > 0
    ? Math.round((players.length / playerIds.length) * 100)
    : 0;

  if (!players.length) {
    return {
      gameweek:             lookup.gameweek,
      modelVersion:         lookup.modelVersion,
      mlCoverage:           0,
      players:              [],
      topCaptainCandidates: [],
      strongestPlayers:     [],
      rotationRisks:        [],
      weakLinks:            [],
    };
  }

  // Captain candidates: composite score penalises players who might not play
  const topCaptainCandidates = [...players]
    .filter((p) => p.confidence !== 'LOW')
    .sort((a, b) => {
      const scoreA = a.predictedPtsGw1 * a.probPlaying * Math.max(a.prob60PlusMins, 0.2);
      const scoreB = b.predictedPtsGw1 * b.probPlaying * Math.max(b.prob60PlusMins, 0.2);
      return scoreB - scoreA;
    })
    .slice(0, 5);

  const strongestPlayers = [...players]
    .sort((a, b) => b.predictedPtsGw1 - a.predictedPtsGw1)
    .slice(0, 8);

  // Rotation risks: low play probability, low minutes, or low confidence
  const rotationRisks = [...players]
    .filter(
      (p) =>
        p.probPlaying < 0.75 ||
        p.predictedMinutes < 45 ||
        p.confidence === 'LOW',
    )
    .sort((a, b) => a.predictedMinutes - b.predictedMinutes)
    .slice(0, 6);

  // Weak links: low projected output over next 1 and 3 GWs
  const weakLinks = [...players]
    .filter((p) => p.predictedPtsGw1 < 2.5 || p.predictedPtsGw3 < 7)
    .sort((a, b) => a.predictedPtsGw3 - b.predictedPtsGw3)
    .slice(0, 6);

  return {
    gameweek:             lookup.gameweek,
    modelVersion:         lookup.modelVersion,
    mlCoverage,
    players,
    topCaptainCandidates,
    strongestPlayers,
    rotationRisks,
    weakLinks,
  };
}