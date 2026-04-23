// apps/api/src/modules/ai/squad-intelligence.engine.ts
// Phase 5: squad-level decision intelligence.
//
// Architecture: internal `_*` functions take pre-loaded squad data so the
// squad is fetched from the DB exactly once per call-site.
// buildSquadIntelligence loads once and runs all four analyses.

import { prisma }                from '../../db/prisma.js';
import { getEditableGameweekId } from '../../utils/gameweek.js';
import { projectPlayer }         from './projection.service.js';
import type { PlayerProjection } from './projection.types.js';
import type {
  FormationCode,
  FormationOption,
  FormationSlot,
  FormationRecommendation,
  BenchSlot,
  BenchOrderRecommendation,
  LineupOptimization,
  LineupChange,
  WeakLink,
  UpgradeTarget,
  WeakLinksAnalysis,
  SquadIntelligence,
} from './squad-intelligence.types.js';

// ── Formation definitions ─────────────────────────────────────────────────────

const FORMATIONS: Record<FormationCode, [number, number, number]> = {
  '442': [4, 4, 2],
  '433': [4, 3, 3],
  '451': [4, 5, 1],
  '343': [3, 4, 3],
  '352': [3, 5, 2],
  '532': [5, 3, 2],
  '541': [5, 4, 1],
};

const VALID_FORMATIONS: FormationCode[] = ['442', '433', '451', '343', '352', '532', '541'];

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ── Data loader ───────────────────────────────────────────────────────────────
// Single DB round-trip shared by all engines.

interface PickWithProjection {
  pick: {
    playerId:      number;
    position:      number;
    isOnBench:     boolean;
    benchOrder:    number | null;
    isCaptain:     boolean;
    isViceCaptain: boolean;
    player: {
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
  };
  projection: PlayerProjection;
}

interface SquadData {
  picks:      PickWithProjection[];
  bankTenths: number;
}

async function loadSquadWithProjections(
  userId:   string,
  gameweek: number,
): Promise<SquadData | null> {
  const team = await prisma.userTeam.findUnique({
    where:  { userId },
    select: { id: true, budget: true },
  });
  if (!team) return null;

  const picks = await prisma.userPick.findMany({
    where:   { userTeamId: team.id, gameweek },
    orderBy: { position: 'asc' },
    include: { player: { include: { team: true } } },
  });
  if (picks.length === 0) return null;

  const projections = await Promise.all(
    picks.map((p) => projectPlayer(p.player, gameweek)),
  );

  return {
    picks:      picks.map((pick, i) => ({ pick, projection: projections[i] })),
    bankTenths: team.budget ?? 0,
  };
}

// ── Detect current formation ──────────────────────────────────────────────────

function detectFormation(starters: PickWithProjection[]): FormationCode {
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const s of starters) {
    counts[s.pick.player.position as 1 | 2 | 3 | 4]++;
  }
  const key = `${counts[2]}${counts[3]}${counts[4]}` as FormationCode;
  return VALID_FORMATIONS.includes(key) ? key : '442';
}

// ── 1. Formation Recommender (internal) ──────────────────────────────────────

function _recommendFormation(
  picks:    PickWithProjection[],
  gameweek: number,
): FormationRecommendation | null {
  const byPos: Record<number, PickWithProjection[]> = { 1: [], 2: [], 3: [], 4: [] };
  for (const s of picks) {
    byPos[s.pick.player.position].push(s);
  }
  for (const pos of [1, 2, 3, 4]) {
    byPos[pos].sort((a, b) => b.projection.xPtsNextGw - a.projection.xPtsNextGw);
  }

  const currentStarters  = picks.filter((s) => !s.pick.isOnBench);
  const currentFormation = detectFormation(currentStarters);
  const currentXPts      = round1(
    currentStarters.reduce((s, p) => s + p.projection.xPtsNextGw, 0),
  );

  const options: FormationOption[] = [];

  for (const code of VALID_FORMATIONS) {
    const [defCount, midCount, fwdCount] = FORMATIONS[code];

    if (
      byPos[1].length < 1          ||
      byPos[2].length < defCount   ||
      byPos[3].length < midCount   ||
      byPos[4].length < fwdCount
    ) {
      options.push({
        code,
        slots:            buildSlots(code),
        totalXPtsNextGw:  0,
        totalXPtsNext3Gw: 0,
        starters:         [],
        bench:            [],
        attackingScore:   0,
        defensiveScore:   0,
        balanceScore:     0,
        feasible:         false,
        infeasibleReason: `Not enough players: need ${defCount} DEF, ${midCount} MID, ${fwdCount} FWD`,
      });
      continue;
    }

    const startersGk  = byPos[1].slice(0, 1);
    const startersDef = byPos[2].slice(0, defCount);
    const startersMid = byPos[3].slice(0, midCount);
    const startersFwd = byPos[4].slice(0, fwdCount);
    const starters    = [...startersGk, ...startersDef, ...startersMid, ...startersFwd];
    const starterIds  = new Set(starters.map((s) => s.pick.player.id));
    const bench       = picks.filter((s) => !starterIds.has(s.pick.player.id));

    const starterProjs = starters.map((s) => s.projection);
    const benchProjs   = bench.map((s) => s.projection);

    const totalXPtsNextGw  = round1(starterProjs.reduce((s, p) => s + p.xPtsNextGw, 0));
    const totalXPtsNext3Gw = round1(starterProjs.reduce((s, p) => s + p.xPtsNext3Gw, 0));

    const attackers      = [...startersMid, ...startersFwd].map((s) => s.projection);
    const attackingScore = attackers.length > 0
      ? round1(Math.min(10, (attackers.reduce((s, p) => s + p.xPtsNextGw, 0) / attackers.length) * 1.5))
      : 0;

    const defenders      = [...startersGk, ...startersDef].map((s) => s.projection);
    const defensiveScore = defenders.length > 0
      ? round1(Math.min(10, (defenders.reduce((s, p) => s + p.xPtsNextGw, 0) / defenders.length) * 2))
      : 0;

    const mean         = totalXPtsNextGw / 11;
    const variance     = starterProjs.reduce((s, p) => s + Math.pow(p.xPtsNextGw - mean, 2), 0) / 11;
    const balanceScore = round1(Math.max(0, 10 - variance));

    options.push({
      code,
      slots: buildSlots(code),
      totalXPtsNextGw,
      totalXPtsNext3Gw,
      starters:      starterProjs,
      bench:         benchProjs,
      attackingScore,
      defensiveScore,
      balanceScore,
      feasible: true,
    });
  }

  const feasible = options
    .filter((o) => o.feasible)
    .sort((a, b) => b.totalXPtsNextGw - a.totalXPtsNextGw);
  if (feasible.length === 0) return null;

  const bestOption = feasible[0];
  const bestGain   = round1(bestOption.totalXPtsNextGw - currentXPts);

  return {
    gameweek,
    currentFormation,
    currentXPts,
    options: feasible,
    bestOption,
    bestGain,
    reasoning: buildFormationReasoning(currentFormation, bestOption, bestGain),
  };
}

function buildSlots(code: FormationCode): FormationSlot[] {
  const [def, mid, fwd] = FORMATIONS[code];
  return [
    { position: 'GK',  count: 1   },
    { position: 'DEF', count: def },
    { position: 'MID', count: mid },
    { position: 'FWD', count: fwd },
  ];
}

function buildFormationReasoning(
  current: FormationCode,
  best:    FormationOption,
  gain:    number,
): string {
  if (gain <= 0.3) {
    return `Your current ${current} formation is close to optimal. Projected gain from switching to ${best.code} is only ${gain.toFixed(1)} pts — not worth disrupting your lineup.`;
  }
  if (gain >= 1.5) {
    return `${best.code} is significantly better for this gameweek — ${gain.toFixed(1)} pts more projected than your current ${current}. The formation better utilises your strongest players.`;
  }
  return `${best.code} offers a marginal improvement of ${gain.toFixed(1)} pts over your current ${current}. Consider switching if your strongest players fit the new structure.`;
}

// ── 2. Bench Order Engine (internal) ─────────────────────────────────────────

function _optimiseBenchOrder(
  picks:    PickWithProjection[],
  gameweek: number,
): BenchOrderRecommendation | null {
  const benchPlayers = picks
    .filter((s) => s.pick.isOnBench)
    .sort((a, b) => (a.pick.benchOrder ?? 99) - (b.pick.benchOrder ?? 99));

  if (benchPlayers.length === 0) return null;

  const withValue = benchPlayers.map((bp) => {
    const isGk        = bp.pick.player.position === 1;
    const xPts        = bp.projection.xPtsNextGw;
    const avail       = bp.projection.chanceOfPlaying / 100;
    const autoSubValue = isGk ? xPts * avail * 0.15 : xPts * avail;
    return {
      bp,
      autoSubValue: round1(autoSubValue),
      reasoning:    buildBenchSlotReasoning(bp.projection, isGk),
    };
  });

  const sorted = [...withValue].sort((a, b) => {
    const aIsGk = a.bp.pick.player.position === 1;
    const bIsGk = b.bp.pick.player.position === 1;
    if (aIsGk && !bIsGk) return 1;
    if (!aIsGk && bIsGk) return -1;
    return b.autoSubValue - a.autoSubValue;
  });

  const currentOrder: BenchSlot[] = withValue.map((v, i) => ({
    order:        (i + 1) as 1 | 2 | 3 | 4,
    player:       v.bp.projection,
    autoSubValue: v.autoSubValue,
    reasoning:    v.reasoning,
  }));

  const suggestedOrder: BenchSlot[] = sorted.map((v, i) => ({
    order:        (i + 1) as 1 | 2 | 3 | 4,
    player:       v.bp.projection,
    autoSubValue: v.autoSubValue,
    reasoning:    v.reasoning,
  }));

  const changed = suggestedOrder.some(
    (s, i) => s.player.playerId !== currentOrder[i]?.player.playerId,
  );

  const topBench   = sorted.find((v) => v.bp.pick.player.position !== 1);
  const keyInsight = topBench
    ? `${topBench.bp.projection.webName} is your most valuable auto-sub option with ${topBench.bp.projection.xPtsNextGw} xPts — put them first.`
    : 'No strong auto-sub option identified.';

  return { gameweek, currentOrder, suggestedOrder, changed, keyInsight };
}

function buildBenchSlotReasoning(proj: PlayerProjection, isGk: boolean): string {
  if (isGk) return `Backup GK — goes last on bench unless a starting GK is unavailable.`;
  const parts: string[] = [];
  if (proj.chanceOfPlaying >= 75)  parts.push('reliable starter');
  else if (proj.chanceOfPlaying < 50) parts.push(`only ${proj.chanceOfPlaying}% chance of playing`);
  if (proj.xPtsNextGw >= 5)        parts.push(`high xPts (${proj.xPtsNextGw})`);
  else if (proj.xPtsNextGw < 3)    parts.push(`low xPts (${proj.xPtsNextGw})`);
  if (proj.fixtureRun === 'easy')   parts.push('easy fixture');
  else if (proj.fixtureRun === 'tough') parts.push('tough fixture');
  return parts.length > 0
    ? parts.join(', ')
    : `xPts: ${proj.xPtsNextGw}, availability: ${proj.chanceOfPlaying}%`;
}

// ── 3. Lineup Optimizer (internal) ───────────────────────────────────────────

function _optimiseLineup(
  picks:        PickWithProjection[],
  gameweek:     number,
  formationRec: FormationRecommendation,
): LineupOptimization | null {
  const best          = formationRec.bestOption;
  const bestFormation = best.code;

  const currentStarterIds = new Set(
    picks.filter((s) => !s.pick.isOnBench).map((s) => s.pick.player.id),
  );
  const bestStarterIds = new Set(best.starters.map((p) => p.playerId));

  const changes: LineupChange[] = [];
  for (const p of best.starters) {
    if (!currentStarterIds.has(p.playerId)) {
      changes.push({
        type:   'START',
        player: p,
        reason: `${p.webName} (${p.xPtsNextGw} xPts) should start — currently on bench`,
      });
    }
  }
  for (const s of picks.filter((s) => !s.pick.isOnBench)) {
    if (!bestStarterIds.has(s.pick.player.id)) {
      changes.push({
        type:   'BENCH',
        player: s.projection,
        reason: `${s.projection.webName} (${s.projection.xPtsNextGw} xPts) should be benched — better options available`,
      });
    }
  }

  const sortedStarters    = [...best.starters].sort((a, b) => b.xPtsNextGw - a.xPtsNextGw);
  const captainSuggestion = sortedStarters[0];
  const vcSuggestion      = sortedStarters[1] ?? sortedStarters[0];

  const bench = [...best.bench].sort((a, b) => {
    const aIsGk = a.position === 'GK';
    const bIsGk = b.position === 'GK';
    if (aIsGk && !bIsGk) return 1;
    if (!aIsGk && bIsGk) return -1;
    return b.xPtsNextGw - a.xPtsNextGw;
  });

  const totalXPtsNextGw = best.totalXPtsNextGw;

  let overallOutlook: LineupOptimization['overallOutlook'];
  if      (totalXPtsNextGw >= 65) overallOutlook = 'excellent';
  else if (totalXPtsNextGw >= 55) overallOutlook = 'good';
  else if (totalXPtsNextGw >= 45) overallOutlook = 'average';
  else                             overallOutlook = 'poor';

  return {
    gameweek,
    bestFormation,
    bestXI:             sortedStarters,
    bench,
    totalXPtsNextGw,
    captainSuggestion,
    vcSuggestion,
    changesFromCurrent: changes,
    overallOutlook,
  };
}

// ── 4. Weak Links Analysis (internal) ────────────────────────────────────────

async function _analyseWeakLinks(
  picks:         PickWithProjection[],
  gameweek:      number,
  bankTenths:    number,
  freeTransfers: number,
): Promise<WeakLinksAnalysis | null> {
  const starters = picks
    .filter((s) => !s.pick.isOnBench)
    .sort((a, b) => a.projection.xPtsNextGw - b.projection.xPtsNextGw);

  const weakLinkCandidates = starters.slice(0, 3);

  const weakLinks: WeakLink[] = await Promise.all(
    weakLinkCandidates.map(async (wl, index) => {
      const reasons: string[] = [];

      if (wl.projection.xPtsNextGw < 3.5)
        reasons.push(`low projected points (${wl.projection.xPtsNextGw} xPts)`);
      if (wl.projection.fixtureRun === 'tough')
        reasons.push('tough upcoming fixtures');
      if (wl.projection.chanceOfPlaying < 75)
        reasons.push(`availability risk (${wl.projection.chanceOfPlaying}% chance)`);
      if (wl.projection.formScore < 4)
        reasons.push(`poor recent form (${wl.projection.form.toFixed(1)})`);
      if (reasons.length === 0)
        reasons.push('weakest projected output in starting XI');

      const urgency: WeakLink['urgency'] =
        reasons.length >= 3 ? 'HIGH'   :
        reasons.length >= 2 ? 'MEDIUM' : 'LOW';

      // index is 0-based; first `freeTransfers` weak links are free to replace
      const transferCost = index < freeTransfers ? 0 : 4;

      const positionCode = wl.pick.player.position;
      const candidates   = await prisma.fplPlayer.findMany({
        where: {
          position: positionCode,
          status:   'a',
          form:     { gt: 0 },
          id:       { notIn: picks.map((s) => s.pick.player.id) },
        },
        include: { team: true },
        orderBy: [{ form: 'desc' }, { totalPoints: 'desc' }],
        take:    6,
      });

      const upgradeTargets: UpgradeTarget[] = await Promise.all(
        candidates.slice(0, 3).map(async (c) => {
          const projC        = await projectPlayer(c, gameweek);
          const sellPrice    = wl.pick.player.nowCost;
          const budgetAfter  = bankTenths + sellPrice - c.nowCost;
          const isAffordable = budgetAfter >= 0;

          return {
            player:          projC,
            xPtsDeltaNextGw: round1(projC.xPtsNextGw  - wl.projection.xPtsNextGw),
            xPtsDelta3Gw:    round1(projC.xPtsNext3Gw - wl.projection.xPtsNext3Gw),
            isAffordable,
            budgetGap:       isAffordable ? 0 : Math.abs(budgetAfter),
            transferCost,
          };
        }),
      );

      return {
        player:               wl.projection,
        rank:                 index + 1,
        urgency,
        reasons,
        suggestedReplacements: upgradeTargets.filter((u) => u.xPtsDeltaNextGw > 0),
      };
    }),
  );

  const avgXPts = round1(
    starters.reduce((s, p) => s + p.projection.xPtsNextGw, 0) / starters.length,
  );
  const squadStrength: WeakLinksAnalysis['squadStrength'] =
    avgXPts >= 6.0 ? 'STRONG'  :
    avgXPts >= 5.0 ? 'SOLID'   :
    avgXPts >= 4.0 ? 'AVERAGE' : 'WEAK';

  const urgentCount  = weakLinks.filter((w) => w.urgency === 'HIGH').length;
  const squadSummary = urgentCount > 0
    ? `${urgentCount} player(s) urgently need replacing. Squad avg xPts: ${avgXPts}/player.`
    : `Squad looks ${squadStrength.toLowerCase()}. Avg xPts: ${avgXPts}/player. No urgent transfers needed.`;

  return { gameweek, weakLinks, squadStrength, squadSummary };
}

// ── Public exports ────────────────────────────────────────────────────────────
// Each loads the squad once and delegates to the internal function.

export async function recommendFormation(
  userId: string,
): Promise<FormationRecommendation | null> {
  const gameweek = await getEditableGameweekId();
  const data     = await loadSquadWithProjections(userId, gameweek);
  if (!data) return null;
  return _recommendFormation(data.picks, gameweek);
}

export async function optimiseBenchOrder(
  userId: string,
): Promise<BenchOrderRecommendation | null> {
  const gameweek = await getEditableGameweekId();
  const data     = await loadSquadWithProjections(userId, gameweek);
  if (!data) return null;
  return _optimiseBenchOrder(data.picks, gameweek);
}

export async function optimiseLineup(
  userId: string,
): Promise<LineupOptimization | null> {
  const gameweek = await getEditableGameweekId();
  const data     = await loadSquadWithProjections(userId, gameweek);
  if (!data) return null;
  const formationRec = _recommendFormation(data.picks, gameweek);
  if (!formationRec) return null;
  return _optimiseLineup(data.picks, gameweek, formationRec);
}

export async function analyseWeakLinks(
  userId:        string,
  freeTransfers: number = 1,
): Promise<WeakLinksAnalysis | null> {
  const gameweek = await getEditableGameweekId();
  const data     = await loadSquadWithProjections(userId, gameweek);
  if (!data) return null;
  return _analyseWeakLinks(data.picks, gameweek, data.bankTenths, freeTransfers);
}

// ── Full squad intelligence ───────────────────────────────────────────────────
// Loads the squad exactly once, then runs all four analyses.
// Formation, bench order, and lineup are pure synchronous computation.
// Only weak link analysis hits the DB again (candidate queries per position).

export async function buildSquadIntelligence(
  userId:        string,
  freeTransfers: number = 1,
): Promise<SquadIntelligence | null> {
  const gameweek = await getEditableGameweekId();
  const data     = await loadSquadWithProjections(userId, gameweek);
  if (!data) return null;

  const { picks, bankTenths } = data;

  const formationRec = _recommendFormation(picks, gameweek);
  if (!formationRec) return null;

  const benchOrder = _optimiseBenchOrder(picks, gameweek);
  const lineup     = _optimiseLineup(picks, gameweek, formationRec);
  const weakLinks  = await _analyseWeakLinks(picks, gameweek, bankTenths, freeTransfers);

  if (!benchOrder || !lineup || !weakLinks) return null;

  return { gameweek, lineup, formation: formationRec, benchOrder, weakLinks };
}
