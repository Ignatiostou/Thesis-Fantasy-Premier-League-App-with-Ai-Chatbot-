// apps/api/src/modules/ai/__tests__/ml-transfer-recommendation.service.test.ts
//
// Pure unit tests — no DB, no mocks.

import { describe, it, expect } from 'vitest';
import { recommendTransfersFromMl } from '../ml-transfer-recommendation.service.js';
import type { PlayerPredictionDto } from '../ml-prediction.types.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makePlayer(overrides: Partial<PlayerPredictionDto> & { playerId: number }): PlayerPredictionDto {
  return {
    playerId:         overrides.playerId,
    webName:          overrides.webName          ?? `Player${overrides.playerId}`,
    club:             overrides.club             ?? 'MCI',
    position:         overrides.position         ?? 'MID',
    gameweek:         overrides.gameweek         ?? 34,
    predictedPtsGw1:  overrides.predictedPtsGw1  ?? 5,
    predictedPtsGw3:  overrides.predictedPtsGw3  ?? 15,
    predictedPtsGw5:  overrides.predictedPtsGw5  ?? 25,
    probPlaying:      overrides.probPlaying       ?? 0.85,
    prob60PlusMins:   overrides.prob60PlusMins    ?? 0.80,
    predictedMinutes: overrides.predictedMinutes  ?? 72,
    confidence:       overrides.confidence        ?? 'HIGH',
    modelVersion:     overrides.modelVersion      ?? 'v1',
    generatedAt:      overrides.generatedAt       ?? new Date().toISOString(),
  };
}

// Squad: weak midfielder is the transfer target
const weakMid  = makePlayer({ playerId: 1, webName: 'WeakMid',    position: 'MID', predictedPtsGw3: 6,  probPlaying: 0.70 });
const solidDef = makePlayer({ playerId: 2, webName: 'SolidDef',   position: 'DEF', predictedPtsGw3: 15, probPlaying: 0.90 });
const goodFwd  = makePlayer({ playerId: 3, webName: 'GoodFwd',    position: 'FWD', predictedPtsGw3: 18, probPlaying: 0.90 });

// Candidate pool
const upgradeMid  = makePlayer({ playerId: 10, webName: 'UpgradeMid', position: 'MID', predictedPtsGw3: 20, predictedPtsGw1: 7,  probPlaying: 0.90, confidence: 'HIGH'   });
const medConfMid  = makePlayer({ playerId: 11, webName: 'MedMid',     position: 'MID', predictedPtsGw3: 18, predictedPtsGw1: 6,  probPlaying: 0.80, confidence: 'MEDIUM' });
const lowConfMid  = makePlayer({ playerId: 12, webName: 'LowMid',     position: 'MID', predictedPtsGw3: 25, predictedPtsGw1: 9,  probPlaying: 0.70, confidence: 'LOW'    });
const wrongPosMid = makePlayer({ playerId: 13, webName: 'WrongPos',   position: 'FWD', predictedPtsGw3: 22, predictedPtsGw1: 8,  probPlaying: 0.90, confidence: 'HIGH'   }); // FWD not MID
const lowAvail    = makePlayer({ playerId: 14, webName: 'LowAvail',   position: 'MID', predictedPtsGw3: 24, predictedPtsGw1: 8,  probPlaying: 0.60, confidence: 'HIGH'   }); // probPlaying < 0.65

// ── recommendTransfersFromMl ──────────────────────────────────────────────────

describe('recommendTransfersFromMl', () => {

  it('returns empty candidates when pool is empty', () => {
    const result = recommendTransfersFromMl({
      squadPredictions: [weakMid, solidDef, goodFwd],
      candidatePool:    [],
    });
    expect(result.candidates).toHaveLength(0);
    expect(result.summary).toContain('No clearly positive');
  });

  it('returns empty candidates when squad is empty', () => {
    const result = recommendTransfersFromMl({
      squadPredictions: [],
      candidatePool:    [upgradeMid],
    });
    expect(result.candidates).toHaveLength(0);
  });

  it('finds a valid upgrade when one exists', () => {
    const result = recommendTransfersFromMl({
      squadPredictions: [weakMid, solidDef, goodFwd],
      candidatePool:    [upgradeMid],
    });
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates[0].outgoing.playerId).toBe(1);  // weakMid goes out
    expect(result.candidates[0].incoming.playerId).toBe(10); // upgradeMid comes in
  });

  it('delta is positive for a valid upgrade', () => {
    const result = recommendTransfersFromMl({
      squadPredictions: [weakMid],
      candidatePool:    [upgradeMid],
    });
    expect(result.candidates[0].deltaGw3).toBeGreaterThan(0);
  });

  it('excludes players already in the squad from incoming options', () => {
    const result = recommendTransfersFromMl({
      squadPredictions: [weakMid, upgradeMid], // upgradeMid already in squad
      candidatePool:    [upgradeMid],
    });
    // upgradeMid is in squad — can't be incoming
    expect(result.candidates).toHaveLength(0);
  });

  it('excludes LOW confidence candidates from incoming pool', () => {
    const result = recommendTransfersFromMl({
      squadPredictions: [weakMid],
      candidatePool:    [lowConfMid], // confidence LOW
    });
    expect(result.candidates).toHaveLength(0);
  });

  it('excludes candidates with probPlaying < 0.65', () => {
    const result = recommendTransfersFromMl({
      squadPredictions: [weakMid],
      candidatePool:    [lowAvail], // probPlaying 0.60
    });
    expect(result.candidates).toHaveLength(0);
  });

  it('only matches candidates of the same position', () => {
    const result = recommendTransfersFromMl({
      squadPredictions: [weakMid],
      candidatePool:    [wrongPosMid], // FWD, not MID
    });
    expect(result.candidates).toHaveLength(0);
  });

  it('excludes transfers where deltaGw3 <= 0', () => {
    const downgrade = makePlayer({ playerId: 20, position: 'MID', predictedPtsGw3: 3, probPlaying: 0.90, confidence: 'HIGH' });
    const result = recommendTransfersFromMl({
      squadPredictions: [weakMid],
      candidatePool:    [downgrade],
    });
    expect(result.candidates).toHaveLength(0);
  });

  it('respects maxResults limit', () => {
    const pool = Array.from({ length: 20 }, (_, i) =>
      makePlayer({ playerId: 100 + i, position: 'MID', predictedPtsGw3: 20 + i, probPlaying: 0.90, confidence: 'HIGH' }),
    );
    const result = recommendTransfersFromMl({
      squadPredictions: [weakMid],
      candidatePool:    pool,
      maxResults:       3,
    });
    expect(result.candidates).toHaveLength(3);
  });

  it('sorts candidates by transferScore descending', () => {
    const result = recommendTransfersFromMl({
      squadPredictions: [weakMid],
      candidatePool:    [medConfMid, upgradeMid],
    });
    if (result.candidates.length >= 2) {
      expect(result.candidates[0].transferScore).toBeGreaterThanOrEqual(result.candidates[1].transferScore);
    }
  });

  // ── Risk labelling ────────────────────────────────────────────────────────

  it('labels HIGH confidence candidate as LOW transfer risk', () => {
    const result = recommendTransfersFromMl({
      squadPredictions: [weakMid],
      candidatePool:    [upgradeMid],
    });
    expect(result.candidates[0].risk).toBe('LOW');
  });

  it('labels MEDIUM confidence as MEDIUM transfer risk', () => {
    const result = recommendTransfersFromMl({
      squadPredictions: [weakMid],
      candidatePool:    [medConfMid],
    });
    expect(result.candidates[0].risk).toBe('MEDIUM');
  });

  // ── Summary string ────────────────────────────────────────────────────────

  it('summary mentions best move when candidates exist', () => {
    const result = recommendTransfersFromMl({
      squadPredictions: [weakMid],
      candidatePool:    [upgradeMid],
    });
    expect(result.summary).toContain('WeakMid');
    expect(result.summary).toContain('UpgradeMid');
    expect(result.summary).toContain('xPts');
  });

  it('delta values are rounded to 2 decimal places', () => {
    const result = recommendTransfersFromMl({
      squadPredictions: [weakMid],
      candidatePool:    [upgradeMid],
    });
    const { deltaGw1, deltaGw3, deltaGw5 } = result.candidates[0];
    expect(String(deltaGw1).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(2);
    expect(String(deltaGw3).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(2);
    expect(String(deltaGw5).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(2);
  });

  // ── Outgoing options: bottom 6 by GW3 ────────────────────────────────────

  it('picks from the bottom 6 squad players as outgoing candidates', () => {
    // Build 8-player squad where top 2 by GW3 should never be outgoing
    const topPlayers = [
      makePlayer({ playerId: 200, position: 'MID', predictedPtsGw3: 30 }),
      makePlayer({ playerId: 201, position: 'MID', predictedPtsGw3: 28 }),
    ];
    const bottomPlayers = Array.from({ length: 6 }, (_, i) =>
      makePlayer({ playerId: 210 + i, position: 'MID', predictedPtsGw3: i + 1 }),
    );
    const candidatePool = [
      makePlayer({ playerId: 300, position: 'MID', predictedPtsGw3: 20, probPlaying: 0.90, confidence: 'HIGH' }),
    ];

    const result = recommendTransfersFromMl({
      squadPredictions: [...topPlayers, ...bottomPlayers],
      candidatePool,
    });

    // Outgoing should never be playerId 200 or 201 (top GW3 scorers)
    for (const c of result.candidates) {
      expect([200, 201]).not.toContain(c.outgoing.playerId);
    }
  });
});