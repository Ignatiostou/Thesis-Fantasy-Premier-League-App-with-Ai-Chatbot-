import { Router } from 'express';
import { requireAuth } from '../../middlewares/requireAuth.js';
import * as controller from './chips.controller.js';
import { checkDeadline } from '../../middlewares/checkDeadline.js';

export const chipsRouter = Router();

chipsRouter.get('/status', requireAuth, controller.getStatus);
chipsRouter.post('/play', requireAuth, checkDeadline, controller.activate);
chipsRouter.post('/cancel', requireAuth, controller.cancel);