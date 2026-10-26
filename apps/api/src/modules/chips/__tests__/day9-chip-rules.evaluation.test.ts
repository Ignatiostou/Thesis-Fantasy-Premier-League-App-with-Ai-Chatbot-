import { it, expect, vi, beforeEach } from 'vitest';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ChipType } from '@fpl/types';
vi.mock('../../../db/prisma.js',()=>({prisma:{userTeam:{findUnique:vi.fn()},userGameweekState:{findUnique:vi.fn(),findFirst:vi.fn(),create:vi.fn()},userChip:{findFirst:vi.fn()}}}));
vi.mock('../../../utils/gameweek.js',()=>({getEditableGameweekId:vi.fn().mockResolvedValue(21),ensureSquadExistsForGameweek:vi.fn()}));
import { prisma } from '../../../db/prisma.js';
import { getChipsStatus } from '../chips.service.js';
const db=prisma as any;
beforeEach(()=>{
 vi.clearAllMocks();db.userTeam.findUnique.mockResolvedValue({id:'eval'});
 db.userGameweekState.findUnique.mockResolvedValue({activeChip:null});
 db.userChip.findFirst.mockImplementation(async({where}:any)=>where.gameweek?.gte?null:{chip:where.chip,gameweek:10});
});
it('documents second-half non-Wildcard chips blocked by first-half use',async()=>{
 const r=await getChipsStatus('eval');
 expect(r.chips.find(c=>c.chip===ChipType.WILDCARD)?.available).toBe(true);
 for(const chip of [ChipType.BENCH_BOOST,ChipType.TRIPLE_CAPTAIN,ChipType.FREE_HIT])expect(r.chips.find(c=>c.chip===chip)?.available).toBe(false);
 writeFileSync(resolve(process.cwd(),'../../output/evaluation-day9/chip-availability.json'),JSON.stringify(r,null,2));
});
it('documents the two-transfer rollover cap',async()=>{
 db.userGameweekState.findUnique.mockResolvedValue(null);
 db.userGameweekState.findFirst.mockResolvedValue({freeTransfers:2,transfersMade:0});
 db.userGameweekState.create.mockImplementation(async({data}:any)=>data);
 await getChipsStatus('eval');expect(db.userGameweekState.create.mock.calls[0][0].data.freeTransfers).toBe(2);
});
