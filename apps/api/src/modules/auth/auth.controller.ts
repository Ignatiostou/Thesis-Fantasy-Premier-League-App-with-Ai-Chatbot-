import { Request, Response } from 'express';
import { z } from 'zod';
import * as service from './auth.service.js';
import { setAuthCookies, clearAuthCookies } from '../../utils/cookies.js';

// ─────────────────────────────────────────────────────────────
// Validation Schemas
// ─────────────────────────────────────────────────────────────

const registerSchema = z.object({
  email: z.string().email(),
  username: z.string().min(3).max(20),
  password: z.string().min(8),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

// ─────────────────────────────────────────────────────────────
// REGISTER
// POST /auth/register
// ─────────────────────────────────────────────────────────────

export async function register(req: any, res: any) {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    const { user, access, refresh } = await service.register(
      parsed.data.email,
      parsed.data.username,
      parsed.data.password,
      req
    );
    setAuthCookies(res, access, refresh);
    return res.json({ id: user.id, email: user.email, username: user.username });
  } catch (e: any) {
    if (e.message === "EMAIL_EXISTS") return res.status(409).json({ error: "Email already in use" });
    if (e.message === "USERNAME_EXISTS") return res.status(409).json({ error: "Username already in use" });
    console.error("[auth.register]", e);
    return res.status(400).json({ error: "Registration failed" });
  }
}

// ─────────────────────────────────────────────────────────────
// LOGIN
// POST /auth/login
// ─────────────────────────────────────────────────────────────

export async function login(req: Request, res: Response) {
  const parsed = loginSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: parsed.error.flatten(),
    });
  }

  const { email, password } = parsed.data;

  try {
    const { user, access, refresh } = await service.login(
      email,
      password,
      req
    );

    setAuthCookies(res, access, refresh);

    return res.json({
      id: user.id,
      email: user.email,
      username: user.username,
    });
  } catch (e: any) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
}

// ─────────────────────────────────────────────────────────────
// LOGOUT
// POST /auth/logout
// ─────────────────────────────────────────────────────────────

export async function logout(req: Request, res: Response) {
  const refresh = req.cookies?.refresh_token as string | undefined;

  await service.logout(refresh);

  clearAuthCookies(res);

  return res.json({ ok: true });
}

// ─────────────────────────────────────────────────────────────
// ME
// GET /auth/me
// ─────────────────────────────────────────────────────────────

export async function me(req: any, res: Response) {
  try {
    const user = await service.me(req.userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json(user);
  } catch (e) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}