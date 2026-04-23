// apps/api/src/modules/ai/ai.memory.service.ts

import { prisma } from '../../db/prisma.js';

const MAX_HISTORY = 20;

export async function getOrCreateSession(userId: string, sessionId?: string) {
  if (sessionId) {
    const existing = await prisma.assistantSession.findFirst({
      where: { id: sessionId, userId },
    });
    if (existing) return existing;
  }

  return prisma.assistantSession.create({
    data: {
      userId,
      title: 'FPL Coaching Session',
      status: 'ACTIVE',
    },
  });
}

export async function getUserSessions(userId: string) {
  return prisma.assistantSession.findMany({
    where: { userId, status: 'ACTIVE' },
    orderBy: { updatedAt: 'desc' },
    take: 10,
    select: {
      id: true,
      title: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { content: true, createdAt: true },
      },
    },
  });
}

export async function getSessionMessages(userId: string, sessionId: string) {
  const session = await prisma.assistantSession.findFirst({
    where: { id: sessionId, userId },
  });
  if (!session) throw new Error('SESSION_NOT_FOUND');

  return prisma.assistantMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      role: true,
      content: true,
      createdAt: true,
    },
  });
}

export async function archiveSession(userId: string, sessionId: string) {
  const session = await prisma.assistantSession.findFirst({
    where: { id: sessionId, userId },
  });
  if (!session) throw new Error('SESSION_NOT_FOUND');

  return prisma.assistantSession.update({
    where: { id: sessionId },
    data: { status: 'ARCHIVED' },
  });
}

export async function saveUserMessage(sessionId: string, content: string) {
  return prisma.assistantMessage.create({
    data: {
      sessionId,
      role: 'USER',
      content,
    },
  });
}

export async function saveAssistantMessage(sessionId: string, content: string) {
  const saved = await prisma.assistantMessage.create({
    data: {
      sessionId,
      role: 'ASSISTANT',
      content,
    },
  });

  await prisma.assistantSession.update({
    where: { id: sessionId },
    data: { updatedAt: new Date() },
  });

  return saved;
}

export async function getRecentHistory(sessionId: string) {
  const history = await prisma.assistantMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'asc' },
    take: MAX_HISTORY,
    select: { role: true, content: true },
  });

  return history;
}