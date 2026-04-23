import { Router } from 'express';
import { requireAuth } from '../../middlewares/requireAuth.js';
import { checkDeadline } from '../../middlewares/checkDeadline.js';
import * as controller from './transfers.controller.js';

export const transfersRouter = Router();

transfersRouter.get('/state', requireAuth, controller.state);
transfersRouter.post('/preview', requireAuth, controller.preview);
transfersRouter.post('/commit', requireAuth, checkDeadline, controller.commit);
transfersRouter.get('/history', requireAuth, controller.history);