import type { Request, Response, NextFunction } from "express";
import { prisma } from "../db/prisma.js";
import { getEditableGameweekId } from "../utils/gameweek.js";

export async function checkDeadline(_req: Request, res: Response, next: NextFunction) {
  try {
    const editableGw = await getEditableGameweekId();

    const event = await prisma.fplEvent.findUnique({
      where: { id: editableGw },
      select: {
        id: true,
        deadlineTime: true,
      },
    });

    if (!event?.deadlineTime) {
      return next();
    }

    const deadlinePassed = new Date(event.deadlineTime).getTime() <= Date.now();

    if (deadlinePassed) {
      return res.status(400).json({
        success: false,
        error: "DEADLINE_PASSED",
      });
    }

    return next();
  } catch (e: any) {
    return res.status(500).json({
      success: false,
      error: e.message ?? "Failed to validate deadline",
    });
  }
}