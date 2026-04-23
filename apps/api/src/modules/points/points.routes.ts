import { Router } from "express";
import { requireAuth } from "../../middlewares/requireAuth.js";
import * as controller from "./points.controller.js";

export const pointsRouter = Router();

pointsRouter.get("/me/current", requireAuth, controller.myCurrent);
pointsRouter.get("/me/live", requireAuth, controller.myLive);
pointsRouter.get("/me/history", requireAuth, controller.myHistory);
pointsRouter.get("/me/gameweek/:gameweek", requireAuth, controller.myByGameweek);

pointsRouter.post("/recalculate", controller.recalculateAll);
pointsRouter.post("/sync-gw-stats", controller.syncGwStats);