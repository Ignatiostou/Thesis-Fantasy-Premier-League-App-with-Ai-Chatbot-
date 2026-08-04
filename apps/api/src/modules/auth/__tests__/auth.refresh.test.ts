import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vitest';

vi.mock('../../../db/prisma.js', () => ({
  prisma: {
    session: {
      findUnique: vi.fn(),
      delete: vi.fn(),
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('../../../utils/cookies.js', () => ({
  setAuthCookies: vi.fn(),
}));

import { prisma } from '../../../db/prisma.js';
import { setAuthCookies } from '../../../utils/cookies.js';

import { refresh } from '../auth.refresh.js';

import { signRefreshToken } from '../../../utils/jwt.js';

const mock = prisma as any;

function mockReq(cookie?: string) {
  return {
    cookies: cookie
      ? { refresh_token: cookie }
      : {},
    headers: { 'user-agent': 'test' },
    ip: '127.0.0.1',
  } as any;
}

function mockRes() {
  const res: any = {};

  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.clearCookie = vi.fn().mockReturnValue(res);

  return res;
}

describe('auth.refresh handler', () => {
  beforeEach(() => {
    process.env.JWT_REFRESH_SECRET =
      'test_refresh_secret_32_chars_long!';

    process.env.JWT_ACCESS_SECRET =
      'test_access_secret_32_chars_long!!';

    vi.clearAllMocks();

    mock.$transaction.mockImplementation(
      async (ops: any[]) => Promise.all(ops),
    );

    mock.session.delete.mockResolvedValue({});
    mock.session.create.mockResolvedValue({});
  });

  afterEach(() => {
    delete process.env.JWT_REFRESH_SECRET;
    delete process.env.JWT_ACCESS_SECRET;
  });

  it('returns 401 when no refresh_token cookie present', async () => {
    const res = mockRes();

    await refresh(mockReq(), res);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 401 for invalid token', async () => {
    const res = mockRes();

    await refresh(
      mockReq('invalid.token'),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 401 when valid token not found in DB', async () => {
    const token = signRefreshToken('user_1');

    mock.session.findUnique.mockResolvedValue(null);

    const res = mockRes();

    await refresh(mockReq(token), res);

    expect(res.status).toHaveBeenCalledWith(401);

    expect(res.clearCookie).toHaveBeenCalled();
  });

  it('returns 401 when session is expired', async () => {
    const token = signRefreshToken('user_1');

    mock.session.findUnique.mockResolvedValue({
      id: 'sess_1',
      userId: 'user_1',
      refreshToken: token,
      expiresAt: new Date(Date.now() - 1000),
    });

    const res = mockRes();

    await refresh(mockReq(token), res);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rotates tokens and returns ok:true for valid session', async () => {
    const token = signRefreshToken('user_1');

    mock.session.findUnique.mockResolvedValue({
      id: 'sess_1',
      userId: 'user_1',
      refreshToken: token,
      expiresAt: new Date(
        Date.now() + 7 * 24 * 60 * 60 * 1000,
      ),
    });

    const res = mockRes();

    await refresh(mockReq(token), res);

    expect(setAuthCookies).toHaveBeenCalledOnce();

    expect(res.json).toHaveBeenCalledWith({
      ok: true,
    });
  });

  it('runs session rotation inside transaction', async () => {
    const token = signRefreshToken('user_1');

    mock.session.findUnique.mockResolvedValue({
      id: 'sess_old',
      userId: 'user_1',
      refreshToken: token,
      expiresAt: new Date(Date.now() + 86400000),
    });

    const res = mockRes();

    await refresh(mockReq(token), res);

    expect(mock.$transaction).toHaveBeenCalledOnce();
  });
});