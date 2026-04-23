import { Router } from 'express';
import { requireAuth } from '../../middlewares/requireAuth.js';
import { checkDeadline } from '../../middlewares/checkDeadline.js';
import * as controller from './team.controller.js';

export const teamRouter = Router();

teamRouter.get('/me', requireAuth, controller.me);
teamRouter.post('/initialize', requireAuth, controller.initialize);
teamRouter.put('/lineup', requireAuth, checkDeadline, controller.updateLineup);