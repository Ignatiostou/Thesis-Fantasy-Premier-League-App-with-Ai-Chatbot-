import type { Request, Response } from "express";
import {
  calculateAllTeamsForGameweek,
  calculateMyCurrentGameweekScore,
  getMyGameweekScore,
  getMyPointsHistory,
} from "./points.service.js";
import { syncPlayerGameweekStats } from "./points-sync.service.js";
import { getMyLivePointsSnapshot } from "./points-live.service.js";

type AuthRequest = Request & { userId?: string };

function ok<T>(res: Response, data: T) {
  return res.json({ success: true, data });
}

function fail(res: Response, status: number, error: string) {
  return res.status(status).json({ success: false, error });
}

export async function myCurrent(req: AuthRequest, res: Response) {
  try {
    if (!req.userId) return fail(res, 401, "Unauthorized");

    const result = await calculateMyCurrentGameweekScore(req.userId);
    return ok(res, result);
  } catch (e: any) {
    return fail(res, 400, e.message ?? "Failed to calculate current score");
  }
}

export async function myLive(req: AuthRequest, res: Response) {
  try {
    if (!req.userId) return fail(res, 401, "Unauthorized");

    const result = await getMyLivePointsSnapshot(req.userId);
    return ok(res, result);
  } catch (e: any) {
    return fail(res, 400, e.message ?? "Failed to get live points snapshot");
  }
}

export async function myByGameweek(req: AuthRequest, res: Response) {
  try {
    if (!req.userId) return fail(res, 401, "Unauthorized");

    const gw = Number(req.params.gameweek);
    if (!Number.isFinite(gw)) {
      return fail(res, 400, "INVALID_GAMEWEEK");
    }

    const result = await getMyGameweekScore(req.userId, gw);
    return ok(res, result);
  } catch (e: any) {
    return fail(res, 400, e.message ?? "Failed to get score");
  }
}

export async function myHistory(req: AuthRequest, res: Response) {
  try {
    if (!req.userId) return fail(res, 401, "Unauthorized");

    const result = await getMyPointsHistory(req.userId);
    return ok(res, result);
  } catch (e: any) {
    return fail(res, 400, e.message ?? "Failed to get points history");
  }
}

export async function recalculateAll(req: Request, res: Response) {
  try {
    const gwRaw = req.body?.gameweek;
    const gw =
      typeof gwRaw === "number" && Number.isFinite(gwRaw)
        ? gwRaw
        : undefined;

    const result = await calculateAllTeamsForGameweek(gw);
    return ok(res, result);
  } catch (e: any) {
    return fail(res, 400, e.message ?? "Failed to recalculate all scores");
  }
}

export async function syncGwStats(req: Request, res: Response) {
  try {
    const gwRaw = req.body?.gameweek;
    const gw =
      typeof gwRaw === "number" && Number.isFinite(gwRaw)
        ? gwRaw
        : undefined;

    const result = await syncPlayerGameweekStats(gw);
    return ok(res, result);
  } catch (e: any) {
    return fail(res, 400, e.message ?? "Failed to sync gameweek stats");
  }
}