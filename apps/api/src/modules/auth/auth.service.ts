import bcrypt from "bcryptjs";
import { prisma } from "../../db/prisma.js";
import { signAccessToken, signRefreshToken } from "../../utils/jwt.js";

export async function register(email: string, username: string, password: string, req: any) {
  const existingEmail = await prisma.user.findUnique({ where: { email } });
  if (existingEmail) throw new Error("EMAIL_EXISTS");

  const existingUsername = await prisma.user.findUnique({ where: { username } });
  if (existingUsername) throw new Error("USERNAME_EXISTS");

  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.create({
    data: { email, username, passwordHash },
    select: { id: true, email: true, username: true },
  });

  const access = signAccessToken(user.id);
  const refresh = signRefreshToken(user.id);

  await prisma.session.create({
    data: {
      userId: user.id,
      refreshToken: refresh,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      userAgent: req.headers["user-agent"] ?? null,
      ip: req.ip,
    },
  });

  return { user, access, refresh };
}

export async function login(email: string, password: string, req: any) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error("INVALID");

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throw new Error("INVALID");

  const access = signAccessToken(user.id);
  const refresh = signRefreshToken(user.id);

  await prisma.session.create({
    data: {
      userId: user.id,
      refreshToken: refresh,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      userAgent: req.headers["user-agent"] ?? null,
      ip: req.ip,
    },
  });

  return { user: { id: user.id, email: user.email, username: user.username }, access, refresh };
}

export async function logout(refreshToken?: string) {
  if (refreshToken) await prisma.session.deleteMany({ where: { refreshToken } });
}

export async function me(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, username: true, createdAt: true },
  });
}