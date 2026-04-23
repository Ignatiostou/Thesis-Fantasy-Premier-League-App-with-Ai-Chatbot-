import type {Request,Response} from 'express';
import {syncPlayerGameweekStats} from './points-sync.service.js';

export async function syncCurrentGwStats(req: Request, res: Response) {
  try {
    const gwRaw = req.body?.gameweek;
    const gw = 
    typeof gwRaw === 'number' && Number.isFinite(gwRaw)
    ? gwRaw : undefined;

    const result = await syncPlayerGameweekStats(gw);
    return res.json(result);
  } catch (e: any) {
    return res.status(500).json({ error: e.message ?? 'Failed to sync player gameweek stats' });
  }
}