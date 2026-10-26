import { it,expect,vi } from 'vitest';
import { readFileSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
vi.mock('../../../db/prisma.js',()=>({prisma:new Proxy({},{get(){throw new Error('No DB in fixture sensitivity');}})}));
import { rankPlayersByMlPrediction } from '../player-ranking.service.js';
import { defaultWeights } from '../personalization.weights.js';
import type { PlayerPredictionDto } from '../ml-prediction.types.js';
type Player=PlayerPredictionDto & {ownership:number};
type Week={gameweek:number;players:Player[]};
it('isolates archived-FDR projection changes with identical historical candidates',()=>{
  const root=resolve(process.cwd(),'../../output');
  const neutral:Week[]=JSON.parse(readFileSync(resolve(root,'evaluation-day6/inputs.json'),'utf8'));
  const fixtures:Week[]=JSON.parse(readFileSync(resolve(root,'evaluation-day7/sensitivity-inputs.json'),'utf8'));
  const day6=JSON.parse(readFileSync(resolve(root,'evaluation-day6/decisions.json'),'utf8'));
  const results=fixtures.map((week,i)=>{
    expect(week.gameweek).toBe(neutral[i].gameweek);
    expect(week.players.map(p=>p.playerId)).toEqual(neutral[i].players.map(p=>p.playerId));
    week.players.forEach((p,j)=>{const {predictedPtsGw3:a,predictedPtsGw5:b,...rest}=p;const {predictedPtsGw3:c,predictedPtsGw5:d,...before}=neutral[i].players[j];expect(rest).toEqual(before);expect(Number.isFinite(a)&&Number.isFinite(b)).toBe(true);});
    const rank=(players:Player[])=>rankPlayersByMlPrediction(players,{weights:defaultWeights(),ownershipById:new Map(players.map(p=>[p.playerId,p.ownership]))}).map(p=>p.playerId);
    const old=rank(neutral[i].players);expect(old).toEqual(day6.weeks[i].rankings.balanced);
    return {gameweek:week.gameweek,neutral:old,fixtures:rank(week.players)};
  });
  writeFileSync(resolve(root,'evaluation-day7/sensitivity-decisions.json'),JSON.stringify(results,null,2));
});
