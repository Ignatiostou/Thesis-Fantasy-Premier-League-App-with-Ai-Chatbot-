import { it, expect, vi } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
vi.mock('../../../db/prisma.js', () => ({ prisma: new Proxy({}, { get() { throw new Error('No database in controlled grid'); } }) }));
import { rankPlayersByMlPrediction } from '../player-ranking.service.js';
import { deriveScoringWeights } from '../personalization.weights.js';
import type { PlayerPredictionDto } from '../ml-prediction.types.js';

it('evaluates multiple forecast trajectories, confidence levels and minutes factors', () => {
  const out=resolve('../../output/evaluation-scoring-grid'); mkdirSync(out,{recursive:true});
  const profile={riskTolerance:2,budgetStyle:2,preferredFocus:2,differentialPreference:2,planningHorizon:2,explanationDepth:2,topSixAffinity:2,captaincyStyle:2,transferFrequency:2,fixtureAwareness:2};
  const trajectories: PlayerPredictionDto[]=[];
  for(const immediate of [2,4,6,8]) for(const nextTwo of [0,4,8,12]) for(const lastTwo of [0,4,8,12]) trajectories.push({
    playerId:trajectories.length+1,webName:'Synthetic trajectory',club:'ARS',position:'MID',gameweek:21,
    predictedPtsGw1:immediate,predictedPtsGw3:immediate+nextTwo,predictedPtsGw5:immediate+nextTwo+lastTwo,
    probPlaying:.8,prob60PlusMins:.7,predictedMinutes:70,confidence:'HIGH',modelVersion:'controlled-grid',generatedAt:'2026-09-25T00:00:00Z',
  });
  const weights=[1,2,3].map(riskTolerance=>deriveScoringWeights({...profile,riskTolerance}));
  const risk:any[]=[];
  for(const p of trajectories) for(const confidence of ['LOW','MEDIUM','HIGH'] as const) for(const prob60PlusMins of [.3,.6,.9]) {
    let previous=[-Infinity,-Infinity,-Infinity];
    for(let step=0;step<=100;step++) {
      const probPlaying=step/100;
      const scores=weights.map(w=>rankPlayersByMlPrediction([{...p,confidence,prob60PlusMins,probPlaying}],{weights:w})[0].rankingScore);
      expect(scores.every(Number.isFinite)).toBe(true);
      expect(scores[0]).toBeLessThanOrEqual(scores[1]); expect(scores[1]).toBeLessThanOrEqual(scores[2]);
      scores.forEach((s,i)=>expect(s).toBeGreaterThanOrEqual(previous[i])); previous=scores;
      risk.push({trajectory:p.playerId,confidence,prob60PlusMins,probability:probPlaying,scores});
    }
  }
  const horizons=[1,2,3].map(planningHorizon=>({planningHorizon,ranked:rankPlayersByMlPrediction(trajectories,{weights:deriveScoringWeights({...profile,planningHorizon})}).map((p,i)=>({id:p.playerId,rank:i+1,score:p.rankingScore}))}));
  const hashes=Object.fromEntries(['player-ranking.service.ts','personalization.weights.ts'].map(n=>[n,createHash('sha256').update(readFileSync(resolve('src/modules/assistant',n))).digest('hex')]));
  writeFileSync(resolve(out,'results.json'),JSON.stringify({protocol:'Deterministic synthetic grid; not historical players or independent observations. Risk varies 64 forecast trajectories x 3 confidence levels x 3 sixty-minute factors x 101 probabilities x 3 risk profiles. Horizon ranks all 64 trajectories with probability .8, minutes factor .7 and HIGH confidence. No ownership/team context supplied. Rounded-score ties retain input order.',trajectories,risk,horizons,hashes}));
  expect(risk).toHaveLength(64*3*3*101);
},60000);
