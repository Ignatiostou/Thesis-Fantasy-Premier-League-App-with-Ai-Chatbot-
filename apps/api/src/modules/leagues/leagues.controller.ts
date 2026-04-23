import type { Request, Response } from 'express';
import {
  createLeague as createLeagueService,
  getLeagueDetails as getLeagueDetailsService,
  getLeagueStandings as getLeagueStandingsService,
  getMyLeagues as getMyLeaguesService,
  joinLeague as joinLeagueService,
  leaveLeague as leaveLeagueService,
} from './leagues.service.js';

type AuthRequest = Request & { userId?: string };

export async function getMyLeagues(req: AuthRequest, res: Response) {
  try {
    if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });

    const result = await getMyLeaguesService(req.userId);
    return res.json(result);
  } catch (e: any) {
    return res.status(400).json({ error: e.message ?? 'Failed to load leagues' });
  }
}

export async function createLeague(req: AuthRequest, res: Response) {
  try {
    if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });

    const name = String(req.body?.name ?? '');
    const result = await createLeagueService(req.userId, name);
    return res.json(result);
  } catch (e: any) {
    return res.status(400).json({ error: e.message ?? 'Failed to create league' });
  }
}

export async function joinLeague(req: AuthRequest, res: Response) {
  try {
    if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });

    const code = String(req.body?.code ?? '');
    const result = await joinLeagueService(req.userId, code);
    return res.json(result);
  } catch (e: any) {
    return res.status(400).json({ error: e.message ?? 'Failed to join league' });
  }
}

export async function leaveLeague(req: AuthRequest, res: Response) {
  try {
    if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });

    const leagueId = String(req.params.leagueId);
    const result = await leaveLeagueService(req.userId, leagueId);
    return res.json(result);
  } catch (e: any) {
    return res.status(400).json({ error: e.message ?? 'Failed to leave league' });
  }
}

export async function getLeagueDetails(req: AuthRequest, res: Response) {
  try {
    if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });

    const leagueId = String(req.params.leagueId);
    const result = await getLeagueDetailsService(req.userId, leagueId);
    return res.json(result);
  } catch (e: any) {
    return res.status(400).json({ error: e.message ?? 'Failed to load league details' });
  }
}

export async function getLeagueStandings(req: AuthRequest, res: Response) {
  try {
    if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });

    const leagueId = String(req.params.leagueId);
    const result = await getLeagueStandingsService(req.userId, leagueId);
    return res.json(result);
  } catch (e: any) {
    return res.status(400).json({ error: e.message ?? 'Failed to load standings' });
  }
}