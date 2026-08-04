import { prisma } from '../../db/prisma.js';

export interface TeamStrengthFacts {
  teamId:                 number;
  shortName:              string;
  gamesPlayed:            number;

  // ── Defensive ─────────────────────────────────────────────────────────────
  goalsConcededPerGame:   number;
  cleanSheetRate:         number;   // 0..1
  savesPerGame:           number;   // total team saves / games

  // ── Offensive ─────────────────────────────────────────────────────────────
  goalsScoredPerGame:     number;
  assistsPerGame:         number;
  attackingReturnsPerGame:number;   // goals + assists per game
}

export interface TeamStrengthIndex {
  byTeamId: Map<number, TeamStrengthFacts>;

  // League-wide averages used to normalise.
  leagueAvgConcededPerGame:   number;
  leagueAvgScoredPerGame:     number;
  leagueAvgCleanSheetRate:    number;
  leagueAvgSavesPerGame:      number;
  leagueAvgAssistsPerGame:    number;
  leagueAvgAttackingReturns:  number;
}

export interface NextFixtureLookup {
  byTeamId: Map<number, {
    opponentId: number;
    isHome:     boolean;
    fdr:        number;     // 1..5
    gameweek:   number;
  }>;
}

// ── Index builder ─────────────────────────────────────────────────────────────

export async function buildTeamStrengthIndex(): Promise<TeamStrengthIndex> {
  const teams = await prisma.fplTeam.findMany({
    select: { id: true, shortName: true },
  });

  // Defensive aggregation via GK rows. Each GK row in a GW represents that
  // team's defensive output that GW; dedupe by (teamId, gameweek) so keeper
  // rotations don't double-count.
  const gkRows = await prisma.playerGameweekStat.findMany({
    where: { player: { position: 1 } },
    select: {
      goalsConceded: true,
      cleanSheets:   true,
      saves:         true,
      gameweek:      true,
      player:        { select: { teamId: true } },
    },
  });

  type DefAgg = { conceded: number; cleanSheets: number; saves: number; games: number };
  const def = new Map<number, DefAgg>();
  const seenDef = new Set<string>();
  for (const r of gkRows) {
    const tid = r.player.teamId;
    const key = `${tid}:${r.gameweek}`;
    if (seenDef.has(key)) continue;
    seenDef.add(key);
    const agg = def.get(tid) ?? { conceded: 0, cleanSheets: 0, saves: 0, games: 0 };
    agg.conceded    += r.goalsConceded;
    agg.cleanSheets += r.cleanSheets ? 1 : 0;
    agg.saves       += r.saves ?? 0;
    agg.games       += 1;
    def.set(tid, agg);
  }

  // Offensive aggregation via outfield rows.
  const outfieldRows = await prisma.playerGameweekStat.findMany({
    where: { player: { position: { in: [2, 3, 4] } } },
    select: {
      goalsScored: true,
      assists:     true,
      gameweek:    true,
      player:      { select: { teamId: true } },
    },
  });

  const teamGwAttack = new Map<string, { g: number; a: number }>();
  for (const r of outfieldRows) {
    const key = `${r.player.teamId}:${r.gameweek}`;
    const cur = teamGwAttack.get(key) ?? { g: 0, a: 0 };
    cur.g += r.goalsScored;
    cur.a += r.assists;
    teamGwAttack.set(key, cur);
  }

  type AttAgg = { goals: number; assists: number; games: number };
  const att = new Map<number, AttAgg>();
  for (const [key, val] of teamGwAttack) {
    const teamId = parseInt(key.split(':')[0]);
    const cur = att.get(teamId) ?? { goals: 0, assists: 0, games: 0 };
    cur.goals   += val.g;
    cur.assists += val.a;
    cur.games   += 1;
    att.set(teamId, cur);
  }

  // Build per-team facts and league averages
  const byTeamId = new Map<number, TeamStrengthFacts>();
  let sumConceded = 0, sumScored = 0, sumCs = 0, sumSaves = 0, sumAssists = 0, sumAttRet = 0;
  let teamsWithGames = 0;

  for (const t of teams) {
    const d = def.get(t.id) ?? { conceded: 0, cleanSheets: 0, saves: 0, games: 0 };
    const a = att.get(t.id) ?? { goals: 0, assists: 0, games: 0 };
    const games = Math.max(d.games, a.games);

    if (games === 0) {
      byTeamId.set(t.id, {
        teamId: t.id, shortName: t.shortName, gamesPlayed: 0,
        goalsConcededPerGame: 0, cleanSheetRate: 0, savesPerGame: 0,
        goalsScoredPerGame: 0, assistsPerGame: 0, attackingReturnsPerGame: 0,
      });
      continue;
    }

    const concededPg = d.conceded / Math.max(1, d.games);
    const csRate     = d.cleanSheets / Math.max(1, d.games);
    const savesPg    = d.saves / Math.max(1, d.games);
    const scoredPg   = a.goals / Math.max(1, a.games);
    const assistsPg  = a.assists / Math.max(1, a.games);
    const attRetPg   = scoredPg + assistsPg;

    byTeamId.set(t.id, {
      teamId: t.id, shortName: t.shortName, gamesPlayed: games,
      goalsConcededPerGame: concededPg,
      cleanSheetRate: csRate,
      savesPerGame: savesPg,
      goalsScoredPerGame: scoredPg,
      assistsPerGame: assistsPg,
      attackingReturnsPerGame: attRetPg,
    });

    sumConceded += concededPg;
    sumScored   += scoredPg;
    sumCs       += csRate;
    sumSaves    += savesPg;
    sumAssists  += assistsPg;
    sumAttRet   += attRetPg;
    teamsWithGames += 1;
  }

  const N = Math.max(1, teamsWithGames);
  return {
    byTeamId,
    leagueAvgConcededPerGame:  sumConceded / N,
    leagueAvgScoredPerGame:    sumScored   / N,
    leagueAvgCleanSheetRate:   sumCs       / N,
    leagueAvgSavesPerGame:     sumSaves    / N,
    leagueAvgAssistsPerGame:   sumAssists  / N,
    leagueAvgAttackingReturns: sumAttRet   / N,
  };
}

// ── Next-fixture lookup builder ───────────────────────────────────────────────

export async function buildNextFixtureLookup(targetGw?: number): Promise<NextFixtureLookup> {
  const fixtures = await prisma.fplFixture.findMany({
    where: {
      finished: false,
      ...(targetGw ? { event: targetGw } : {}),
    },
    select: {
      event:            true,
      teamHId:          true,
      teamAId:          true,
      teamHDifficulty:  true,
      teamADifficulty:  true,
    },
    orderBy: { event: 'asc' },
  });

  const byTeamId = new Map<number, {
    opponentId: number; isHome: boolean; fdr: number; gameweek: number;
  }>();

  for (const f of fixtures) {
    if (!byTeamId.has(f.teamHId)) {
      byTeamId.set(f.teamHId, {
        opponentId: f.teamAId,
        isHome:     true,
        fdr:        f.teamHDifficulty ?? 3,
        gameweek:   f.event ?? 0,
      });
    }
    if (!byTeamId.has(f.teamAId)) {
      byTeamId.set(f.teamAId, {
        opponentId: f.teamHId,
        isHome:     false,
        fdr:        f.teamADifficulty ?? 3,
        gameweek:   f.event ?? 0,
      });
    }
  }

  return { byTeamId };
}


function gkOwnTeamMultiplier(facts: TeamStrengthFacts, idx: TeamStrengthIndex): number {
  const csRatio       = facts.cleanSheetRate / Math.max(0.05, idx.leagueAvgCleanSheetRate);
  const savesRatio    = facts.savesPerGame   / Math.max(0.5,  idx.leagueAvgSavesPerGame);
  const concededRatio = facts.goalsConcededPerGame / Math.max(0.5, idx.leagueAvgConcededPerGame);
  const concededComp  = 2.0 - concededRatio;
  return 0.50 * csRatio + 0.30 * savesRatio + 0.20 * concededComp;
}


function defOwnTeamMultiplier(facts: TeamStrengthFacts, idx: TeamStrengthIndex): number {
  const csRatio       = facts.cleanSheetRate / Math.max(0.05, idx.leagueAvgCleanSheetRate);
  const concededRatio = facts.goalsConcededPerGame / Math.max(0.5, idx.leagueAvgConcededPerGame);
  const attRetRatio   = facts.attackingReturnsPerGame / Math.max(0.5, idx.leagueAvgAttackingReturns);
  const concededComp  = 2.0 - concededRatio;
  return 0.55 * csRatio + 0.20 * concededComp + 0.25 * attRetRatio;
}


function midOwnTeamMultiplier(facts: TeamStrengthFacts, idx: TeamStrengthIndex): number {
  const goalsRatio    = facts.goalsScoredPerGame / Math.max(0.5, idx.leagueAvgScoredPerGame);
  const assistsRatio  = facts.assistsPerGame     / Math.max(0.3, idx.leagueAvgAssistsPerGame);
  const csRatio       = facts.cleanSheetRate     / Math.max(0.05, idx.leagueAvgCleanSheetRate);
  const concededRatio = facts.goalsConcededPerGame / Math.max(0.5, idx.leagueAvgConcededPerGame);
  const concededComp  = 2.0 - concededRatio;
  return 0.45 * goalsRatio + 0.25 * assistsRatio + 0.20 * csRatio + 0.10 * concededComp;
}


function fwdOwnTeamMultiplier(facts: TeamStrengthFacts, idx: TeamStrengthIndex): number {
  const goalsRatio   = facts.goalsScoredPerGame / Math.max(0.5, idx.leagueAvgScoredPerGame);
  const assistsRatio = facts.assistsPerGame     / Math.max(0.3, idx.leagueAvgAssistsPerGame);
  return 0.70 * goalsRatio + 0.25 * assistsRatio + 0.05;
}


function gkOpponentMultiplier(opp: TeamStrengthFacts, idx: TeamStrengthIndex): number {
  const oppScoredRatio = opp.goalsScoredPerGame / Math.max(0.5, idx.leagueAvgScoredPerGame);
  const csComponent    = 2.0 - oppScoredRatio;
  const saveComponent  = 0.85 + 0.15 * oppScoredRatio;
  return 0.75 * csComponent + 0.25 * saveComponent;
}


function defOpponentMultiplier(opp: TeamStrengthFacts, idx: TeamStrengthIndex): number {
  const oppScoredRatio   = opp.goalsScoredPerGame   / Math.max(0.5, idx.leagueAvgScoredPerGame);
  const oppConcededRatio = opp.goalsConcededPerGame / Math.max(0.5, idx.leagueAvgConcededPerGame);
  const csComp    = 2.0 - oppScoredRatio;
  const goalsComp = oppConcededRatio;
  return 0.70 * csComp + 0.30 * goalsComp;
}


function midOpponentMultiplier(opp: TeamStrengthFacts, idx: TeamStrengthIndex): number {
  const oppConcededRatio = opp.goalsConcededPerGame / Math.max(0.5, idx.leagueAvgConcededPerGame);
  const oppScoredRatio   = opp.goalsScoredPerGame   / Math.max(0.5, idx.leagueAvgScoredPerGame);
  return 0.75 * oppConcededRatio + 0.25 * (2.0 - oppScoredRatio);
}


function fwdOpponentMultiplier(opp: TeamStrengthFacts, idx: TeamStrengthIndex): number {
  return opp.goalsConcededPerGame / Math.max(0.5, idx.leagueAvgConcededPerGame);
}


export interface MultiplierResult {
  multiplier:        number;
  ownTeamComponent:  number;
  opponentComponent: number;
  components:        Record<string, number>;
}

export function teamStrengthMultiplier(
  position:      number,
  teamId:        number,
  index:         TeamStrengthIndex,
  fixtureWeight: number = 1.0,
  nextFixtures?: NextFixtureLookup,
): MultiplierResult {
  const facts = index.byTeamId.get(teamId);
  if (!facts || facts.gamesPlayed === 0) {
    return { multiplier: 1.0, ownTeamComponent: 1.0, opponentComponent: 1.0, components: {} };
  }

  let own: number;
  switch (position) {
    case 1:  own = gkOwnTeamMultiplier(facts, index);  break;
    case 2:  own = defOwnTeamMultiplier(facts, index); break;
    case 3:  own = midOwnTeamMultiplier(facts, index); break;
    case 4:  own = fwdOwnTeamMultiplier(facts, index); break;
    default: own = 1.0;
  }

  let opp = 1.0;
  const opponentInfo = nextFixtures?.byTeamId.get(teamId);
  if (opponentInfo) {
    const oppFacts = index.byTeamId.get(opponentInfo.opponentId);
    if (oppFacts && oppFacts.gamesPlayed > 0) {
      switch (position) {
        case 1: opp = gkOpponentMultiplier(oppFacts, index);  break;
        case 2: opp = defOpponentMultiplier(oppFacts, index); break;
        case 3: opp = midOpponentMultiplier(oppFacts, index); break;
        case 4: opp = fwdOpponentMultiplier(oppFacts, index); break;
      }
      if (opponentInfo.isHome) opp *= 1.04;  // home advantage
    }
  }

  const raw      = own * opp;
  const scaled   = 1.0 + (raw - 1.0) * fixtureWeight;
  const clamped  = Math.max(0.70, Math.min(1.35, scaled));

  return {
    multiplier:        clamped,
    ownTeamComponent:  own,
    opponentComponent: opp,
    components: {
      own:     Number(own.toFixed(3)),
      opp:     Number(opp.toFixed(3)),
      raw:     Number(raw.toFixed(3)),
      clamped: Number(clamped.toFixed(3)),
    },
  };
}

// Backward-compatibility scalar wrapper.
export function teamStrengthMultiplierScalar(
  position: number,
  teamId:   number,
  index:    TeamStrengthIndex,
  fixtureWeight: number = 1.0,
  nextFixtures?: NextFixtureLookup,
): number {
  return teamStrengthMultiplier(position, teamId, index, fixtureWeight, nextFixtures).multiplier;
}

// Plain-language explanation for the LLM to narrate.
export function explainTeamStrength(
  position: number,
  teamId:   number,
  index:    TeamStrengthIndex,
  nextFixtures?: NextFixtureLookup,
): string {
  const facts = index.byTeamId.get(teamId);
  if (!facts) return '';

  const parts: string[] = [];

  if (position === 1 || position === 2) {
    const csVsAvg = facts.cleanSheetRate / Math.max(0.05, index.leagueAvgCleanSheetRate);
    if (csVsAvg > 1.20) parts.push(`${facts.shortName} keep ${Math.round((csVsAvg - 1) * 100)}% more clean sheets than average`);
    else if (csVsAvg < 0.80) parts.push(`${facts.shortName} keep clean sheets less often than average`);

    if (position === 1 && facts.savesPerGame > index.leagueAvgSavesPerGame * 1.2) {
      parts.push(`high save volume (${facts.savesPerGame.toFixed(1)}/gm)`);
    }
  }

  if (position === 2 || position === 3 || position === 4) {
    const goalsVsAvg = facts.goalsScoredPerGame / Math.max(0.5, index.leagueAvgScoredPerGame);
    if (goalsVsAvg > 1.20) parts.push(`${facts.shortName} score ${Math.round((goalsVsAvg - 1) * 100)}% more goals than average`);
    else if (goalsVsAvg < 0.80) parts.push(`${facts.shortName} are a low-scoring attack`);
  }

  const opponentInfo = nextFixtures?.byTeamId.get(teamId);
  if (opponentInfo) {
    const opp = index.byTeamId.get(opponentInfo.opponentId);
    if (opp) {
      const home = opponentInfo.isHome ? 'at home vs' : 'away to';
      if (position === 1 || position === 2) {
        if (opp.goalsScoredPerGame < index.leagueAvgScoredPerGame * 0.85) {
          parts.push(`favourable defensive matchup ${home} ${opp.shortName} (low-scoring opp)`);
        }
      } else {
        if (opp.goalsConcededPerGame > index.leagueAvgConcededPerGame * 1.15) {
          parts.push(`favourable attacking matchup ${home} ${opp.shortName} (leaky defence)`);
        }
      }
    }
  }

  return parts.join('; ');
}