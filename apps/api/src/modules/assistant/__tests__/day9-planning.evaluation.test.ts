import { it, expect, vi } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import ts from 'typescript';
vi.mock('../../../db/prisma.js', () => ({ prisma: new Proxy({}, { get() { throw new Error('Live database forbidden'); } }) }));
import { recommendTransfersFromMl } from '../ml-transfer-recommendation.service.js';
import { deriveScoringWeights } from '../personalization.weights.js';
import { buildMlSquadAdvice } from '../ml-squad-advisor.service.js';
import { calculateSingleTeamScore, type PickWithRelations } from '../../points/scoring.helpers.js';
import type { PlayerPredictionDto } from '../ml-prediction.types.js';

type Player=PlayerPredictionDto & {team:number;price:number;ownership:number;form:number;eligibleIncoming:boolean};
type Week={gameweek:number;players:Player[]};
const dir=resolve(process.cwd(),'../../output/evaluation-day9');
const profile={riskTolerance:2,budgetStyle:2,preferredFocus:2,differentialPreference:2,planningHorizon:2,explanationDepth:2,topSixAffinity:2,captaincyStyle:2,transferFrequency:2,fixtureAwareness:2};
const positions={GK:1,DEF:2,MID:3,FWD:4,UNK:0};
// Extract the actual pure price helper without importing the database service.
const source=readFileSync(resolve(process.cwd(),'src/modules/transfers/transfers.service.ts'),'utf8');
const ast=ts.createSourceFile('transfers.ts',source,ts.ScriptTarget.Latest,true);
const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='getSellPriceFplProfitHalf')!;
const sell=new Function(ts.transpileModule(fn.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText+';return getSellPriceFplProfitHalf;')() as (buy:number,now:number)=>number;
const legalClubs=(ps:Player[])=>[...new Set(ps.map(p=>p.team))].every(t=>ps.filter(p=>p.team===t).length<=3);
function lineup(ps:Player[]) {
 const by=(pos:string)=>ps.filter(p=>p.position===pos).sort((a,b)=>b.predictedPtsGw1-a.predictedPtsGw1||a.playerId-b.playerId);
 let best:Player[]=[];let value=-Infinity;
 for(let def=3;def<=5;def++) for(let mid=2;mid<=5;mid++) { const fwd=10-def-mid;if(fwd<1||fwd>3)continue;
  const xi=[...by('GK').slice(0,1),...by('DEF').slice(0,def),...by('MID').slice(0,mid),...by('FWD').slice(0,fwd)];
  if(xi.length!==11)continue;const v=xi.reduce((s,p)=>s+p.predictedPtsGw1,0);if(v>value){best=xi;value=v;}
 }
 const ranked=[...best].sort((a,b)=>b.predictedPtsGw1-a.predictedPtsGw1||a.playerId-b.playerId);
 const bench=ps.filter(p=>!best.includes(p)).sort((a,b)=>Number(a.position==='GK')-Number(b.position==='GK')||b.predictedPtsGw1-a.predictedPtsGw1||a.playerId-b.playerId);
 return {xi:best.map(p=>p.playerId),captain:ranked[0].playerId,vice:ranked[1].playerId,bench:bench.map(p=>p.playerId)};
}

it('replays persistent squads using deadline-only forecasts and purchase-price accounting',()=>{
 const input: {weeks:Week[];initial:{id:number;players:number[];bank:number}[]}=JSON.parse(readFileSync(resolve(dir,'inputs.json'),'utf8'));
 const records:any[]=[];let transferCount=0;
 const policies=['app_short','app_balanced','app_long','xpts_global','form_global','hold'];
 for(const initial of input.initial)for(const policy of policies){
  let ids=[...initial.players],bank=initial.bank,ft=1;const buys=new Map(ids.map(id=>[id,input.weeks[0].players.find(p=>p.playerId===id)!.price]));
  for(const week of input.weeks){
   expect(week.players.every(p=>!('actual_points' in p)&&!('actual_minutes' in p))).toBe(true);
   const map=new Map(week.players.map(p=>[p.playerId,p]));expect(ids.every(id=>map.has(id))).toBe(true);
   const startBank=bank,startIds=[...ids],startFt=ft;const moves:any[]=[];const boughtThisWeek=new Set<number>();
   const weights=deriveScoringWeights({...profile,planningHorizon:policy==='app_short'?1:policy==='app_long'?3:2});
   const ownershipById=new Map(week.players.map(p=>[p.playerId,p.ownership]));
   for(let step=0;step<2&&policy!=='hold';step++){
    const squad=ids.map(id=>map.get(id)!);const incoming=week.players.filter(p=>p.eligibleIncoming&&!ids.includes(p.playerId));const cost=step<ft?0:4;
    let pairs:{outgoing:Player;incoming:Player;gain:number;score:number}[]=[];
    if(policy.startsWith('app_'))pairs=recommendTransfersFromMl({squadPredictions:squad,candidatePool:incoming,maxResults:10000,ctx:{weights,ownershipById}}).candidates.map(c=>({outgoing:map.get(c.outgoing.playerId)!,incoming:map.get(c.incoming.playerId)!,gain:c.deltaGw1,score:c.transferScore}));
    else for(const out of squad)for(const inc of incoming)if(out.position===inc.position){const gain=policy==='form_global'?inc.form-out.form:inc.predictedPtsGw1-out.predictedPtsGw1;pairs.push({outgoing:out,incoming:inc,gain,score:gain});}
    pairs=pairs.filter(c=>!boughtThisWeek.has(c.outgoing.playerId)&&c.gain>cost&&c.incoming.price<=bank+sell(buys.get(c.outgoing.playerId)!,c.outgoing.price)&&legalClubs([...squad.filter(p=>p.playerId!==c.outgoing.playerId),c.incoming]));
    if(!policy.startsWith('app_'))pairs.sort((a,b)=>b.score-a.score||a.incoming.playerId-b.incoming.playerId||a.outgoing.playerId-b.outgoing.playerId);
    const move=pairs[0];if(!move)break;
    const sellPrice=sell(buys.get(move.outgoing.playerId)!,move.outgoing.price);const buyPrice=move.incoming.price;
    bank+=sellPrice-buyPrice;ids=ids.map(id=>id===move.outgoing.playerId?move.incoming.playerId:id);buys.delete(move.outgoing.playerId);buys.set(move.incoming.playerId,buyPrice);boughtThisWeek.add(move.incoming.playerId);
    moves.push({outgoing:move.outgoing.playerId,incoming:move.incoming.playerId,sellPrice,buyPrice,cost,forecastGain:move.gain});transferCount++;
   }
   const ps=ids.map(id=>map.get(id)!);expect(bank).toBeGreaterThanOrEqual(0);expect(new Set(ids).size).toBe(15);expect(legalClubs(ps)).toBe(true);
   for(const [pos,n] of [['GK',2],['DEF',5],['MID',5],['FWD',3]] as const)expect(ps.filter(p=>p.position===pos).length).toBe(n);
   const selection=lineup(ps);expect(selection.xi.length).toBe(11);
   records.push({case:initial.id,policy,gameweek:week.gameweek,startIds,startBank,startFt,players:[...ids],bank,moves,buys:Object.fromEntries(buys),...selection});
   ft=Math.min(Math.max(ft-moves.length,0)+1,2);
  }
 }
 expect(records.length).toBe(2160);
 const files=['src/modules/assistant/ml-transfer-recommendation.service.ts','src/modules/assistant/personalization.weights.ts','src/modules/transfers/transfers.service.ts','src/modules/points/scoring.helpers.ts'];
 writeFileSync(resolve(dir,'decisions.json'),JSON.stringify({records,transferCount,hashes:Object.fromEntries(files.map(f=>[f,createHash('sha256').update(readFileSync(resolve(process.cwd(),f))).digest('hex')]))}));
},120000);

it('scores saved decisions with actual production autosubs, captain fallback and chip arithmetic',()=>{
 const {records}=JSON.parse(readFileSync(resolve(dir,'decisions.json'),'utf8'));
 const {weeks}:{weeks:Week[]}=JSON.parse(readFileSync(resolve(dir,'inputs.json'),'utf8'));
 const outcomes:{gameweek:number;playerId:number;minutes:number;totalPoints:number}[]=JSON.parse(readFileSync(resolve(dir,'outcomes.json'),'utf8'));
 const result:any[]=[];
 for(const record of records){
  const week=weeks.find(w=>w.gameweek===record.gameweek)!;const map=new Map(week.players.map(p=>[p.playerId,p]));
  const stats=new Map(outcomes.filter(r=>r.gameweek===record.gameweek).map(r=>[r.playerId,r]));expect(record.players.every((id:number)=>stats.has(id))).toBe(true);
  const picks:PickWithRelations[]=record.players.map((id:number)=>{const p=map.get(id)!;return {id:String(id),userTeamId:'eval',playerId:id,teamId:p.team,gameweek:record.gameweek,position:positions[p.position],isCaptain:id===record.captain,isViceCaptain:id===record.vice,isOnBench:!record.xi.includes(id),benchOrder:record.bench.includes(id)?record.bench.indexOf(id)+1:null,buyPrice:record.buys[id],player:{id,webName:p.webName,position:positions[p.position],teamId:p.team,eventPoints:null,totalPoints:null,team:{id:p.team,name:String(p.team),shortName:String(p.team)}}};});
  const state={userTeamId:'eval',gameweek:record.gameweek,freeTransfers:record.startFt,transfersMade:record.moves.length,pointsHit:record.moves.reduce((s:number,m:any)=>s+m.cost,0),activeChip:null};
  const base=calculateSingleTeamScore(picks,state,stats);
  const tc=calculateSingleTeamScore(picks,{...state,activeChip:'TRIPLE_CAPTAIN'},stats);const bb=calculateSingleTeamScore(picks,{...state,activeChip:'BENCH_BOOST'},stats);
  expect(base.finalPoints).toBe(base.pointsBeforeHits-state.pointsHit);
  expect(tc.finalPoints-base.finalPoints).toBe(base.captainPlayerId===null?0:stats.get(base.captainPlayerId)!.totalPoints);
  result.push({case:record.case,policy:record.policy,gameweek:record.gameweek,points:base.finalPoints,gross:base.pointsBeforeHits,hits:state.pointsHit,transfers:record.moves.length,bank:record.bank,autoSubs:base.autoSubsApplied.length,tcIncrement:tc.finalPoints-base.finalPoints,bbIncrement:bb.finalPoints-base.finalPoints});
 }
 writeFileSync(resolve(dir,'scored.json'),JSON.stringify(result));expect(result.length).toBe(2160);
},120000);

it('documents profit-half selling and unconstrained ML lineup limitations',()=>{
 expect([sell(50,55),sell(50,54),sell(50,49)]).toEqual([52,52,49]);
 const {weeks}:{weeks:Week[]}=JSON.parse(readFileSync(resolve(dir,'inputs.json'),'utf8'));
 const base=weeks[0].players[0];const squad:Player[]=[];
 for(const [pos,n,value] of [['GK',2,2],['DEF',5,1],['MID',5,8],['FWD',3,9]] as const)for(let i=0;i<n;i++)squad.push({...base,playerId:squad.length+1,position:pos,predictedPtsGw1:value,predictedPtsGw3:value*3,predictedPtsGw5:value*4.75,probPlaying:.99,confidence:'HIGH'});
 const advice=buildMlSquadAdvice(squad);const defenders=advice.optimalStarters.filter(p=>p.position==='DEF').length;
 expect(defenders).toBe(2); // Characterisation, not a desirable formation.
 writeFileSync(resolve(dir,'controlled.json'),JSON.stringify({sellingExamples:[52,52,49],unconstrainedMlAdviceDefenders:defenders,legalMinimum:3},null,2));
});
