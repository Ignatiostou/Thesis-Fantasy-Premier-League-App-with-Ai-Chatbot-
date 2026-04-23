import type { Request, Response } from 'express';
import { ChipType } from '@fpl/types';
import * as service from './chips.service.js';

type AuthRequest = Request & { userId?: string };

export async function getStatus(req: AuthRequest, res: Response) {
  try {
    if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });

    const result = await service.getChipsStatus(req.userId);

    return res.json({
      success: true,
      data: {
        activeChip: result.activeChip,
        gameweek: result.gameweek,
        played: result.chips.filter((c) => !c.available),
        available: {
          WILDCARD:
            result.chips.find((c) => c.chip === ChipType.WILDCARD)?.available ?? true,
          BENCH_BOOST:
            result.chips.find((c) => c.chip === ChipType.BENCH_BOOST)?.available ?? true,
          TRIPLE_CAPTAIN:
            result.chips.find((c) => c.chip === ChipType.TRIPLE_CAPTAIN)?.available ?? true,
          FREE_HIT:
            result.chips.find((c) => c.chip === ChipType.FREE_HIT)?.available ?? true,
        },
      },
    });
  } catch (err: any) {
    return res.status(500).json({
      error: err.message ?? 'Failed to get chips status',
    });
  }
}

export async function activate(req: AuthRequest, res: Response) {
  try {
    if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });

    const { chip } = req.body;

    if (!chip) {
      return res.status(400).json({ error: 'CHIP_REQUIRED' });
    }

    const result = await service.playChip(req.userId, chip as ChipType);

    return res.json({
      success: true,
      data: result,
    });
  } catch (err: any) {
    return res.status(400).json({
      error: err.message ?? 'Failed to activate chip',
    });
  }
}

export async function cancel(req: AuthRequest, res: Response) {
  try {
    if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });

    const result = await service.clearChip(req.userId);

    return res.json({
      success: true,
      data: result,
    });
  } catch (err: any) {
    return res.status(400).json({
      error: err.message ?? 'Failed to clear chip',
    });
  }
}