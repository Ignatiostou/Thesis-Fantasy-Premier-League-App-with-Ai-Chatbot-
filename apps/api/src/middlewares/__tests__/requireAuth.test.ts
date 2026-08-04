import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vitest';

import { requireAuth } from '../requireAuth.js';
import { signAccessToken } from '../../utils/jwt.js';

function mockReq(cookie?: string) {
  return {
    cookies: cookie
      ? { access_token: cookie }
      : {},
  } as any;
}

function mockRes() {
  const res: any = {};

  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);

  return res;
}

describe('requireAuth middleware', () => {
  beforeEach(() => {
    process.env.JWT_ACCESS_SECRET =
      'test_access_secret_32_chars_long!!';
  });

  afterEach(() => {
    delete process.env.JWT_ACCESS_SECRET;
  });

  it('returns 401 when no access_token cookie present', () => {
    const next = vi.fn();
    const res = mockRes();

    requireAuth(mockReq(), res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 for invalid token', () => {
    const next = vi.fn();
    const res = mockRes();

    requireAuth(
      mockReq('invalid.token.here'),
      res,
      next,
    );

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() and sets req.userId for valid token', () => {
    const token = signAccessToken('user_abc');

    const next = vi.fn();
    const res = mockRes();
    const req = mockReq(token);

    requireAuth(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.userId).toBe('user_abc');
  });

  it('returns 401 when token signed with wrong secret', () => {
    process.env.JWT_ACCESS_SECRET =
      'wrong_secret_only_for_signing_here!';

    const token = signAccessToken('user_1');

    process.env.JWT_ACCESS_SECRET =
      'different_secret_for_verification!!';

    const next = vi.fn();
    const res = mockRes();

    requireAuth(mockReq(token), res, next);

    expect(res.status).toHaveBeenCalledWith(401);
  });
});