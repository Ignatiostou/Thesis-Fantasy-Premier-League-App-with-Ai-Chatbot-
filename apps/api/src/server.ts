import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';

import { authRouter }           from './modules/auth/auth.routes.js';
import { fplRouter }            from './modules/fpl/fpl.routes.js';
import { teamRouter }           from './modules/team/team.routes.js';
import { startFplSyncScheduler } from './jobs/Fpl-sync.sheduler.js';
import { startScoringScheduler } from './jobs/scoring.scheduler.js';
import { startMlPipelineScheduler } from './jobs/ml-pipeline.scheduler.js';
import { transfersRouter }      from './modules/transfers/transfers.router.js';
import { chipsRouter }          from './modules/chips/chips.routes.js';
import { pointsRouter }          from './modules/points/points.routes.js';
import { leaguesRouter }         from './modules/leagues/leagues.routes.js';
import { aiRouter }              from './modules/assistant/assistant.routes.js';

const app = express();

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(cors({ origin: ['http://localhost:3000'], credentials: true }));

// ── Routes ────────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true }));
app.use('/auth',   authRouter);
app.use('/fpl',    fplRouter);
app.use('/team',   teamRouter);
app.use('/transfers', transfersRouter);
app.use('/chips',  chipsRouter);
app.use('/points', pointsRouter);
app.use('/leagues', leaguesRouter);
app.use('/ai',      aiRouter);
// ── Start ─────────────────────────────────────────────────────────────────────
const port = Number(process.env.PORT ?? 4001);
app.listen(port, () => {
  console.log(`[api] http://localhost:${port}`);

  // Smart scheduler: 15 min normally, 3 min on match days, 60 min overnight.
  // Replaces the old node-cron every-6-hours job.
  startFplSyncScheduler();
  startScoringScheduler();

  // ML pipeline: every 15 min, checks for a newly completed (data_checked)
  // gameweek → imports results, retrains the model, predicts the next GW.
  startMlPipelineScheduler();
});
