import { Router } from 'express';
import {
  getTeams,
  getEvents,
  getCurrentEvent,
  getNextDeadline,
  getPlayers,
  getFixtures,
} from './fpl.controller.js';

export const fplRouter = Router();


fplRouter.get('/teams',          getTeams);
fplRouter.get('/events/current', getCurrentEvent);
fplRouter.get('/events',         getEvents);
fplRouter.get('/deadline/next',  getNextDeadline);
fplRouter.get('/players',        getPlayers);
fplRouter.get('/fixtures',       getFixtures);
