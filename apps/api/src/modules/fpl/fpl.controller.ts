import { Request, Response } from 'express';
import * as fplService from './fpl.service.js';

// ── Response helpers ──────────────────────────────────────────────────────────

function ok<T>(res: Response, data: T) {
  return res.json({ success: true, data });
}

function fail(res: Response, status: number, error: string) {
  return res.status(status).json({ success: false, error });
}

// ── Controllers ───────────────────────────────────────────────────────────────

/**
 * GET /fpl/teams
 */
export async function getTeams(_req: Request, res: Response) {
  try {
    const teams = await fplService.getAllTeams();
    return ok(res, teams);
  } catch (err) {
    console.error('[GET /fpl/teams]', err);
    return fail(res, 500, 'Failed to fetch teams');
  }
}

/**
 * GET /fpl/events
 */
export async function getEvents(_req: Request, res: Response) {
  try {
    const events = await fplService.getAllEvents();
    return ok(res, events);
  } catch (err) {
    console.error('[GET /fpl/events]', err);
    return fail(res, 500, 'Failed to fetch events');
  }
}

/**
 * GET /fpl/events/current
 */
export async function getCurrentEvent(_req: Request, res: Response) {
  try {
    const event = await fplService.getCurrentEvent();
    return ok(res, event);
  } catch (err: any) {
    const status = err?.statusCode ?? 500;
    const message = status === 404 ? err.message : 'Failed to fetch current event';
    console.error('[GET /fpl/events/current]', err);
    return fail(res, status, message);
  }
}

/**
 * GET /fpl/deadline/next
 */
export async function getNextDeadline(_req: Request, res: Response) {
  try {
    const result = await fplService.getNextEditableDeadline();
    return ok(res, result);
  } catch (err: any) {
    const status = err?.statusCode ?? 500;
    const message = status === 404 ? err.message : 'Failed to fetch next deadline';
    console.error('[GET /fpl/deadline/next]', err);
    return fail(res, status, message);
  }
}

/**
 * GET /fpl/players
 */
export async function getPlayers(req: Request, res: Response) {
  try {
    const result = await fplService.getPlayers({
      teamId: req.query.teamId ? Number(req.query.teamId) : undefined,
      position: req.query.position ? Number(req.query.position) : undefined,
      q: (req.query.q as string | undefined)?.trim(),
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      sortBy: (req.query.sortBy as string | undefined)?.trim(),
    });
    return ok(res, result);
  } catch (err) {
    console.error('[GET /fpl/players]', err);
    return fail(res, 500, 'Failed to fetch players');
  }
}

/**
 * GET /fpl/fixtures
 */
export async function getFixtures(req: Request, res: Response) {
  try {
    const fixtures = await fplService.getFixtures({
      event: req.query.event ? Number(req.query.event) : undefined,
      teamId: req.query.teamId ? Number(req.query.teamId) : undefined,
    });
    return ok(res, fixtures);
  } catch (err) {
    console.error('[GET /fpl/fixtures]', err);
    return fail(res, 500, 'Failed to fetch fixtures');
  }
}