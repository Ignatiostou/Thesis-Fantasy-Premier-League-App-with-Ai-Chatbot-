import { prisma } from '../db/prisma.js';

const BOOTSTRAP_URL = 'https://fantasy.premierleague.com/api/bootstrap-static/';
const FIXTURES_URL  = 'https://fantasy.premierleague.com/api/fixtures/';

// ── Fetch helper ──────────────────────────────────────────────────────────────

async function fetchJson(url: string, timeoutMs = 20_000): Promise<any> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal:  controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`Fetch failed ${res.status} — ${url}`);
    return res.json();
  } finally {
    clearTimeout(t);
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ── Public entry point ────────────────────────────────────────────────────────

export interface SyncSummary {
  teams:          number;
  events:         number;
  players:        number;
  fixtures:       number;
  elapsedSeconds: number;
  playersGoneFromApi: number;
}

export async function refreshFplData(): Promise<SyncSummary> {
  console.log('[FPL] Starting data refresh…');
  const startedAt = Date.now();

  
  const [bootstrap, fixtures] = await Promise.all([
    fetchJson(BOOTSTRAP_URL),
    fetchJson(FIXTURES_URL),
  ]);

  
  const [teamsCount, eventsCount] = await Promise.all([
    syncTeams(bootstrap.teams   as any[]),
    syncEvents(bootstrap.events as any[]),
  ]);

  
  const playersCount  = await syncPlayers(bootstrap.elements as any[]);
  const fixturesCount = await syncFixtures(fixtures           as any[]);


  const apiPlayerIds = new Set<number>((bootstrap.elements as any[]).map((p) => p.id));
  const dbPlayerIds = await prisma.fplPlayer.findMany({ select: { id: true, webName: true, isActiveInFpl: true } });
  const goneFromApi = dbPlayerIds.filter((p) => !apiPlayerIds.has(p.id) && p.isActiveInFpl);
  if (goneFromApi.length > 0) {
    await prisma.fplPlayer.updateMany({
      where: { id: { in: goneFromApi.map((p) => p.id) } },
      data:  { isActiveInFpl: false },
    });
    console.warn(
      `[FPL]   ⚠ ${goneFromApi.length} player(s) in our DB no longer appear in the FPL API response — ` +
      `marked inactive: ${goneFromApi.slice(0, 10).map((p) => p.webName).join(', ')}` +
      `${goneFromApi.length > 10 ? '…' : ''}.`,
    );
  }

  const elapsedSeconds = Number(((Date.now() - startedAt) / 1000).toFixed(1));
  const summary: SyncSummary = {
    teams:    teamsCount,
    events:   eventsCount,
    players:  playersCount,
    fixtures: fixturesCount,
    elapsedSeconds,
    playersGoneFromApi: goneFromApi.length,
  };

  console.log(`[FPL] Refresh complete in ${elapsedSeconds}s`, summary);
  return summary;
}

// ── Sync helpers ──────────────────────────────────────────────────────────────

async function syncTeams(teams: any[]): Promise<number> {
  await prisma.$transaction(
    teams.map((t) =>
      prisma.fplTeam.upsert({
        where:  { id: t.id },
        create: { id: t.id, name: t.name, shortName: t.short_name, code: t.code ?? null },
        update: {            name: t.name, shortName: t.short_name, code: t.code ?? null },
      }),
    ),
  );
  console.log(`[FPL]   ✓ Teams: ${teams.length}`);
  return teams.length;
}

async function syncEvents(events: any[]): Promise<number> {
  await prisma.$transaction(
    events.map((ev) =>
      prisma.fplEvent.upsert({
        where:  { id: ev.id },
        create: {
          id:           ev.id,
          name:         ev.name,
          deadlineTime: ev.deadline_time ? new Date(ev.deadline_time) : null,
          finished:     ev.finished   ?? null,
          isCurrent:    ev.is_current ?? null,
          raw:          ev,
        },
        update: {
          name:         ev.name,
          deadlineTime: ev.deadline_time ? new Date(ev.deadline_time) : null,
          finished:     ev.finished   ?? null,
          isCurrent:    ev.is_current ?? null,
          raw:          ev,
        },
      }),
    ),
  );
  console.log(`[FPL]   ✓ Events: ${events.length}`);
  return events.length;
}

async function syncPlayers(players: any[]): Promise<number> {
  const CHUNK = 100;
  let synced = 0;

  for (const batch of chunk(players, CHUNK)) {
    await prisma.$transaction(
      batch.map((p) =>
        prisma.fplPlayer.upsert({
          where:  { id: p.id },
          create: {
            id:                        p.id,
            webName:                   p.web_name,
            firstName:                 p.first_name,
            secondName:                p.second_name,
            teamId:                    p.team,
            position:                  p.element_type,
            nowCost:                   p.now_cost,
            status:                    p.status,
            chanceOfPlayingNextRound:  p.chance_of_playing_next_round ?? null,
            totalPoints:               p.total_points ?? null,
            minutes:                   p.minutes      ?? null,
            goalsScored:               p.goals_scored ?? null,
            assists:                   p.assists      ?? null,
            cleanSheets:               p.clean_sheets ?? null,
            bonus:                     p.bonus        ?? null,
            selectedByPercent:         p.selected_by_percent ? parseFloat(p.selected_by_percent) : null,
            form:                      p.form ? parseFloat(p.form) : null,
            isActiveInFpl:             true,
            raw:                       p,
          },
          update: {
            webName:                   p.web_name,
            firstName:                 p.first_name,
            secondName:                p.second_name,
            teamId:                    p.team,
            position:                  p.element_type,
            nowCost:                   p.now_cost,
            status:                    p.status,
            chanceOfPlayingNextRound:  p.chance_of_playing_next_round ?? null,
            totalPoints:               p.total_points ?? null,
            minutes:                   p.minutes      ?? null,
            goalsScored:               p.goals_scored ?? null,
            assists:                   p.assists      ?? null,
            cleanSheets:               p.clean_sheets ?? null,
            bonus:                     p.bonus        ?? null,
            selectedByPercent:         p.selected_by_percent ? parseFloat(p.selected_by_percent) : null,
            form:                      p.form ? parseFloat(p.form) : null,
            // Present in this sync's API response — reactivate in case a
            // previously-inactive id somehow reappears (e.g. re-registered
            // mid-season), same as every other field above being refreshed.
            isActiveInFpl:             true,
            raw:                       p,
          },
        }),
      ),
    );
    synced += batch.length;
    console.log(`[FPL]   ✓ Players: ${synced}/${players.length}`);
  }

  return players.length;
}

async function syncFixtures(fixtures: any[]): Promise<number> {
  const CHUNK = 100;
  let synced = 0;

  for (const batch of chunk(fixtures, CHUNK)) {
    await prisma.$transaction(
      batch.map((f) =>
        prisma.fplFixture.upsert({
          where:  { id: f.id },
          create: {
            id:               f.id,
            event:            f.event      ?? null,
            kickoffTime:      f.kickoff_time ? new Date(f.kickoff_time) : null,
            teamHId:          f.team_h,
            teamAId:          f.team_a,
            teamHScore:       f.team_h_score       ?? null,
            teamAScore:       f.team_a_score       ?? null,
            teamHDifficulty:  f.team_h_difficulty  ?? null,
            teamADifficulty:  f.team_a_difficulty  ?? null,
            finished:         f.finished  ?? null,
            started:          f.started   ?? null,
            stats:            f.stats     ?? null,
            raw:              f,
          },
          update: {
            event:            f.event      ?? null,
            kickoffTime:      f.kickoff_time ? new Date(f.kickoff_time) : null,
            teamHId:          f.team_h,
            teamAId:          f.team_a,
            teamHScore:       f.team_h_score       ?? null,
            teamAScore:       f.team_a_score       ?? null,
            teamHDifficulty:  f.team_h_difficulty  ?? null,
            teamADifficulty:  f.team_a_difficulty  ?? null,
            finished:         f.finished  ?? null,
            started:          f.started   ?? null,
            stats:            f.stats     ?? null,
            raw:              f,
          },
        }),
      ),
    );
    synced += batch.length;
    console.log(`[FPL]   ✓ Fixtures: ${synced}/${fixtures.length}`);
  }

  return fixtures.length;
}
