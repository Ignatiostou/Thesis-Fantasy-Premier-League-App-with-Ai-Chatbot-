import { describe, it, expect, vi, beforeEach } from 'vitest';


vi.mock('../../../db/prisma.js', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      create:     vi.fn(),
    },
    session: {
      create:      vi.fn(),
      deleteMany:  vi.fn(),
    },
  },
}));


vi.mock('bcryptjs', () => ({
  default: {
    hash:    vi.fn(async (pw: string) => `hashed_${pw}`),
    compare: vi.fn(async (plain: string, hashed: string) => hashed === `hashed_${plain}`),
  },
}));


vi.mock('../../../utils/jwt.js', () => ({
  signAccessToken:  vi.fn(() => 'mock_access_token'),
  signRefreshToken: vi.fn(() => 'mock_refresh_token'),
}));

import { prisma } from '../../../db/prisma.js';
import { register, login, logout, me } from '../auth.service.js';

const mockPrisma = prisma as any;



const mockReq = {
  headers: { 'user-agent': 'test-agent' },
  ip: '127.0.0.1',
};

const mockUser = {
  id:           'user_abc',
  email:        'test@example.com',
  username:     'testuser',
  passwordHash: 'hashed_Password123!',
};



describe('register', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a new user and returns tokens', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null); // no existing user
    mockPrisma.user.create.mockResolvedValue({ id: 'new_id', email: 'test@example.com', username: 'newuser' });
    mockPrisma.session.create.mockResolvedValue({});

    const result = await register('test@example.com', 'newuser', 'Password123!', mockReq);

    expect(result.user.email).toBe('test@example.com');
    expect(result.access).toBe('mock_access_token');
    expect(result.refresh).toBe('mock_refresh_token');
    expect(mockPrisma.user.create).toHaveBeenCalledOnce();
    expect(mockPrisma.session.create).toHaveBeenCalledOnce();
  });

  it('throws EMAIL_EXISTS when email is already taken', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'existing' }); // email found

    await expect(register('taken@example.com', 'newuser', 'Password123!', mockReq))
      .rejects.toThrow('EMAIL_EXISTS');

    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it('throws USERNAME_EXISTS when username is already taken', async () => {
    mockPrisma.user.findUnique
      .mockResolvedValueOnce(null)               // email check passes
      .mockResolvedValueOnce({ id: 'existing' }); // username check fails

    await expect(register('new@example.com', 'takenuser', 'Password123!', mockReq))
      .rejects.toThrow('USERNAME_EXISTS');

    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it('stores hashed password not plain text', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.user.create.mockResolvedValue({ id: 'new_id', email: 'test@example.com', username: 'newuser' });
    mockPrisma.session.create.mockResolvedValue({});

    await register('test@example.com', 'newuser', 'PlainPassword', mockReq);

    const createCall = mockPrisma.user.create.mock.calls[0][0];
    expect(createCall.data.passwordHash).toBe('hashed_PlainPassword');
    expect(createCall.data.passwordHash).not.toBe('PlainPassword');
  });

  it('creates a session with the correct refresh token', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.user.create.mockResolvedValue({ id: 'user_1', email: 'a@b.com', username: 'u' });
    mockPrisma.session.create.mockResolvedValue({});

    await register('a@b.com', 'u', 'pw', mockReq);

    const sessionCall = mockPrisma.session.create.mock.calls[0][0];
    expect(sessionCall.data.refreshToken).toBe('mock_refresh_token');
    expect(sessionCall.data.userId).toBe('user_1');
  });
});


describe('login', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns tokens for valid credentials', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(mockUser);
    mockPrisma.session.create.mockResolvedValue({});

    const result = await login('test@example.com', 'Password123!', mockReq);

    expect(result.access).toBe('mock_access_token');
    expect(result.refresh).toBe('mock_refresh_token');
    expect(result.user.id).toBe('user_abc');
  });

  it('throws INVALID for non-existent email', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    await expect(login('nobody@example.com', 'Password123!', mockReq))
      .rejects.toThrow('INVALID');
  });

  it('throws INVALID for wrong password', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(mockUser);

    await expect(login('test@example.com', 'WrongPassword', mockReq))
      .rejects.toThrow('INVALID');
  });

  it('does not expose passwordHash in the response', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(mockUser);
    mockPrisma.session.create.mockResolvedValue({});

    const result = await login('test@example.com', 'Password123!', mockReq);

    expect((result.user as any).passwordHash).toBeUndefined();
  });

  it('creates a session on successful login', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(mockUser);
    mockPrisma.session.create.mockResolvedValue({});

    await login('test@example.com', 'Password123!', mockReq);

    expect(mockPrisma.session.create).toHaveBeenCalledOnce();
    const call = mockPrisma.session.create.mock.calls[0][0];
    expect(call.data.userId).toBe('user_abc');
  });
});


describe('logout', () => {

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.session.deleteMany.mockResolvedValue({ count: 1 });
  });

  it('deletes the session matching the refresh token', async () => {
    await logout('some_refresh_token');

    expect(mockPrisma.session.deleteMany).toHaveBeenCalledWith({
      where: { refreshToken: 'some_refresh_token' },
    });
  });

  it('does nothing when no refresh token is provided', async () => {
    await logout(undefined);
    expect(mockPrisma.session.deleteMany).not.toHaveBeenCalled();
  });
});


describe('me', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns user data for a valid userId', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id:        'user_abc',
      email:     'test@example.com',
      username:  'testuser',
      createdAt: new Date(),
    });

    const result = await me('user_abc');
    expect(result?.id).toBe('user_abc');
    expect(result?.email).toBe('test@example.com');
  });

  it('returns null for a non-existent userId', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    const result = await me('nonexistent');
    expect(result).toBeNull();
  });

  it('queries only safe fields (no passwordHash)', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u', email: 'e', username: 'n', createdAt: new Date() });
    await me('user_abc');

    const call = mockPrisma.user.findUnique.mock.calls[0][0];
    expect(call.select).toBeDefined();
    expect(call.select.passwordHash).toBeUndefined();
  });
});