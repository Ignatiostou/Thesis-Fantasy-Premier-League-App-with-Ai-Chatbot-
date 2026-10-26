import { it, expect, vi } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const mocks=vi.hoisted(()=>({summary:vi.fn()}));
vi.mock('../../../db/prisma.js',()=>({prisma:{userAssistantProfile:{findUnique:vi.fn().mockResolvedValue(null)},fplPlayer:{findMany:vi.fn().mockResolvedValue([])},fplTeam:{findMany:vi.fn().mockResolvedValue([])}}}));
vi.mock('../ml-prediction.service.js',()=>({buildSquadPredictionSummary:mocks.summary,getPredictionLookupForGameweek:vi.fn(),getPredictionsForGameweek:vi.fn()}));
vi.mock('../team-strength.service.js',()=>({buildTeamStrengthIndex:vi.fn().mockResolvedValue(new Map()),buildNextFixtureLookup:vi.fn().mockResolvedValue(new Map()),teamStrengthMultiplier:vi.fn(),explainTeamStrength:vi.fn()}));
vi.mock('../player-eligibility.service.js',()=>({buildEligibilitySnapshots:vi.fn().mockResolvedValue(new Map()),filterEligible:(p:unknown[])=>p}));
import { buildMlRecommendationBlock } from '../ml-recommendation-engine.service.js';
it('documents CHIP_ADVICE receiving generic ranked context rather than a chip schedule',async()=>{
 const directory=resolve(process.cwd(),'../../output/evaluation-day9');const data=JSON.parse(readFileSync(resolve(directory,'inputs.json'),'utf8'));
 const players=data.initial[0].players.map((id:number)=>data.weeks[0].players.find((p:any)=>p.playerId===id));
 mocks.summary.mockResolvedValue({gameweek:21,players,modelVersion:'evaluation',mlCoverage:100});
 const result=await buildMlRecommendationBlock({userId:'eval',intent:'CHIP_ADVICE',squadPlayerIds:players.map((p:any)=>p.playerId),gameweek:21});
 expect(result.available).toBe(true);expect(result.promptBlock).toContain('General ML squad context');
 expect(Object.keys(result.structured as object)).toEqual(['ranked']);
 writeFileSync(resolve(directory,'chip-context.json'),JSON.stringify(result,null,2));
});
