import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../db/prisma.js', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    userTeam: {
      findUnique: vi.fn(),
    },
    userAssistantProfile: {         // ← was missing
      findUnique: vi.fn(),
    },
    userPick: {
      findMany: vi.fn(),
    },
    userGameweekState: {
      findUnique: vi.fn(),
      findFirst:  vi.fn(),
      create:     vi.fn(),
    },
    userGameweekScore: {
      findMany: vi.fn(),
    },
    fplFixture: {
      findMany: vi.fn(),
    },
    userChip: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock('../../../utils/gameweek.js', () => ({
  getEditableGameweekId:           vi.fn().mockResolvedValue(34),
  getLiveGameweekId:               vi.fn().mockResolvedValue(33),
  ensureUserTeamPicksForGameweek:  vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../onboarding.service.js', () => ({
  buildProfileSummary: vi.fn().mockReturnValue('Risk profile: balanced\nBudget style: balanced budget'),
}));

import { prisma } from '../../../db/prisma.js';
import { buildUserContext, formatContextForPrompt } from '../context.service.js';

const mock = prisma as any;

const mockProfile = {
  riskTolerance:          2,
  budgetStyle:            2,
  preferredFocus:         2,
  differentialPreference: 2,
  planningHorizon:        2,
  explanationDepth:       2,
  notes:                  null,
  onboardingCompleted:    true,
};

const mockUser = {
  id:       'user_1',
  username: 'testmanager',
};

const mockTeam = {
  id:         'team_1',
  name:       'Test FC',
  budget:     20,
};

const mockGwState = {
  freeTransfers: 1,
  transfersMade: 0,
  pointsHit:     0,
  activeChip:    null,
};

// ── buildUserContext ──────────────────────────────────────────────────────────

describe('buildUserContext', () => {

  beforeEach(() => {
    vi.clearAllMocks();
    mock.user.findUnique.mockResolvedValue(mockUser);
    mock.userTeam.findUnique.mockResolvedValue(mockTeam);
    mock.userAssistantProfile.findUnique.mockResolvedValue(mockProfile);
    mock.userGameweekState.findUnique.mockResolvedValue(mockGwState);
    mock.userGameweekState.findFirst.mockResolvedValue(null);
    mock.userGameweekState.create.mockResolvedValue(mockGwState);
    mock.userPick.findMany.mockResolvedValue([]);
    mock.userGameweekScore.findMany.mockResolvedValue([]);
    mock.fplFixture.findMany.mockResolvedValue([]);
    mock.userChip.findMany.mockResolvedValue([]);
  });

  it('returns username from user record', async () => {
    const ctx = await buildUserContext('user_1');
    expect(ctx.username).toBe('testmanager');
  });

  it('returns the editable gameweek', async () => {
    const ctx = await buildUserContext('user_1');
    expect(ctx.gameweek).toBe(34);
  });

  it('returns hasTeam=true when user has a team', async () => {
    const ctx = await buildUserContext('user_1');
    expect(ctx.hasTeam).toBe(true);
  });

  it('returns hasTeam=false when user has no team', async () => {
    mock.userTeam.findUnique.mockResolvedValue(null);
    const ctx = await buildUserContext('user_1');
    expect(ctx.hasTeam).toBe(false);
  });

  it('returns freeTransfers from gw state', async () => {
    const ctx = await buildUserContext('user_1');
    expect(ctx.freeTransfers).toBe(1);
  });

  it('returns null freeTransfers when no team exists', async () => {
    mock.userTeam.findUnique.mockResolvedValue(null);
    const ctx = await buildUserContext('user_1');
    expect(ctx.freeTransfers).toBeNull();
  });

  it('includes profileSummary when profile exists', async () => {
    const ctx = await buildUserContext('user_1');
    expect(ctx.profileSummary).toBeTruthy();
    expect(typeof ctx.profileSummary).toBe('string');
  });

  it('returns null profileSummary when no profile', async () => {
    mock.userAssistantProfile.findUnique.mockResolvedValue(null);
    const ctx = await buildUserContext('user_1');
    expect(ctx.profileSummary).toBeNull();
  });

  it('includes squad array', async () => {
    const ctx = await buildUserContext('user_1');
    expect(Array.isArray(ctx.squad)).toBe(true);
  });

  it('does not throw when user is not found', async () => {
    mock.user.findUnique.mockResolvedValue(null);
    mock.userTeam.findUnique.mockResolvedValue(null);
    mock.userAssistantProfile.findUnique.mockResolvedValue(null);
    await expect(buildUserContext('nonexistent')).resolves.not.toThrow();
  });
});

// ── formatContextForPrompt ────────────────────────────────────────────────────

describe('formatContextForPrompt', () => {

  const baseCtx = {
    username:         'testmanager',
    gameweek:         34,
    liveGameweek:     33,
    hasTeam:          true,
    teamName:         'Test FC',
    budgetLeft:       '£2.0m',
    freeTransfers:    1,
    activeChip:       null,
    profileSummary:   'Risk profile: balanced\nExplanation preference: medium detail explanations',
    squad:            [],
    recentScores:     [],
    upcomingFixtures: [],
    teamStats:        [],
  };

  it('returns a non-empty string', () => {
    expect(formatContextForPrompt(baseCtx).length).toBeGreaterThan(0);
  });

  it('includes the manager username', () => {
    expect(formatContextForPrompt(baseCtx)).toContain('testmanager');
  });

  it('includes the gameweek number', () => {
    expect(formatContextForPrompt(baseCtx)).toContain('34');
  });

  it('includes budget when team exists', () => {
    expect(formatContextForPrompt(baseCtx)).toContain('£2.0m');
  });

  it('includes free transfers when available', () => {
    expect(formatContextForPrompt(baseCtx)).toContain('1');
  });

  it('includes profile summary content', () => {
    expect(formatContextForPrompt(baseCtx)).toContain('Risk profile');
  });

  it('handles no team gracefully without crashing', () => {
    const ctx = { ...baseCtx, hasTeam: false, teamName: null, budgetLeft: null, freeTransfers: null };
    expect(() => formatContextForPrompt(ctx)).not.toThrow();
  });

  it('handles null profileSummary gracefully', () => {
    expect(() => formatContextForPrompt({ ...baseCtx, profileSummary: null })).not.toThrow();
  });

  it('produces different output for different contexts', () => {
    const a = formatContextForPrompt({ ...baseCtx, username: 'manager1' });
    const b = formatContextForPrompt({ ...baseCtx, username: 'manager2' });
    expect(a).not.toBe(b);
  });
});