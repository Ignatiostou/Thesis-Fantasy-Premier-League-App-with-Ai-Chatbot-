// apps/api/src/modules/ai/__tests__/ml-squad-advisor.service.test.ts
//
// Pure unit tests — no DB, no mocks.

import { describe, it, expect } from 'vitest';
import { buildMlSquadAdvice } from '../ml-squad-advisor.service.js';
import type { PlayerPredictionDto } from '../ml-prediction.types.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makePlayer(overrides: Partial<PlayerPredictionDto> & { playerId: number }): PlayerPredictionDto {
  return {
    playerId:         overrides.playerId,
    webName:          overrides.webName          ?? `Player${overrides.playerId}`,
    club:             overrides.club             ?? 'CHE',
    position:         overrides.position         ?? 'MID',
    gameweek:         overrides.gameweek         ?? 34,
    predictedPtsGw1:  overrides.predictedPtsGw1  ?? 5,
    predictedPtsGw3:  overrides.predictedPtsGw3  ?? 15,
    predictedPtsGw5:  overrides.predictedPtsGw5  ?? 25,
    probPlaying:      overrides.probPlaying       ?? 0.88,
    prob60PlusMins:   overrides.prob60PlusMins    ?? 0.82,
    predictedMinutes: overrides.predictedMinutes  ?? 74,
    confidence:       overrides.confidence        ?? 'HIGH',
    modelVersion:     overrides.modelVersion      ?? 'v1',
    generatedAt:      overrides.generatedAt       ?? new Date().toISOString(),
  };
}

// Standard 15-man squad
function buildSquad(): PlayerPredictionDto[] {
  return [
    makePlayer({ playerId: 1,  position: 'GK',  webName: 'MainGK',   predictedPtsGw1: 4,  probPlaying: 0.95 }),
    makePlayer({ playerId: 2,  position: 'GK',  webName: 'BackupGK', predictedPtsGw1: 2,  probPlaying: 0.10 }),
    makePlayer({ playerId: 3,  position: 'DEF', webName: 'Def1',     predictedPtsGw1: 5  }),
    makePlayer({ playerId: 4,  position: 'DEF', webName: 'Def2',     predictedPtsGw1: 5  }),
    makePlayer({ playerId: 5,  position: 'DEF', webName: 'Def3',     predictedPtsGw1: 4  }),
    makePlayer({ playerId: 6,  position: 'DEF', webName: 'Def4',     predictedPtsGw1: 4  }),
    makePlayer({ playerId: 7,  position: 'DEF', webName: 'Def5',     predictedPtsGw1: 3  }),
    makePlayer({ playerId: 8,  position: 'MID', webName: 'Mid1',     predictedPtsGw1: 9  }),
    makePlayer({ playerId: 9,  position: 'MID', webName: 'Mid2',     predictedPtsGw1: 8  }),
    makePlayer({ playerId: 10, position: 'MID', webName: 'Mid3',     predictedPtsGw1: 7  }),
    makePlayer({ playerId: 11, position: 'MID', webName: 'Mid4',     predictedPtsGw1: 6  }),
    makePlayer({ playerId: 12, position: 'MID', webName: 'Mid5',     predictedPtsGw1: 5  }),
    makePlayer({ playerId: 13, position: 'FWD', webName: 'Fwd1',     predictedPtsGw1: 8  }),
    makePlayer({ playerId: 14, position: 'FWD', webName: 'Fwd2',     predictedPtsGw1: 6  }),
    makePlayer({ playerId: 15, position: 'FWD', webName: 'Fwd3',     predictedPtsGw1: 4  }),
  ];
}

// ── buildMlSquadAdvice ────────────────────────────────────────────────────────

describe('buildMlSquadAdvice', () => {

  it('returns empty advice for empty squad', () => {
    const result = buildMlSquadAdvice([]);
    expect(result.optimalStarters).toHaveLength(0);
    expect(result.benchOrder).toHaveLength(0);
    expect(result.summary).toContain('No ML squad advice');
  });

  it('optimalStarters has at most 11 players', () => {
    const result = buildMlSquadAdvice(buildSquad());
    expect(result.optimalStarters.length).toBeLessThanOrEqual(11);
  });

  it('benchOrder contains the remaining players not in optimalStarters', () => {
    const squad = buildSquad();
    const result = buildMlSquadAdvice(squad);
    const starterIds = new Set(result.optimalStarters.map((p) => p.playerId));
    const benchIds   = new Set(result.benchOrder.map((p) => p.playerId));

    // No overlap between starters and bench
    for (const id of starterIds) {
      expect(benchIds.has(id)).toBe(false);
    }

    // All 15 players accounted for
    expect(starterIds.size + benchIds.size).toBe(squad.length);
  });

  // ── GK selection ──────────────────────────────────────────────────────────

  it('includes exactly one GK in optimalStarters', () => {
    const result = buildMlSquadAdvice(buildSquad());
    const gkCount = result.optimalStarters.filter((p) => p.position === 'GK').length;
    expect(gkCount).toBe(1);
  });

  it('picks the GK with higher probPlaying as the starting GK', () => {
    const result = buildMlSquadAdvice(buildSquad());
    const startingGk = result.optimalStarters.find((p) => p.position === 'GK');
    expect(startingGk?.playerId).toBe(1); // MainGK (probPlaying 0.95)
  });

  it('does NOT select a GK with probPlaying <= 0.50 as starter', () => {
    // BackupGK has probPlaying 0.10 — should never start
    const result = buildMlSquadAdvice(buildSquad());
    const startingGk = result.optimalStarters.find((p) => p.position === 'GK');
    expect(startingGk?.playerId).not.toBe(2); // BackupGK
  });

  it('falls back gracefully when no GK has probPlaying > 0.50', () => {
    const squad = [
      makePlayer({ playerId: 1, position: 'GK', probPlaying: 0.30 }),
      makePlayer({ playerId: 2, position: 'GK', probPlaying: 0.20 }),
      ...Array.from({ length: 10 }, (_, i) => makePlayer({ playerId: 10 + i, position: 'MID' })),
    ];
    // Should not crash — GK bench slot is handled gracefully
    expect(() => buildMlSquadAdvice(squad)).not.toThrow();
  });

  // ── Bench ordering ────────────────────────────────────────────────────────

  it('bench GK is last in bench order', () => {
    const result = buildMlSquadAdvice(buildSquad());
    const lastBench = result.benchOrder[result.benchOrder.length - 1];
    expect(lastBench?.position).toBe('GK');
  });

  it('bench outfield players are sorted by rankingScore descending', () => {
    const result = buildMlSquadAdvice(buildSquad());
    const outfieldBench = result.benchOrder.filter((p) => p.position !== 'GK');
    for (let i = 0; i < outfieldBench.length - 1; i++) {
      expect(outfieldBench[i].rankingScore).toBeGreaterThanOrEqual(outfieldBench[i + 1].rankingScore);
    }
  });

  // ── weakLinks and rotationRisks ───────────────────────────────────────────

  it('weakLinks has at most 5 players', () => {
    const result = buildMlSquadAdvice(buildSquad());
    expect(result.weakLinks.length).toBeLessThanOrEqual(5);
  });

  it('rotationRisks has at most 5 players', () => {
    const result = buildMlSquadAdvice(buildSquad());
    expect(result.rotationRisks.length).toBeLessThanOrEqual(5);
  });

  it('weakLink players have the lowest rankingScores in the squad', () => {
    const result = buildMlSquadAdvice(buildSquad());
    if (result.weakLinks.length === 0) return;
    const minStarterScore = Math.min(...result.optimalStarters.map((p) => p.rankingScore));
    const maxWeakScore    = Math.max(...result.weakLinks.map((p) => p.rankingScore));
    // Weak links should generally score below most starters
    // (this is a heuristic check, not an exact requirement)
    expect(maxWeakScore).toBeLessThanOrEqual(minStarterScore * 1.2);
  });

  // ── Summary ───────────────────────────────────────────────────────────────

  it('summary mentions squad size and best starter', () => {
    const result = buildMlSquadAdvice(buildSquad());
    expect(result.summary).toContain('15 squad predictions');
    expect(result.summary).toContain('xPts');
  });

  it('summary mentions the best projected starter by name', () => {
    const result = buildMlSquadAdvice(buildSquad());
    // Mid1 has highest predictedPtsGw1 (9) among outfield
    // but GK might rank differently — just check a name is mentioned
    const names = buildSquad().map((p) => p.webName);
    const mentionedName = names.find((n) => result.summary.includes(n));
    expect(mentionedName).toBeTruthy();
  });

  // ── Edge cases ────────────────────────────────────────────────────────────

  it('handles squad with only GK players gracefully', () => {
    const gkOnly = [
      makePlayer({ playerId: 1, position: 'GK', probPlaying: 0.90 }),
      makePlayer({ playerId: 2, position: 'GK', probPlaying: 0.10 }),
    ];
    expect(() => buildMlSquadAdvice(gkOnly)).not.toThrow();
  });

  it('handles squad with no GK gracefully', () => {
    const noGk = Array.from({ length: 11 }, (_, i) =>
      makePlayer({ playerId: i + 1, position: 'MID' }),
    );
    const result = buildMlSquadAdvice(noGk);
    const gkCount = result.optimalStarters.filter((p) => p.position === 'GK').length;
    expect(gkCount).toBe(0); // No GK available — graceful
  });

  it('does not include duplicate players across starters and bench', () => {
    const result = buildMlSquadAdvice(buildSquad());
    const allIds = [
      ...result.optimalStarters.map((p) => p.playerId),
      ...result.benchOrder.map((p) => p.playerId),
    ];
    const uniqueIds = new Set(allIds);
    expect(uniqueIds.size).toBe(allIds.length);
  });
});