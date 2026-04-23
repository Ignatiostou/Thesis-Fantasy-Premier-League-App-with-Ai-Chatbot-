import {Router} from 'express';
import {requireAuth} from '../../middlewares/requireAuth.js';
import * as controller from './leagues.controller.js';

export const leaguesRouter = Router();

leaguesRouter.get('/mine', requireAuth, controller.getMyLeagues);          
leaguesRouter.post('/', requireAuth, controller.createLeague);          
leaguesRouter.post('/join', requireAuth, controller.joinLeague);        
leaguesRouter.post('/:leagueId/leave', requireAuth, controller.leaveLeague);
leaguesRouter.get('/:leagueId', requireAuth, controller.getLeagueDetails);    
leaguesRouter.get('/:leagueId/standings', requireAuth, controller.getLeagueStandings);
//leaguesRouter.get('/:leagueId/h2h-fixtures', requireAuth, controller.getH2HFixtures);
//leaguesRouter.delete('/:leagueId', requireAuth, controller.deleteLeague);
