import type { Request, Response } from 'express';
import {
  commitTransfers,
  getTransfersHistory,
  getTransfersState,
  previewTransfers,
} from './transfers.service.js';
import type { ActiveTransferChip, TransferPair } from './transfers.dto.js';

type AuthedRequest = Request & { userId?: string };

export async function state(req: AuthedRequest, res: Response) {
  try {
    if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });
    const result = await getTransfersState(req.userId);
    return res.json(result);
  } catch (e: any) {
    return res.status(500).json({ error: e.message ?? 'Failed to load transfers state' });
  }
}

export async function preview(req: AuthedRequest, res: Response) {
  try {
    if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });

    const transfers = (req.body?.transfers ?? []) as TransferPair[];
    const activeChip = (req.body?.activeChip ?? null) as ActiveTransferChip;

    const result = await previewTransfers(req.userId, transfers, activeChip);

    if (!result.ok) return res.status(400).json(result);
    return res.json(result);
  } catch (e: any) {
    return res.status(500).json({ error: e.message ?? 'Failed to preview transfers' });
  }
}

export async function commit(req: AuthedRequest, res: Response) {
  try {
    if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });

    const transfers = (req.body?.transfers ?? []) as TransferPair[];
    const activeChip = (req.body?.activeChip ?? null) as ActiveTransferChip;

    const result = await commitTransfers(req.userId, transfers, activeChip);

    if ('ok' in result && result.ok === false) {
      return res.status(400).json(result);
    }

    return res.json(result);
  } catch (e: any) {
    return res.status(500).json({ error: e.message ?? 'Failed to commit transfers' });
  }
}

export async function history(req: AuthedRequest, res: Response) {
  try {
    if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });

    const gwRaw = req.query?.gw;
    const gw = typeof gwRaw === 'string' ? Number(gwRaw) : undefined;

    const result = await getTransfersHistory(
      req.userId,
      Number.isFinite(gw) ? gw : undefined,
    );

    return res.json(result);
  } catch (e: any) {
    return res.status(500).json({ error: e.message ?? 'Failed to load transfer history' });
  }
}