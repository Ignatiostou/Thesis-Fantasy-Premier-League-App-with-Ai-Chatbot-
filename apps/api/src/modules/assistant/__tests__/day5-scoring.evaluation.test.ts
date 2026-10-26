import { describe, it, expect, vi, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
vi.mock('../../../db/prisma.js', () => ({ prisma: new Proxy({}, { get() { throw new Error('Database access forbidden in scoring evaluation'); } }) }));
import { rankPlayersByMlPrediction } from '../player-ranking.service.js';
import { recommendCaptaincyFromMl } from '../ml-captaincy.service.js';
import { recommendTransfersFromMl } from '../ml-transfer-recommendation.service.js';
import { deriveScoringWeights, defaultWeights } from '../personalization.weights.js';
import { teamStrengthMultiplier } from '../team-strength.service.js';
import type { PlayerPredictionDto } from '../ml-prediction.types.js';

const root = resolve(process.cwd(), '../..');
const output = resolve(root, 'output/evaluation-day5/after-correction');
const results: Record<string, unknown> = {};
const player = (v: Partial<PlayerPredictionDto> = {}): PlayerPredictionDto => ({ playerId: 1, webName: 'Controlled example', club: 'ARS', position: 'MID', gameweek: 21, predictedPtsGw1: 4, predictedPtsGw3: 12, predictedPtsGw5: 19, probPlaying: .8, prob60PlusMins: .7, predictedMinutes: 70, confidence: 'HIGH', modelVersion: 'synthetic-input', generatedAt: '2026-09-16T00:00:00Z', ...v });
const profile = { riskTolerance: 2, budgetStyle: 2, preferredFocus: 2, differentialPreference: 2, planningHorizon: 2, explanationDepth: 2, topSixAffinity: 2, captaincyStyle: 2, transferFrequency: 2, fixtureAwareness: 2 };
const score = (p = player(), weights = defaultWeights()) => rankPlayersByMlPrediction([p], { weights })[0].rankingScore;

describe('Day 5: controlled evaluation of production scoring functions', () => {
  it('checks all 59,049 valid questionnaire combinations', () => {
    const keys = Object.keys(profile); let count = 0;
    for (let n = 0; n < 3 ** keys.length; n++) {
      let x = n; const p = { ...profile };
      for (const k of keys) { p[k as keyof typeof p] = x % 3 + 1; x = Math.floor(x / 3); }
      const w = deriveScoringWeights(p);
      expect(w.gw1Weight + w.gw3Weight + w.gw5Weight).toBeCloseTo(1, 12);
      expect(Object.values(w).every(Number.isFinite)).toBe(true);
      expect(Number.isFinite(score(player(), w))).toBe(true); count++;
    }
    results.profileCombinations = count;
  });
  it('reproduces the worked example independently and checks confidence effects', () => {
    expect(score()).toBeCloseTo(5.086, 3);
    const values = ['LOW', 'MEDIUM', 'HIGH'].map(confidence => score(player({ confidence: confidence as any })));
    expect(values[0]).toBeLessThan(values[1]); expect(values[1]).toBeLessThan(values[2]);
    results.confidenceScores = values;
  });
  it('sweeps participation and verifies risk order and non-decreasing scores', () => {
    const rows: { probability: number; scores: number[] }[] = [];
    for (let n = 0; n <= 100; n++) {
      const prob = n / 100;
      const scores = [1, 2, 3].map(riskTolerance => score(player({ probPlaying: prob }), deriveScoringWeights({ ...profile, riskTolerance })));
      expect(scores[0]).toBeLessThanOrEqual(scores[1]); expect(scores[1]).toBeLessThanOrEqual(scores[2]);
      if (n) scores.forEach((s, i) => expect(s).toBeGreaterThanOrEqual(rows[n - 1].scores[i]));
      rows.push({ probability: prob, scores });
    }
    results.riskSweep = rows;
    results.zeroForecastWithDifferential = rankPlayersByMlPrediction([player({ predictedPtsGw1: 0, predictedPtsGw3: 0, predictedPtsGw5: 0, probPlaying: 0, prob60PlusMins: 0 })], { weights: { ...defaultWeights(), differentialBonus: .2 }, ownershipById: new Map([[1, 0]]) })[0];
  });
  it('checks forecast monotonicity and a planning-horizon rank reversal', () => {
    for (const field of ['predictedPtsGw1', 'predictedPtsGw3', 'predictedPtsGw5']) {
      let previous = -Infinity;
      for (let n = 0; n <= 100; n++) { const s = score(player({ [field]: n / 2 })); expect(s).toBeGreaterThanOrEqual(previous); previous = s; }
    }
    const candidates = [player({ playerId: 1, predictedPtsGw1: 8, predictedPtsGw3: 12, predictedPtsGw5: 15 }), player({ playerId: 2, predictedPtsGw1: 4, predictedPtsGw3: 16, predictedPtsGw5: 30 })];
    const rows = [1, 2, 3].map(planningHorizon => ({ planningHorizon, ranked: rankPlayersByMlPrediction(candidates, { weights: deriveScoringWeights({ ...profile, planningHorizon }) }).map(p => ({ id: p.playerId, score: p.rankingScore })) }));
    expect(rows[0].ranked[0].id).toBe(1); expect(rows[2].ranked[0].id).toBe(2); results.horizon = rows;
  });
  it('measures ownership, missing ownership and Big Six effects', () => {
    const rows = [0, 1, 10, 50, 90, 100].map(ownership => ({ ownership, score: rankPlayersByMlPrediction([player()], { weights: { ...defaultWeights(), differentialBonus: .2 }, ownershipById: new Map([[1, ownership]]) })[0].rankingScore }));
    for (let i = 1; i < rows.length; i++) expect(rows[i].score).toBeLessThanOrEqual(rows[i - 1].score);
    results.ownership = rows;
    results.missingOwnership = { absentMap: score(), emptyMap: rankPlayersByMlPrediction([player()], { weights: defaultWeights(), ownershipById: new Map() })[0].rankingScore };
    results.bigSix = [1, 2, 3].map(topSixAffinity => ({ topSixAffinity, score: rankPlayersByMlPrediction([player({ position: 'DEF' })], { weights: deriveScoringWeights({ ...profile, topSixAffinity, preferredFocus: 1 }), teamIdByPlayerId: new Map([[1, 10]]), teamShortById: new Map([[10, 'ARS']]) })[0].rankingScore }));
  });
  it('checks team-context bounds on 1,200 controlled combinations', () => {
    const rows = [];
    for (const position of [1, 2, 3, 4]) for (let n = 1; n <= 100; n++) for (const fixtureWeight of [.5, 1, 1.5]) {
      const q = n / 20;
      const facts = { teamId: 1, shortName: 'TST', gamesPlayed: 10, goalsConcededPerGame: q, cleanSheetRate: Math.min(1, q / 5), savesPerGame: q, goalsScoredPerGame: q, assistsPerGame: q, attackingReturnsPerGame: 2 * q };
      const index = { byTeamId: new Map([[1, facts], [2, { ...facts, teamId: 2 }]]), leagueAvgConcededPerGame: 1.5, leagueAvgScoredPerGame: 1.5, leagueAvgCleanSheetRate: .25, leagueAvgSavesPerGame: 3, leagueAvgAssistsPerGame: 1, leagueAvgAttackingReturns: 2.5 };
      const fixture = { byTeamId: new Map([[1, { opponentId: 2, isHome: true, fdr: 2, gameweek: 21 }]]) };
      const m = teamStrengthMultiplier(position, 1, index, fixtureWeight, fixture).multiplier;
      expect(m).toBeGreaterThanOrEqual(.7); expect(m).toBeLessThanOrEqual(1.35);
      if (n === 20) { const changed = { byTeamId: new Map([[1, { opponentId: 2, isHome: true, fdr: 5, gameweek: 21 }]]) }; expect(teamStrengthMultiplier(position, 1, index, fixtureWeight, changed).multiplier).toBe(m); }
      rows.push({ position, q, fixtureWeight, multiplier: m });
    }
    results.teamSweep = rows;
  });
  it('records captain safety precedence and risk thresholds', () => {
    const safe = player({ playerId: 1, probPlaying: .9, predictedMinutes: 80 });
    const risky = player({ playerId: 2, predictedPtsGw1: 30, probPlaying: .59 });
    const r = recommendCaptaincyFromMl([safe, risky]);
    expect(r.captain?.playerId).toBe(1); expect(r.viceCaptain?.captaincyScore).toBeGreaterThan(r.captain!.captaincyScore);
    results.captainSafety = r;
    results.captainStyles = [1, 2, 3].map(captaincyStyle => recommendCaptaincyFromMl([risky], { weights: deriveScoringWeights({ ...profile, captaincyStyle }) }).captain);
  });
  it('records transfer horizon gating, negative scores and unused hit tolerance', () => {
    const outgoing = player({ predictedPtsGw1: 8, predictedPtsGw3: 12, predictedPtsGw5: 20 });
    const incoming = player({ playerId: 2, predictedPtsGw1: 1, predictedPtsGw3: 13, predictedPtsGw5: 14 });
    const rows = [1, 2, 3].map(transferFrequency => recommendTransfersFromMl({ squadPredictions: [outgoing], candidatePool: [incoming], ctx: { weights: deriveScoringWeights({ ...profile, planningHorizon: 1, transferFrequency }) } }));
    expect(rows[0].candidates).toHaveLength(0);
    expect(rows[0]).toEqual(rows[1]); expect(rows[1]).toEqual(rows[2]); results.negativeTransfer = rows[0];
    const rejected = recommendTransfersFromMl({ squadPredictions: [outgoing], candidatePool: [player({ playerId: 3, predictedPtsGw1: 12, predictedPtsGw3: 11, predictedPtsGw5: 30 })] });
    expect(rejected.candidates).toHaveLength(0); results.transferGw3Gate = 'Rejects positive GW1/GW5 when GW3 delta is non-positive';
  });
  it('retains a positive move while excluding zero, negative and non-finite scores', () => {
    const outgoing = player({ predictedPtsGw1: 8, predictedPtsGw3: 12, predictedPtsGw5: 20 });
    const candidates = [
      player({ playerId: 2, predictedPtsGw1: 1, predictedPtsGw3: 13, predictedPtsGw5: 14 }),
      player({ playerId: 3, predictedPtsGw1: 12, predictedPtsGw3: 16, predictedPtsGw5: 24 }),
      player({ playerId: 4, predictedPtsGw1: 7, predictedPtsGw3: 13, predictedPtsGw5: 20 }),
      player({ playerId: 5, predictedPtsGw1: Number.NaN, predictedPtsGw3: 14 }),
      player({ playerId: 6, predictedPtsGw1: Number.POSITIVE_INFINITY, predictedPtsGw3: 14 }),
    ];
    const weights = { ...defaultWeights(), gw1Weight: .5, gw3Weight: .5, gw5Weight: 0 };
    const r = recommendTransfersFromMl({ squadPredictions: [outgoing], candidatePool: candidates, ctx: { weights } });
    expect(r.candidates.map(p => p.incoming.playerId)).toEqual([3]);
    expect(r.candidates[0].transferScore).toBe(3.36);
    const frequencies = [1, 2, 3].map(transferFrequency => recommendTransfersFromMl({ squadPredictions: [outgoing], candidatePool: [candidates[1]], ctx: { weights: deriveScoringWeights({ ...profile, transferFrequency }) } }));
    expect(frequencies[0]).toEqual(frequencies[1]); expect(frequencies[1]).toEqual(frequencies[2]);
    results.transferCorrection = { retained: r.candidates.map(p => ({ id: p.incoming.playerId, score: p.transferScore })), rejectedIds: [2, 4, 5, 6], positiveCaseFrequencyInvariant: true };
  });
  it('checks reproducibility, input preservation and tied-score input order', () => {
    const input = [player({ playerId: 1 }), player({ playerId: 2 })]; const before = JSON.stringify(input);
    expect(rankPlayersByMlPrediction(input)).toEqual(rankPlayersByMlPrediction(input)); expect(JSON.stringify(input)).toBe(before);
    expect(rankPlayersByMlPrediction([...input].reverse())[0].playerId).toBe(2);
    results.ties = 'Equal rounded scores preserve input order';
  });
});

afterAll(() => {
  mkdirSync(output, { recursive: true });
  const files = ['player-ranking.service.ts', 'personalization.weights.ts', 'ml-captaincy.service.ts', 'ml-transfer-recommendation.service.ts', 'team-strength.service.ts'];
  results.sourceHashes = Object.fromEntries(files.map(f => [f, createHash('sha256').update(readFileSync(resolve(process.cwd(), 'src/modules/assistant', f))).digest('hex')]));
  results.method = 'Controlled synthetic inputs passed to production functions; database blocked; no historical return claims.';
  writeFileSync(resolve(output, 'controlled-results.json'), JSON.stringify(results, null, 2));
});
