import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChipType } from '@fpl/types';

vi.mock('../../../db/prisma.js', () => ({
  prisma: {
    userTeam: { findUnique: vi.fn() },
    userGameweekState: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    userChip: { findFirst: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
    userPick: { count: vi.fn().mockResolvedValue(15), findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]), createMany: vi.fn() },
    $transaction: vi.fn(async (cb: any) => {
      const tx = {
        userGameweekState: { update: vi.fn().mockResolvedValue({}) },
        userChip: { create: vi.fn().mockResolvedValue({}), deleteMany: vi.fn().mockResolvedValue({}) },
      };
      return cb(tx);
    }),
  },
}));

vi.mock('../../../utils/gameweek.js', () => ({
  getEditableGameweekId: vi.fn().mockResolvedValue(34),
  ensureSquadExistsForGameweek: vi.fn().mockResolvedValue(undefined),
}));

import { prisma } from '../../../db/prisma.js';
import { playChip, clearChip } from '../chips.service.js';

const mock = prisma as any;

const TEAM = { id: 'team_1', userId: 'user_1' };
const GW_STATE_NO_CHIP = { userTeamId: 'team_1', gameweek: 34, freeTransfers: 1, transfersMade: 0, pointsHit: 0, activeChip: null };
const GW_STATE_WITH_CHIP = { ...GW_STATE_NO_CHIP, activeChip: ChipType.BENCH_BOOST };

describe('playChip', () => {

  beforeEach(() => {
    vi.clearAllMocks();
    mock.userTeam.findUnique.mockResolvedValue(TEAM);
    mock.userGameweekState.findUnique.mockResolvedValue(GW_STATE_NO_CHIP);
    mock.userGameweekState.create.mockResolvedValue(GW_STATE_NO_CHIP);
    mock.userChip.findFirst.mockResolvedValue(null); // not used
  });

  it('throws NO_TEAM when user has no team', async () => {
    mock.userTeam.findUnique.mockResolvedValue(null);
    await expect(playChip('user_1', ChipType.BENCH_BOOST)).rejects.toThrow('NO_TEAM');
  });

  it('throws CHIP_ALREADY_ACTIVE when a chip is already active', async () => {
    mock.userGameweekState.findUnique.mockResolvedValue(GW_STATE_WITH_CHIP);
    await expect(playChip('user_1', ChipType.TRIPLE_CAPTAIN)).rejects.toThrow('CHIP_ALREADY_ACTIVE');
  });

  it('throws CHIP_ALREADY_USED when bench boost already used', async () => {
    mock.userChip.findFirst.mockResolvedValue({ id: 'chip_1', chip: ChipType.BENCH_BOOST, gameweek: 20 });
    await expect(playChip('user_1', ChipType.BENCH_BOOST)).rejects.toThrow('CHIP_ALREADY_USED');
  });

  it('throws CHIP_ALREADY_USED when free hit already used', async () => {
    mock.userChip.findFirst.mockResolvedValue({ id: 'chip_1', chip: ChipType.FREE_HIT, gameweek: 15 });
    await expect(playChip('user_1', ChipType.FREE_HIT)).rejects.toThrow('CHIP_ALREADY_USED');
  });

  it('throws WILDCARD_NOT_AVAILABLE when wildcard already used in same half', async () => {
    // GW34 is second half — wildcard used in GW22 means second-half wildcard gone
    mock.userChip.findFirst.mockResolvedValue({ id: 'chip_1', chip: ChipType.WILDCARD, gameweek: 22 });
    await expect(playChip('user_1', ChipType.WILDCARD)).rejects.toThrow('WILDCARD_NOT_AVAILABLE');
  });

  it('allows wildcard in first half when second-half wildcard was used', async () => {
    // GW10 is first half — second-half wildcard use shouldn't block
    const { getEditableGameweekId } = await import('../../../utils/gameweek.js');
    vi.mocked(getEditableGameweekId).mockResolvedValueOnce(10);
    mock.userChip.findFirst.mockResolvedValue(null); // no first-half wildcard used
    // Should NOT throw
    await expect(playChip('user_1', ChipType.WILDCARD)).resolves.toMatchObject({ success: true });
  });

  it('returns success and chip name on valid activation', async () => {
    const result = await playChip('user_1', ChipType.BENCH_BOOST);
    expect(result.success).toBe(true);
    expect(result.chip).toBe(ChipType.BENCH_BOOST);
    expect(result.gameweek).toBe(34);
  });
});

describe('clearChip', () => {

  beforeEach(() => {
    vi.clearAllMocks();
    mock.userTeam.findUnique.mockResolvedValue(TEAM);
    mock.userGameweekState.findUnique.mockResolvedValue(GW_STATE_WITH_CHIP);
    mock.userGameweekState.create.mockResolvedValue(GW_STATE_WITH_CHIP);
  });

  it('throws NO_TEAM when user has no team', async () => {
    mock.userTeam.findUnique.mockResolvedValue(null);
    await expect(clearChip('user_1')).rejects.toThrow('NO_TEAM');
  });

  it('returns success without DB update when no chip is active', async () => {
    mock.userGameweekState.findUnique.mockResolvedValue(GW_STATE_NO_CHIP);
    const result = await clearChip('user_1');
    expect(result.success).toBe(true);
    expect(mock.$transaction).not.toHaveBeenCalled();
  });

  it('clears the active chip via transaction', async () => {
    const result = await clearChip('user_1');
    expect(result.success).toBe(true);
    expect(mock.$transaction).toHaveBeenCalledOnce();
  });
});