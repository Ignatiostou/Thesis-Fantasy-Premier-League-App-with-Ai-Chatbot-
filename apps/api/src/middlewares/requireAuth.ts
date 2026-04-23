import { verifyAccessToken } from '../utils/jwt.js';


export function requireAuth(req: any, res: any, next: any) {
  const token = req.cookies?.access_token;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const payload = verifyAccessToken(token);
    req.userId = payload.sub;
    return next();
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}