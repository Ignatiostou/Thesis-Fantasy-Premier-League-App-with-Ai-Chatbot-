import { prisma }                         from '../../db/prisma.js';
import { getEditableGameweekId }           from '../../utils/gameweek.js';
import { getPredictionLookupForGameweek }  from './ml-prediction.service.js';
import type { PlayerPredictionDto }        from './ml-prediction.types.js';
import type {
  PlayerProjection,
  SquadProjection,
  TransferDelta,
  CaptainProjection,
  CaptainProjectionCandidate,
  ProjectionSource,
} from './projection.types.js';

// ── Constants (heuristic fallback) ────────────────────────────────────────────

const POSITION_LABEL: Record<number, string> = {
  1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD',
};

const POSITION_BASE: Record<number, number> = {
  1: 4.5, 2: 4.2, 3: 5.0, 4: 4.8,
};

const FDR_MULTIPLIER: Record<number, number> = {
  1: 1.25, 2: 1.12, 3: 1.00, 4: 0.88, 5: 0.75,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeNum(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function getOutlook(score: number): PlayerProjection['outlook'] {
  if (score >= 7.5) return 'excellent';
  if (score >= 5.5) return 'good';
  if (score >= 3.5) return 'average';
  if (score >= 1.0) return 'poor';
  return 'unknown';
}

function getFixtureRun(avgFdr: number): PlayerProjection['fixtureRun'] {
  if (avgFdr <= 2.3) return 'easy';
  if (avgFdr <= 3.3) return 'mixed';
  return 'tough';
}

async function getUpcomingFdrs(
  teamId:  number,
  fromGw:  number,
  count:   number,
): Promise<{ fdr: number; opponent: string; isHome: boolean; gameweek: number }[]> {
  const fixtures = await prisma.fplFixture.findMany({
    where: {
      event:    { gte: fromGw, lte: fromGw + count - 1 },
      finished: false,
      OR: [{ teamHId: teamId }, { teamAId: teamId }],
    },
    include: { teamH: true, teamA: true },
    orderBy: { kickoffTime: 'asc' },
    take:    count,
  });

  return fixtures.map((f) => {
    const isHome   = f.teamHId === teamId;
    const fdr      = isHome ? (f.teamHDifficulty ?? 3) : (f.teamADifficulty ?? 3);
    const opponent = isHome ? f.teamA.shortName : f.teamH.shortName;
    return { fdr, opponent, isHome, gameweek: f.event ?? fromGw };
  });
}

// ── Core projection ───────────────────────────────────────────────────────────

type RawPlayer = {
  id:                       number;
  webName:                  string;
  teamId:                   number;
  position:                 number;
  nowCost:                  number;
  totalPoints:              number | null;
  minutes:                  number | null;
  form:                     number | null;
  chanceOfPlayingNextRound: number | null;
  status:                   string;
  team:                     { shortName: string };
};

export async function projectPlayer(
  player:   RawPlayer,
  gameweek: number,
  mlMap?:   Map<number, PlayerPredictionDto>,
): Promise<PlayerProjection> {
  // Always compute fixture context — needed for both paths
  const upcomingFdrs = await getUpcomingFdrs(player.teamId, gameweek, 5);
  const nextFdr      = upcomingFdrs[0]?.fdr ?? 3;
  const next3Fdrs    = upcomingFdrs.slice(0, 3);
  const next5Fdrs    = upcomingFdrs.slice(0, 5);
  const avgFdrNext3  = next3Fdrs.length > 0
    ? next3Fdrs.reduce((s, f) => s + f.fdr, 0) / next3Fdrs.length
    : 3;

  // Supplementary scores — used by both ML and heuristic paths
  const form            = safeNum(player.form, 0);
  const chanceOfPlaying = player.chanceOfPlayingNextRound
    ?? (player.status === 'a' ? 100 : 50);
  const availFactor     = clamp(chanceOfPlaying / 100, 0, 1);
  const totalPts        = player.totalPoints ?? 0;
  const minutesPlayed   = player.minutes ?? 0;
  const gamesPlayed     = minutesPlayed > 0
    ? Math.max(1, Math.floor(minutesPlayed / 75))
    : 0;
  const avgPtsPerGame   = gamesPlayed > 0
    ? round1(totalPts / gamesPlayed)
    : POSITION_BASE[player.position] ?? 4.5;

  const formScore        = clamp(round1(form * 1.25), 0, 10);
  const fixtureScore     = round1((6 - nextFdr) * 2.5);
  const consistencyScore = clamp(round1(avgPtsPerGame * 1.2), 0, 10);

  // ── ML path ───────────────────────────────────────────────────────────────
  const mlPred = mlMap?.get(player.id);

  if (mlPred) {
    const mlAvailScore  = round1(mlPred.probPlaying * 10);
    const mlCombined    = (formScore + fixtureScore + mlAvailScore + consistencyScore) / 4;

    return {
      playerId:          player.id,
      webName:           player.webName,
      club:              player.team.shortName,
      position:          POSITION_LABEL[player.position] ?? 'UNK',
      nowCost:           player.nowCost,
      xPtsNextGw:        round1(mlPred.predictedPtsGw1),
      xPtsNext3Gw:       round1(mlPred.predictedPtsGw3),
      xPtsNext5Gw:       round1(mlPred.predictedPtsGw5),
      availabilityScore: mlAvailScore,
      chanceOfPlaying:   Math.round(mlPred.probPlaying * 100),
      formScore,
      fixtureScore,
      consistencyScore,
      outlook:    getOutlook(mlCombined),
      fixtureRun: getFixtureRun(avgFdrNext3),
      confidence: mlPred.confidence,
      source:     'ML',
      form,
      avgPts:         avgPtsPerGame,
      nextFixtureFdr: nextFdr,
      avgFdrNext3:    round1(avgFdrNext3),
    };
  }

  // ── Heuristic fallback (Phase 4 logic, unchanged) ─────────────────────────
  const formWeight = gamesPlayed >= 10 ? 0.6 : 0.4;
  const base       = (avgPtsPerGame * (1 - formWeight)) + (form * formWeight);
  const fixMult1   = FDR_MULTIPLIER[nextFdr] ?? 1.0;

  const xPtsNextGw = round1(base * fixMult1 * availFactor);

  const xPtsNext3Gw = round1(
    next3Fdrs.reduce((sum, f, i) => {
      const mult  = FDR_MULTIPLIER[f.fdr] ?? 1.0;
      const avail = i === 0
        ? availFactor
        : clamp(availFactor * (1 - i * 0.03), 0.1, 1);
      return sum + base * mult * avail;
    }, 0) || xPtsNextGw * 3,
  );

  const xPtsNext5Gw = round1(
    next5Fdrs.reduce((sum, f, i) => {
      const mult  = FDR_MULTIPLIER[f.fdr] ?? 1.0;
      const avail = clamp(availFactor * (1 - i * 0.02), 0.1, 1);
      return sum + base * mult * avail;
    }, 0) || xPtsNextGw * 5,
  );

  const availabilityScore = round1(availFactor * 10);
  const hasFixtures       = upcomingFdrs.length > 0;
  const heuristicConf: PlayerProjection['confidence'] =
    !hasFixtures || gamesPlayed < 3 || chanceOfPlaying < 50 ? 'LOW'    :
    gamesPlayed < 8 || chanceOfPlaying < 75                 ? 'MEDIUM' : 'HIGH';

  const heuristicCombined =
    (formScore + fixtureScore + availabilityScore + consistencyScore) / 4;

  return {
    playerId:          player.id,
    webName:           player.webName,
    club:              player.team.shortName,
    position:          POSITION_LABEL[player.position] ?? 'UNK',
    nowCost:           player.nowCost,
    xPtsNextGw,
    xPtsNext3Gw,
    xPtsNext5Gw,
    formScore,
    fixtureScore,
    availabilityScore,
    consistencyScore,
    outlook:    getOutlook(heuristicCombined),
    fixtureRun: getFixtureRun(avgFdrNext3),
    confidence: heuristicConf,
    source:     'HEURISTIC',
    form,
    avgPts:         avgPtsPerGame,
    chanceOfPlaying,
    nextFixtureFdr: nextFdr,
    avgFdrNext3:    round1(avgFdrNext3),
  };
}

// ── Squad projection ──────────────────────────────────────────────────────────

export async function projectSquad(userId: string): Promise<SquadProjection | null> {
  const gameweek = await getEditableGameweekId();

  const team = await prisma.userTeam.findUnique({
    where:  { userId },
    select: { id: true },
  });
  if (!team) return null;

  const picks = await prisma.userPick.findMany({
    where:   { userTeamId: team.id, gameweek },
    orderBy: { position: 'asc' },
    include: { player: { include: { team: true } } },
  });
  if (picks.length === 0) return null;

  // One DB call for ML predictions — shared across all players
  const { byPlayerId: mlMap } = await getPredictionLookupForGameweek(gameweek);

  const projections = await Promise.all(
    picks.map((p) => projectPlayer(p.player, gameweek, mlMap)),
  );

  const starters = projections.filter((_, i) => !picks[i].isOnBench);
  const bench    = projections.filter((_, i) =>  picks[i].isOnBench);

  const captainPick = picks.find((p) => p.isCaptain);
  const captainProj = captainPick
    ? projections.find((p) => p.playerId === captainPick.playerId)
    : null;

  const totalXPtsNextGw  = round1(starters.reduce((s, p) => s + p.xPtsNextGw,  0));
  const totalXPtsNext3Gw = round1(starters.reduce((s, p) => s + p.xPtsNext3Gw, 0));
  const captainBonus     = round1(captainProj?.xPtsNextGw ?? 0);
  const projectedGwScore = round1(totalXPtsNextGw + captainBonus);
  const benchBuffer      = round1(Math.max(...bench.map((p) => p.xPtsNextGw), 0));

  const sortedStarters = [...starters].sort((a, b) => b.xPtsNextGw - a.xPtsNextGw);
  const riskPlayers    = projections.filter(
    (p) => p.chanceOfPlaying < 75 || p.availabilityScore < 5,
  );

  const mlCount    = projections.filter((p) => p.source === 'ML').length;
  const mlCoverage = Math.round((mlCount / projections.length) * 100);

  return {
    gameweek,
    totalXPtsNextGw,
    totalXPtsNext3Gw,
    captainBonus,
    projectedGwScore,
    benchBuffer,
    picks:       projections,
    topReturner: sortedStarters[0],
    weakestLink: sortedStarters[sortedStarters.length - 1],
    riskPlayers,
    mlCoverage,
  };
}

// ── Transfer delta ────────────────────────────────────────────────────────────

export async function projectTransferDelta(
  playerOutId:   number,
  playerInId:    number,
  freeTransfers: number,
  transferIndex: number,
): Promise<TransferDelta | null> {
  const gameweek = await getEditableGameweekId();

  const [rawOut, rawIn] = await Promise.all([
    prisma.fplPlayer.findUnique({ where: { id: playerOutId }, include: { team: true } }),
    prisma.fplPlayer.findUnique({ where: { id: playerInId  }, include: { team: true } }),
  ]);
  if (!rawOut || !rawIn) return null;

  const { byPlayerId: mlMap } = await getPredictionLookupForGameweek(gameweek);

  const [projOut, projIn] = await Promise.all([
    projectPlayer(rawOut, gameweek, mlMap),
    projectPlayer(rawIn,  gameweek, mlMap),
  ]);

  const hitRequired        = transferIndex >= freeTransfers;
  const hitCost            = hitRequired ? 4 : 0;
  const xPtsDeltaNextGw    = round1(projIn.xPtsNextGw  - projOut.xPtsNextGw);
  const xPtsDeltaNext3Gw   = round1(projIn.xPtsNext3Gw - projOut.xPtsNext3Gw);
  const netBenefitAfterHit = round1(xPtsDeltaNextGw - hitCost);

  let verdict: TransferDelta['verdict'];
  if      (xPtsDeltaNextGw >= 2.0)  verdict = 'UPGRADE';
  else if (xPtsDeltaNextGw >= 0.5)  verdict = 'SLIGHT_UPGRADE';
  else if (xPtsDeltaNextGw >= -0.5) verdict = 'NEUTRAL';
  else                               verdict = 'DOWNGRADE';

  return {
    playerOut:  projOut,
    playerIn:   projIn,
    xPtsDeltaNextGw,
    xPtsDeltaNext3Gw,
    netBenefitAfterHit,
    hitRequired,
    hitCost,
    verdict,
    verdictReason: buildVerdictReason(
      projOut, projIn, xPtsDeltaNextGw, hitCost, xPtsDeltaNext3Gw,
    ),
  };
}

function buildVerdictReason(
  out:    PlayerProjection,
  inn:    PlayerProjection,
  delta:  number,
  hit:    number,
  delta3: number,
): string {
  const src   = (p: PlayerProjection) => p.source === 'ML' ? '(ML)' : '(est.)';
  const parts: string[] = [];

  if (delta > 0) {
    parts.push(
      `${inn.webName} ${src(inn)} is projected ${delta.toFixed(1)} pts higher than ${out.webName} ${src(out)} next GW`,
    );
  } else if (delta < 0) {
    parts.push(
      `${out.webName} ${src(out)} is projected ${Math.abs(delta).toFixed(1)} pts higher than ${inn.webName} ${src(inn)} next GW`,
    );
  } else {
    parts.push(`${inn.webName} and ${out.webName} are projected similarly next GW`);
  }

  if (inn.fixtureRun !== out.fixtureRun) {
    parts.push(
      `${inn.webName} has a ${inn.fixtureRun} fixture run vs ${out.webName}'s ${out.fixtureRun} run`,
    );
  }

  if (delta3 > 1.5) {
    parts.push(`over 3 GWs the gain is +${delta3.toFixed(1)} pts`);
  } else if (delta3 < -1.5) {
    parts.push(
      `over 3 GWs ${out.webName} would outscore ${inn.webName} by ${Math.abs(delta3).toFixed(1)} pts`,
    );
  }

  if (hit > 0) {
    parts.push(`a ${hit}-pt hit is required — net benefit is ${(delta - hit).toFixed(1)} pts`);
  }

  return parts.join('. ') + '.';
}

// ── Captain projection ────────────────────────────────────────────────────────

export async function projectCaptainOptions(userId: string): Promise<CaptainProjection | null> {
  const gameweek = await getEditableGameweekId();

  const team = await prisma.userTeam.findUnique({
    where:  { userId },
    select: { id: true },
  });
  if (!team) return null;

  const picks = await prisma.userPick.findMany({
    where:   { userTeamId: team.id, gameweek, isOnBench: false },
    include: { player: { include: { team: true } } },
  });

  const attackingPicks = picks.filter((p) => p.player.position !== 1);
  if (attackingPicks.length === 0) return null;

  const currentCaptainId = picks.find((p) => p.isCaptain)?.playerId ?? null;

  const { byPlayerId: mlMap } = await getPredictionLookupForGameweek(gameweek);

  const projections = await Promise.all(
    attackingPicks.map((p) => projectPlayer(p.player, gameweek, mlMap)),
  );

  const upcomingFixturesMap = new Map<number, string>();
  for (const p of attackingPicks) {
    const fdrs = await getUpcomingFdrs(p.player.teamId, gameweek, 1);
    if (fdrs[0]) {
      const f = fdrs[0];
      upcomingFixturesMap.set(
        p.player.id,
        `${f.isHome ? 'H' : 'A'} vs ${f.opponent} (FDR ${f.fdr})`,
      );
    }
  }

  const candidates: CaptainProjectionCandidate[] = projections
    .map((proj) => ({
      playerId:         proj.playerId,
      webName:          proj.webName,
      club:             proj.club,
      position:         proj.position,
      xPtsNextGw:       proj.xPtsNextGw,
      captainXPts:      round1(proj.xPtsNextGw * 2),
      fixtureRun:       upcomingFixturesMap.get(proj.playerId) ?? 'N/A',
      confidence:       proj.confidence,
      isSafePick:       proj.confidence === 'HIGH' && proj.availabilityScore >= 8,
      isHighUpside:     proj.formScore >= 7 && proj.fixtureScore >= 7,
      isCurrentCaptain: proj.playerId === currentCaptainId,
      source:           proj.source,
    }))
    .sort((a, b) => b.captainXPts - a.captainXPts)
    .slice(0, 5);

  const topPick  = candidates[0];
  const safePick = candidates.find((c) => c.isSafePick)  ?? candidates[0];
  const upside   = candidates.find((c) => c.isHighUpside) ?? candidates[0];

  return { gameweek, candidates, topPick, safePick, upside };
}