import { Request, Response }                       from 'express';
import jwt                                         from 'jsonwebtoken';
import { prisma }                                  from '../../db/prisma.js';
import { signAccessToken, signRefreshToken }       from '../../utils/jwt.js';
import { setAuthCookies }                          from '../../utils/cookies.js';
 
export async function refresh(req: Request, res: Response) {
  const token = req.cookies?.refresh_token as string | undefined;
 
  if (!token) {
    return res.status(401).json({ error: 'No refresh token' });
  }
 
  // 1. Verify signature
  let payload: any;
  try {
    payload = jwt.verify(token, process.env.JWT_REFRESH_SECRET!);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired refresh token' });
  }
 
  // 2. Check it exists in DB (prevents replay of old tokens)
  const session = await prisma.session.findUnique({
    where: { refreshToken: token },
  });
 
  if (!session || new Date() > session.expiresAt) {
    // Token reuse detected or expired — clear cookies and reject
    res.clearCookie('access_token',  { path: '/' });
    res.clearCookie('refresh_token', { path: '/' });
    return res.status(401).json({ error: 'Session expired — please log in again' });
  }
 
  const userId = payload.sub as string;
 
  // 3. Rotate — delete old session, create new one
  const newAccess  = signAccessToken(userId);
  const newRefresh = signRefreshToken(userId);
 
  await prisma.$transaction([
    prisma.session.delete({ where: { id: session.id } }),
    prisma.session.create({
      data: {
        userId,
        refreshToken: newRefresh,
        expiresAt:    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        userAgent:    req.headers['user-agent'] ?? null,
        ip:           req.ip ?? null,
      },
    }),
  ]);
 
  // 4. Set new cookies
  setAuthCookies(res, newAccess, newRefresh);
 
  return res.json({ ok: true });
}