import { Request, Response } from 'express';
import { z } from 'zod';
import * as service from './team.service.js';

const initSchema = z.object({
  playerIds: z.array(z.number().int()).length(15),
  name: z.string().min(2).max(30).optional(),
});

const lineupSchema = z.object({
  captain: z.number().int(),
  viceCaptain: z.number().int(),
  benchOrder: z.array(z.number().int()).length(4),
});

export async function me(req: any, res: Response) {
  try {
    const data = await service.getMyTeam(req.userId);
    return res.json(data);
  } catch (e: any) {
    return res.status(500).json({
      error: e.message ?? 'Failed to load team',
    });
  }
}

export async function initialize(req: any, res: Response) {
  const parsed = initSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  try {
    const result = await service.initializeSquad(
      req.userId,
      parsed.data.playerIds,
      parsed.data.name,
    );

    return res.status(201).json(result);
  } catch (e: any) {
    if (e.message === 'TEAM_ALREADY_EXISTS') {
      return res.status(409).json({ error: 'Team already initialized' });
    }

    if (e.message?.startsWith('INVALID_')) {
      return res.status(400).json({ error: e.message });
    }

    if (e.message === 'BUDGET_EXCEEDED') {
      return res.status(400).json({ error: e.message });
    }

    if (e.message === 'CLUB_LIMIT_EXCEEDED') {
      return res.status(400).json({ error: e.message });
    }

    return res.status(500).json({
      error: e.message ?? 'Initialize failed',
    });
  }
}

export async function updateLineup(req: any, res: Response) {
  const parsed = lineupSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: parsed.error.flatten(),
    });
  }

  try {
    const result = await service.updateLineup(
      req.userId,
      parsed.data.captain,
      parsed.data.viceCaptain,
      parsed.data.benchOrder,
    );

    return res.json(result);
  } catch (e: any) {
    return res.status(400).json({
      error: e.message ?? 'Failed to save lineup',
    });
  }
}