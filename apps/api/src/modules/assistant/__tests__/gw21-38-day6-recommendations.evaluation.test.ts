import { it, expect, vi } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
vi.mock('../../../db/prisma.js', () => ({ prisma: new Proxy({}, { get() { throw new Error('Database use forbidden in historical selection'); } }) }));
import { rankPlayersByMlPrediction } from '../player-ranking.service.js';
import { recommendCaptaincyFromMl } from '../ml-captaincy.service.js';
import { recommendTransfersFromMl } from '../ml-transfer-recommendation.service.js';
import { defaultWeights } from '../personalization.weights.js';
import type { PlayerPredictionDto } from '../ml-prediction.types.js';

type Player = PlayerPredictionDto & { team: number; price: number; ownership: number; form: number };
type Squad = { id: number; players: number[]; xi: number[]; bank: number };
type Week = { gameweek: number; players: Player[]; squads: Squad[] };
const directory = resolve(process.cwd(), '../../output/evaluation-recommendations-gw21-38/day6');

it('makes historical recommendations without access to outcomes and verifies feasible decisions', () => {
  const data: Week[] = JSON.parse(readFileSync(resolve(directory, 'inputs.json'), 'utf8'));
  const weeks = []; let squadChecks=0, transferChecks=0, rejectedInfeasible=0, returnedPairs=0;
  for (const week of data) {
    const players = week.players;
    expect(players.every(p => !('actual_points' in p) && !('actual_minutes' in p))).toBe(true);
    const byId = new Map(players.map(p => [p.playerId, p]));
    const ownershipById = new Map(players.map(p => [p.playerId, p.ownership]));
    const ordered = (field: 'predictedPtsGw1'|'form') => [...players].sort((a,b)=>b[field]-a[field] || a.playerId-b.playerId).map(p=>p.playerId);
    const rankings: Record<string,number[]> = { xpts: ordered('predictedPtsGw1'), form: ordered('form') };
    for (const [name,alpha] of [['cautious',1.5],['balanced',1],['aggressive',.7]] as const) rankings[name]=rankPlayersByMlPrediction(players,{weights:{...defaultWeights(),availabilityPenalty:alpha},ownershipById}).map(p=>p.playerId);
    const squads=[];
    for (const s of week.squads) {
      const squad=s.players.map(id=>byId.get(id)!); const xi=s.xi.map(id=>byId.get(id)!);
      expect(new Set(s.players).size).toBe(15); expect(xi.length).toBe(11);
      for (const [position,count] of [['GK',2],['DEF',5],['MID',5],['FWD',3]] as const) expect(squad.filter(p=>p.position===position).length).toBe(count);
      expect(squad.reduce((total,p)=>total+p.price,0)+s.bank).toBe(1000); expect(s.bank).toBeGreaterThanOrEqual(0);
      const legalClubCounts=(ps:Player[])=>[...new Set(ps.map(p=>p.team))].every(team=>ps.filter(p=>p.team===team).length<=3);
      expect(legalClubCounts(squad)).toBe(true); squadChecks++;
      const captain=recommendCaptaincyFromMl(xi).captain!;
      const best=(field:'predictedPtsGw1'|'form')=>[...xi].sort((a,b)=>b[field]-a[field]||a.playerId-b.playerId)[0].playerId;
      const captains={production:captain.playerId,xpts:best('predictedPtsGw1'),form:best('form')};
      expect(Object.values(captains).every(id=>s.xi.includes(id))).toBe(true);
      const candidates=recommendTransfersFromMl({squadPredictions:squad,candidatePool:players,maxResults:1000,ctx:{weights:defaultWeights(),ownershipById}}).candidates;
      returnedPairs+=candidates.length;
      const feasible=candidates.filter(c=>{
        const out=byId.get(c.outgoing.playerId)!;const incoming=byId.get(c.incoming.playerId)!;
        return incoming.price<=s.bank+out.price && incoming.position===out.position && !s.players.includes(incoming.playerId) && legalClubCounts([...squad.filter(p=>p.playerId!==out.playerId),incoming]);
      });
      rejectedInfeasible+=candidates.length-feasible.length;
      const transfers=[];
      for (const cost of [0,4]) for (const policy of ['production','xpts']) {
        const pool=feasible.filter(c=>c.deltaGw1>cost);
        if(policy==='xpts') pool.sort((a,b)=>b.deltaGw1-a.deltaGw1||a.incoming.playerId-b.incoming.playerId||a.outgoing.playerId-b.outgoing.playerId);
        const move=pool[0];
        if(move){expect(move.transferScore).toBeGreaterThan(0);expect(move.deltaGw1).toBeGreaterThan(cost);transferChecks++;}
        transfers.push({policy,cost,outgoing:move?.outgoing.playerId??null,incoming:move?.incoming.playerId??null,predictedGain:move?.deltaGw1??0});
      }
      squads.push({id:s.id,captains,transfers,feasiblePairs:feasible.length});
    }
    weeks.push({gameweek:week.gameweek,rankings,squads});
  }
  expect(weeks.length).toBe(18);expect(squadChecks).toBe(360);
  const files=['player-ranking.service.ts','ml-captaincy.service.ts','ml-transfer-recommendation.service.ts','personalization.weights.ts'];
  const hashes=Object.fromEntries(files.map(f=>[f,createHash('sha256').update(readFileSync(resolve(process.cwd(),'src/modules/assistant',f))).digest('hex')]));
  writeFileSync(resolve(directory,'decisions.json'),JSON.stringify({weeks,verification:{squadChecks,transferChecks,returnedPairs,rejectedInfeasible},hashes,inputHash:createHash('sha256').update(readFileSync(resolve(directory,'inputs.json'))).digest('hex')},null,2));
},180000);
