import type { Request, Response, NextFunction } from 'express';

type AuthRequest = Request & { userId?: string };

interface Bucket {
  count:        number;
  windowStart:  number;
}

const WINDOW_MS    = 60 * 1000; // 1 minute
const MAX_REQUESTS  = 8;        // max chat requests per user per window

const buckets = new Map<string, Bucket>();

// Periodically clear stale buckets so this Map doesn't grow unbounded for a
// long-running process with many distinct users.
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStart > WINDOW_MS * 2) buckets.delete(key);
  }
}, 5 * 60 * 1000);

export function chatRateLimit(req: AuthRequest, res: Response, next: NextFunction) {
  const userId = req.userId;
  if (!userId) {
    // requireAuth should already have rejected this; fail closed just in case.
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  const now = Date.now();
  const bucket = buckets.get(userId);

  if (!bucket || now - bucket.windowStart > WINDOW_MS) {
    buckets.set(userId, { count: 1, windowStart: now });
    return next();
  }

  if (bucket.count >= MAX_REQUESTS) {
    const retryAfterSec = Math.ceil((bucket.windowStart + WINDOW_MS - now) / 1000);
    res.setHeader('Retry-After', String(retryAfterSec));
    return res.status(429).json({
      success: false,
      error: `Too many chat requests. Please wait ${retryAfterSec}s before trying again.`,
    });
  }

  bucket.count += 1;
  return next();
}
