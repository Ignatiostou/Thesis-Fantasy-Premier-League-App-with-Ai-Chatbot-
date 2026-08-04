import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';

vi.mock('../auth.service.js', () => ({
  register: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  me: vi.fn(),
}));

vi.mock('../../../utils/cookies.js', () => ({
  setAuthCookies: vi.fn(),
  clearAuthCookies: vi.fn(),
}));

vi.mock('../../../middlewares/requireAuth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = 'user-1';
    next();
  },
}));

import { authRouter } from '../auth.routes.js';
import * as authService from '../auth.service.js';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/auth', authRouter);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /auth/register', () => {
  it('returns 200 with user on valid input', async () => {
    vi.mocked(authService.register).mockResolvedValue({
      user: { id: 'user-1', email: 'test@example.com', username: 'testuser' },
      access: 'access',
      refresh: 'refresh',
    } as any);

    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'test@example.com', username: 'testuser', password: 'password123' });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('user-1');
    expect(res.body.email).toBe('test@example.com');
  });

  it('returns 400 when email is invalid', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'not-an-email', username: 'user', password: 'password123' });

    expect(res.status).toBe(400);
    expect(authService.register).not.toHaveBeenCalled();
  });

  it('returns 400 when username is too short', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'test@example.com', username: 'ab', password: 'password123' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when password is too short', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'test@example.com', username: 'testuser', password: 'short' });

    expect(res.status).toBe(400);
  });

  it('returns 409 when email is already taken', async () => {
    vi.mocked(authService.register).mockRejectedValue(new Error('EMAIL_EXISTS'));

    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'taken@example.com', username: 'newuser', password: 'password123' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Email already in use');
  });

  it('returns 409 when username is already taken', async () => {
    vi.mocked(authService.register).mockRejectedValue(new Error('USERNAME_EXISTS'));

    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'new@example.com', username: 'takenuser', password: 'password123' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Username already in use');
  });
});

describe('POST /auth/login', () => {
  it('returns 200 with user on valid credentials', async () => {
    vi.mocked(authService.login).mockResolvedValue({
      user: { id: 'user-1', email: 'test@example.com', username: 'testuser' },
      access: 'access',
      refresh: 'refresh',
    } as any);

    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'test@example.com', password: 'password123' });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('user-1');
  });

  it('returns 400 when body is missing fields', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'test@example.com' });

    expect(res.status).toBe(400);
    expect(authService.login).not.toHaveBeenCalled();
  });

  it('returns 401 on wrong credentials', async () => {
    vi.mocked(authService.login).mockRejectedValue(new Error('INVALID'));

    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'test@example.com', password: 'wrongpass' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid credentials');
  });
});

describe('POST /auth/logout', () => {
  it('returns 200 and calls logout', async () => {
    vi.mocked(authService.logout).mockResolvedValue(undefined);

    const res = await request(app).post('/auth/logout');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(authService.logout).toHaveBeenCalledOnce();
  });
});

describe('GET /auth/me', () => {
  it('returns 200 with user data when authenticated', async () => {
    vi.mocked(authService.me).mockResolvedValue({
      id: 'user-1',
      email: 'test@example.com',
      username: 'testuser',
      createdAt: new Date(),
    } as any);

    const res = await request(app).get('/auth/me');

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('user-1');
    expect(authService.me).toHaveBeenCalledWith('user-1');
  });

  it('returns 404 when user is not found', async () => {
    vi.mocked(authService.me).mockResolvedValue(null);

    const res = await request(app).get('/auth/me');

    expect(res.status).toBe(404);
  });
});