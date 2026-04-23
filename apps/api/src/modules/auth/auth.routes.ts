import { Router } from 'express';
import * as controller from './auth.controller.js';
import { requireAuth } from '../../middlewares/requireAuth.js';
import {refresh} from './auth.refresh.js';

export const authRouter = Router();

authRouter.post('/register', controller.register);
authRouter.post('/login', controller.login);
authRouter.post('/refresh', refresh);
authRouter.post('/logout', controller.logout);
authRouter.get('/me', requireAuth, controller.me);