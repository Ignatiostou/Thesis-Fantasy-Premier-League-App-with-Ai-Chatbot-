import jwt from 'jsonwebtoken';

export function signAccessToken(userId: string) {
  return jwt.sign({ sub: userId }, process.env.JWT_ACCESS_SECRET!, { expiresIn: '15m' });
}

export function signRefreshToken(userId: string) {
  return jwt.sign({ sub: userId }, process.env.JWT_REFRESH_SECRET!, { expiresIn: '30d' });
}

export function verifyAccessToken(token: string) {
  return jwt.verify(token, process.env.JWT_ACCESS_SECRET!) as any;
}