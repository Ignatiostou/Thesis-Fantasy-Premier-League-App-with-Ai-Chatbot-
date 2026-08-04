import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
} from '../jwt.js';

describe('JWT utils', () => {
  beforeEach(() => {
    process.env.JWT_ACCESS_SECRET =
      'test_access_secret_32_chars_long!!';

    process.env.JWT_REFRESH_SECRET =
      'test_refresh_secret_32_chars_long!';
  });

  afterEach(() => {
    delete process.env.JWT_ACCESS_SECRET;
    delete process.env.JWT_REFRESH_SECRET;
  });

  it('signAccessToken returns a JWT string', () => {
    const token = signAccessToken('user_1');

    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3);
  });

  it('signRefreshToken returns a JWT string', () => {
    const token = signRefreshToken('user_1');

    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3);
  });

  it('verifyAccessToken returns correct sub (userId)', () => {
    const token = signAccessToken('user_abc');

    const payload = verifyAccessToken(token);

    expect(payload.sub).toBe('user_abc');
  });

  it('access and refresh tokens differ for same userId', () => {
    const access = signAccessToken('user_1');
    const refresh = signRefreshToken('user_1');

    expect(access).not.toBe(refresh);
  });

  it('verifyAccessToken throws for invalid token', () => {
    expect(() =>
      verifyAccessToken('invalid.token.string'),
    ).toThrow();
  });

  it('verifyAccessToken throws for token signed with wrong secret', () => {
    process.env.JWT_ACCESS_SECRET =
      'signing_secret_here_32chars_long!';

    const token = signAccessToken('user_1');

    process.env.JWT_ACCESS_SECRET =
      'different_secret_32chars_long_!!';

    expect(() => verifyAccessToken(token)).toThrow();
  });

  it('refresh token has longer expiry than access token', () => {
    const accessToken = signAccessToken('user_1');
    const refreshToken = signRefreshToken('user_1');

    const decode = (t: string) =>
      JSON.parse(
        Buffer.from(t.split('.')[1], 'base64url').toString(),
      );

    const accessPayload = decode(accessToken);
    const refreshPayload = decode(refreshToken);

    expect(
      refreshPayload.exp - refreshPayload.iat,
    ).toBeGreaterThan(
      accessPayload.exp - accessPayload.iat,
    );
  });
});