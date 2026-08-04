// apps/api/src/modules/ai/__tests__/ml-captaincy.service.test.ts
//
// Pure unit tests — no DB, no mocks.

import { describe, it, expect } from 'vitest';
import { recommendCaptaincyFromMl } from '../ml-captaincy.service.js';
import type { PlayerPredictionDto } from '../ml-prediction.types.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makePlayer(overrides: Partial<PlayerPredictionDto> & { playerId: number }): PlayerPredictionDto {
  return {
    playerId:         overrides.playerId,
    webName:          overrides.webName          ?? `Player${overrides.playerId}`,
    club:             overrides.club             ?? 'ARS',
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

// Full squad of 4 for testing
const striker  = makePlayer({ playerId: 1, webName: 'Haaland',  position: 'FWD', predictedPtsGw1: 10, probPlaying: 0.95, prob60PlusMins: 0.90, predictedMinutes: 85, confidence: 'HIGH'   });
const midfielder = makePlayer({ playerId: 2, webName: 'Salah',    position: 'MID', predictedPtsGw1: 8,  probPlaying: 0.90, prob60PlusMins: 0.85, predictedMinutes: 80, confidence: 'HIGH'   });
const defender = makePlayer({ playerId: 3, webName: 'Alexander', position: 'DEF', predictedPtsGw1: 5,  probPlaying: 0.85, prob60PlusMins: 0.80, predictedMinutes: 78, confidence: 'MEDIUM' });
const rotation = makePlayer({ playerId: 4, webName: 'Rotation',  position: 'MID', predictedPtsGw1: 7,  probPlaying: 0.55, prob60PlusMins: 0.45, predictedMinutes: 50, confidence: 'LOW'    });

// ── recommendCaptaincyFromMl ──────────────────────────────────────────────────

describe('recommendCaptaincyFromMl', () => {

  it('returns null captain for empty squad', () => {
    const result = recommendCaptaincyFromMl([]);
    expect(result.captain).toBeNull();
    expect(result.viceCaptain).toBeNull();
    expect(result.alternatives).toHaveLength(0);
    expect(result.summary).toContain('No captaincy recommendation');
  });

  it('returns the single player as captain for a 1-player squad', () => {
    const result = recommendCaptaincyFromMl([striker]);
    expect(result.captain?.playerId).toBe(1);
    expect(result.viceCaptain).toBeNull();
  });

  it('picks the highest-scoring safe candidate as captain', () => {
    const result = recommendCaptaincyFromMl([striker, midfielder, defender]);
    // Haaland: 10 * 0.95 * 0.90 * 1.08 = 9.234
    // Salah:   8  * 0.90 * 0.85 * 1.08 = 6.609
    expect(result.captain?.playerId).toBe(1); // Haaland
  });

  it('picks a different player as vice-captain', () => {
    const result = recommendCaptaincyFromMl([striker, midfielder, defender]);
    expect(result.viceCaptain?.playerId).not.toBe(result.captain?.playerId);
  });

  it('excludes captain and vice-captain from alternatives', () => {
    const result = recommendCaptaincyFromMl([striker, midfielder, defender, rotation]);
    const altIds = result.alternatives.map((p) => p.playerId);
    expect(altIds).not.toContain(result.captain?.playerId);
    expect(altIds).not.toContain(result.viceCaptain?.playerId);
  });

  it('returns at most 4 alternatives', () => {
    const squad = Array.from({ length: 10 }, (_, i) =>
      makePlayer({ playerId: i + 10, predictedPtsGw1: 6 - i * 0.1 }),
    );
    const result = recommendCaptaincyFromMl(squad);
    expect(result.alternatives.length).toBeLessThanOrEqual(4);
  });

  // ── Risk thresholds ───────────────────────────────────────────────────────

  it('assigns HIGH captaincy risk when confidence is LOW', () => {
    const result = recommendCaptaincyFromMl([rotation]);
    expect(result.captain?.captaincyRisk).toBe('HIGH');
  });

  it('assigns HIGH captaincy risk when probPlaying < 0.60', () => {
    const risky = makePlayer({ playerId: 20, probPlaying: 0.55, confidence: 'HIGH', predictedMinutes: 75 });
    const result = recommendCaptaincyFromMl([risky]);
    expect(result.captain?.captaincyRisk).toBe('HIGH');
  });

  it('assigns HIGH captaincy risk when predictedMinutes < 45', () => {
    const risky = makePlayer({ playerId: 21, predictedMinutes: 40, confidence: 'HIGH', probPlaying: 0.90 });
    const result = recommendCaptaincyFromMl([risky]);
    expect(result.captain?.captaincyRisk).toBe('HIGH');
  });

  it('assigns LOW captaincy risk for a high-quality player', () => {
    const result = recommendCaptaincyFromMl([striker]);
    expect(result.captain?.captaincyRisk).toBe('LOW');
  });

  it('assigns MEDIUM risk when confidence MEDIUM with borderline minutes', () => {
    const borderline = makePlayer({ playerId: 22, confidence: 'MEDIUM', probPlaying: 0.85, predictedMinutes: 68 });
    const result = recommendCaptaincyFromMl([borderline]);
    expect(result.captain?.captaincyRisk).toBe('MEDIUM');
  });

  // ── Prefers safe candidates ───────────────────────────────────────────────

  it('prefers a safe (non-HIGH risk) candidate over a riskier high-scorer', () => {
    // rotation has higher raw xPts potential but LOW confidence → HIGH risk
    // midfielder is safer (MEDIUM risk but lower score)
    const riskyHighScorer = makePlayer({ playerId: 30, predictedPtsGw1: 12, probPlaying: 0.55, confidence: 'LOW', predictedMinutes: 40 });
    const safePlayer      = makePlayer({ playerId: 31, predictedPtsGw1: 7,  probPlaying: 0.85, confidence: 'HIGH', predictedMinutes: 75 });
    const result = recommendCaptaincyFromMl([riskyHighScorer, safePlayer]);
    expect(result.captain?.playerId).toBe(31); // safe player preferred
  });

  // ── Score calculation ─────────────────────────────────────────────────────

  it('captaincyScore is positive for every player', () => {
    const result = recommendCaptaincyFromMl([striker, midfielder, defender, rotation]);
    const allCandidates = [result.captain, result.viceCaptain, ...result.alternatives].filter(Boolean);
    for (const c of allCandidates) {
      expect(c!.captaincyScore).toBeGreaterThan(0);
    }
  });

  it('HIGH confidence multiplier (1.08) produces higher score than MEDIUM (1.0) with equal stats', () => {
    const highConf = makePlayer({ playerId: 40, confidence: 'HIGH',   predictedPtsGw1: 8, probPlaying: 0.90, prob60PlusMins: 0.85, predictedMinutes: 75 });
    const medConf  = makePlayer({ playerId: 41, confidence: 'MEDIUM', predictedPtsGw1: 8, probPlaying: 0.90, prob60PlusMins: 0.85, predictedMinutes: 75 });
    const result = recommendCaptaincyFromMl([medConf, highConf]);
    expect(result.captain?.playerId).toBe(40);
  });

  // ── Summary string ────────────────────────────────────────────────────────

  it('summary mentions the captain name', () => {
    const result = recommendCaptaincyFromMl([striker, midfielder]);
    expect(result.summary).toContain('Haaland');
  });

  it('explanation includes key stats', () => {
    const result = recommendCaptaincyFromMl([striker]);
    expect(result.captain?.explanation).toContain('projected GW points');
    expect(result.captain?.explanation).toContain('chance of playing');
    expect(result.captain?.explanation).toContain('Captaincy risk');
  });
});