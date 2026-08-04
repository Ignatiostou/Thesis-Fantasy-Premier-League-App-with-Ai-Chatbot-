import { describe, it, expect } from 'vitest';
import {
  rankPlayersByMlPrediction,
  getWeakestPlayersByMlPrediction,
  getRotationRisksByMlPrediction,
} from '../player-ranking.service.js';
import type { PlayerPredictionDto } from '../ml-prediction.types.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makePlayer(overrides: Partial<PlayerPredictionDto> & { playerId: number }): PlayerPredictionDto {
  return {
    playerId:         overrides.playerId,
    webName:          overrides.webName          ?? `Player${overrides.playerId}`,
    club:             overrides.club             ?? 'MCI',
    position:         overrides.position         ?? 'MID',
    gameweek:         overrides.gameweek         ?? 34,
    predictedPtsGw1:  overrides.predictedPtsGw1  ?? 6,
    predictedPtsGw3:  overrides.predictedPtsGw3  ?? 18,
    predictedPtsGw5:  overrides.predictedPtsGw5  ?? 30,
    probPlaying:      overrides.probPlaying       ?? 0.90,
    prob60PlusMins:   overrides.prob60PlusMins    ?? 0.85,
    predictedMinutes: overrides.predictedMinutes  ?? 75,
    confidence:       overrides.confidence        ?? 'HIGH',
    modelVersion:     overrides.modelVersion      ?? 'v1',
    generatedAt:      overrides.generatedAt       ?? new Date().toISOString(),
  };
}

const highPlayer  = makePlayer({ playerId: 1, predictedPtsGw1: 9, predictedPtsGw3: 27, predictedPtsGw5: 45, confidence: 'HIGH',   probPlaying: 0.95, prob60PlusMins: 0.90, predictedMinutes: 85 });
const midPlayer   = makePlayer({ playerId: 2, predictedPtsGw1: 6, predictedPtsGw3: 18, predictedPtsGw5: 30, confidence: 'MEDIUM', probPlaying: 0.80, prob60PlusMins: 0.75, predictedMinutes: 70 });
const lowPlayer   = makePlayer({ playerId: 3, predictedPtsGw1: 3, predictedPtsGw3: 9,  predictedPtsGw5: 15, confidence: 'LOW',    probPlaying: 0.50, prob60PlusMins: 0.40, predictedMinutes: 50 });
const rotPlayer   = makePlayer({ playerId: 4, predictedPtsGw1: 5, predictedPtsGw3: 15, predictedPtsGw5: 25, confidence: 'MEDIUM', probPlaying: 0.70, prob60PlusMins: 0.55, predictedMinutes: 55 });

// ── rankPlayersByMlPrediction ─────────────────────────────────────────────────

describe('rankPlayersByMlPrediction', () => {

  it('returns empty array for empty input', () => {
    expect(rankPlayersByMlPrediction([])).toEqual([]);
  });

  it('returns single player with rankingScore and riskLabel', () => {
    const [result] = rankPlayersByMlPrediction([highPlayer]);
    expect(result.rankingScore).toBeGreaterThan(0);
    expect(['LOW', 'MEDIUM', 'HIGH']).toContain(result.riskLabel);
    expect(result.reason).toBeTruthy();
  });

  it('sorts players descending by rankingScore', () => {
    const ranked = rankPlayersByMlPrediction([lowPlayer, midPlayer, highPlayer]);
    expect(ranked[0].playerId).toBe(1); // highPlayer
    expect(ranked[1].playerId).toBe(2); // midPlayer
    expect(ranked[2].playerId).toBe(3); // lowPlayer
  });

  it('does not mutate the original array', () => {
    const input = [lowPlayer, highPlayer];
    const copy  = [...input];
    rankPlayersByMlPrediction(input);
    expect(input).toEqual(copy);
  });

  // ── Risk label thresholds ────────────────────────────────────────────────

  it('assigns HIGH risk when confidence is LOW', () => {
    const [result] = rankPlayersByMlPrediction([lowPlayer]);
    expect(result.riskLabel).toBe('HIGH');
  });

  it('assigns HIGH risk when probPlaying < 0.55', () => {
    const p = makePlayer({ playerId: 10, probPlaying: 0.50, confidence: 'HIGH' });
    const [result] = rankPlayersByMlPrediction([p]);
    expect(result.riskLabel).toBe('HIGH');
  });

  it('assigns HIGH risk when predictedMinutes < 30', () => {
    const p = makePlayer({ playerId: 11, predictedMinutes: 20, confidence: 'HIGH', probPlaying: 0.90 });
    const [result] = rankPlayersByMlPrediction([p]);
    expect(result.riskLabel).toBe('HIGH');
  });

  it('assigns MEDIUM risk when confidence is MEDIUM and thresholds are borderline', () => {
    const [result] = rankPlayersByMlPrediction([midPlayer]);
    expect(result.riskLabel).toBe('MEDIUM');
  });

  it('assigns LOW risk for fully available HIGH-confidence player', () => {
    const [result] = rankPlayersByMlPrediction([highPlayer]);
    expect(result.riskLabel).toBe('LOW');
  });

  // ── Score formula verification ────────────────────────────────────────────

  it('HIGH confidence scores higher than MEDIUM for same predictions', () => {
    const high = makePlayer({ playerId: 20, confidence: 'HIGH',   predictedPtsGw1: 6, predictedPtsGw3: 18, predictedPtsGw5: 30, probPlaying: 0.90, prob60PlusMins: 0.85, predictedMinutes: 75 });
    const med  = makePlayer({ playerId: 21, confidence: 'MEDIUM', predictedPtsGw1: 6, predictedPtsGw3: 18, predictedPtsGw5: 30, probPlaying: 0.90, prob60PlusMins: 0.85, predictedMinutes: 75 });
    const ranked = rankPlayersByMlPrediction([med, high]);
    expect(ranked[0].playerId).toBe(20); // HIGH confidence first
  });

  it('LOW confidence multiplier (0.82) penalises score vs MEDIUM (1.0)', () => {
    const med = makePlayer({ playerId: 30, confidence: 'MEDIUM', predictedPtsGw1: 6, predictedPtsGw3: 18, predictedPtsGw5: 30, probPlaying: 0.90, prob60PlusMins: 0.85, predictedMinutes: 75 });
    const low = makePlayer({ playerId: 31, confidence: 'LOW',    predictedPtsGw1: 6, predictedPtsGw3: 18, predictedPtsGw5: 30, probPlaying: 0.90, prob60PlusMins: 0.85, predictedMinutes: 75 });
    const ranked = rankPlayersByMlPrediction([low, med]);
    expect(ranked[0].confidence).toBe('MEDIUM');
    expect(ranked[0].rankingScore).toBeGreaterThan(ranked[1].rankingScore);
  });

  it('probPlaying=0 uses 0.15 floor so score stays positive', () => {
    const p = makePlayer({ playerId: 40, probPlaying: 0, prob60PlusMins: 0 });
    const [result] = rankPlayersByMlPrediction([p]);
    expect(result.rankingScore).toBeGreaterThan(0);
  });

  it('includes correct reason string', () => {
    const [result] = rankPlayersByMlPrediction([highPlayer]);
    expect(result.reason).toContain('Player1');
    expect(result.reason).toContain('xPts');
    expect(result.reason).toContain('playing probability');
  });
});

// ── getWeakestPlayersByMlPrediction ───────────────────────────────────────────

describe('getWeakestPlayersByMlPrediction', () => {

  it('returns the lowest-ranked players', () => {
    const weakest = getWeakestPlayersByMlPrediction([lowPlayer, midPlayer, highPlayer], 2);
    expect(weakest[0].playerId).toBe(3); // lowPlayer is weakest
    expect(weakest[1].playerId).toBe(2); // midPlayer second weakest
  });

  it('respects the limit parameter', () => {
    const squad = [highPlayer, midPlayer, lowPlayer, rotPlayer];
    const weakest = getWeakestPlayersByMlPrediction(squad, 2);
    expect(weakest).toHaveLength(2);
  });

  it('returns all players when limit >= squad size', () => {
    const squad = [highPlayer, midPlayer, lowPlayer];
    const weakest = getWeakestPlayersByMlPrediction(squad, 10);
    expect(weakest).toHaveLength(3);
  });

  it('returns empty array for empty input', () => {
    expect(getWeakestPlayersByMlPrediction([])).toEqual([]);
  });
});

// ── getRotationRisksByMlPrediction ────────────────────────────────────────────

describe('getRotationRisksByMlPrediction', () => {

  it('excludes fully available LOW-risk players', () => {
    const risks = getRotationRisksByMlPrediction([highPlayer, lowPlayer]);
    const ids = risks.map((p) => p.playerId);
    expect(ids).not.toContain(1); // highPlayer — LOW risk, 85 mins — excluded
    expect(ids).toContain(3);     // lowPlayer — HIGH risk — included
  });

  it('sorts HIGH risk before MEDIUM risk', () => {
    const risks = getRotationRisksByMlPrediction([rotPlayer, lowPlayer]);
    expect(risks[0].riskLabel).toBe('HIGH'); // lowPlayer
    expect(risks[1].riskLabel).toBe('MEDIUM'); // rotPlayer
  });

  it('within same risk level, sorts ascending by predictedMinutes', () => {
    const fewer = makePlayer({ playerId: 50, confidence: 'MEDIUM', probPlaying: 0.70, predictedMinutes: 45 });
    const more  = makePlayer({ playerId: 51, confidence: 'MEDIUM', probPlaying: 0.70, predictedMinutes: 55 });
    const risks = getRotationRisksByMlPrediction([more, fewer]);
    // Both MEDIUM — fewer minutes first
    expect(risks[0].playerId).toBe(50);
  });

  it('respects the limit parameter', () => {
    const squad = [lowPlayer, rotPlayer, midPlayer, highPlayer];
    const risks = getRotationRisksByMlPrediction(squad, 2);
    expect(risks.length).toBeLessThanOrEqual(2);
  });

  it('returns empty array when all players are LOW risk', () => {
    const safe1 = makePlayer({ playerId: 60, confidence: 'HIGH', probPlaying: 0.95, prob60PlusMins: 0.90, predictedMinutes: 80 });
    const safe2 = makePlayer({ playerId: 61, confidence: 'HIGH', probPlaying: 0.95, prob60PlusMins: 0.90, predictedMinutes: 80 });
    const risks = getRotationRisksByMlPrediction([safe1, safe2]);
    expect(risks).toHaveLength(0);
  });
});