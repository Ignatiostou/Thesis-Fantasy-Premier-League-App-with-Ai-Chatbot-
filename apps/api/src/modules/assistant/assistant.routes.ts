// apps/api/src/modules/ai/ai.routes.ts

import { Router } from 'express';
import { requireAuth } from '../../middlewares/requireAuth.js';
import * as controller from './assistant.controller.js';

export const aiRouter = Router();

// Onboarding
aiRouter.get('/onboarding/questions', controller.getOnboardingQuestions);
aiRouter.get('/onboarding/status', requireAuth, controller.getOnboardingStatus);
aiRouter.post('/onboarding/step', requireAuth, controller.saveOnboardingStep);
aiRouter.post('/onboarding/complete', requireAuth, controller.completeOnboarding);

// Sessions
aiRouter.get('/sessions', requireAuth, controller.getSessions);
aiRouter.get('/sessions/:sessionId/messages', requireAuth, controller.getSessionMessages);
aiRouter.post('/sessions/:sessionId/archive', requireAuth, controller.archiveSession);

// Chat
aiRouter.post('/chat', requireAuth, controller.chat);
aiRouter.post('/chat/stream', requireAuth, controller.chatStream);

// Debug
aiRouter.get('/context', requireAuth, controller.getContext);