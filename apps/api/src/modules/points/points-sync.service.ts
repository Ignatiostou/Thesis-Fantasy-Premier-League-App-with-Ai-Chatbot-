import { prisma } from "../../db/prisma.js";

const FPL_API_BASE = "https://fantasy.premierleague.com/api";
const BATCH_SIZE   = 50; // process 50 players at a time in parallel

type FplLiveElement = {
  id: number;
  stats: {
    minutes: number;
    goals_scored: number;
    assists: number;
    clean_sheets: number;
    goals_conceded: number;
    own_goals: number;
    penalties_saved: number;
    penalties_missed: number;
    yellow_cards: number;
    red_cards: number;
    saves: number;
    bonus: number;
    bps: number;
    influence: string;
    creativity: string;
    threat: string;
    ict_index: string;
    total_points: number;
  };
};

type FplEventLiveResponse = {
  elements: FplLiveElement[];
};

async function getCurrentGameweekId() {
  const current = await prisma.fplEvent.findFirst({
    where:  { isCurrent: true },
    select: { id: true },
  });
  return current?.id ?? 1;
}

async function fetchEventLive(gameweek: number): Promise<FplEventLiveResponse> {
  const res = await fetch(`${FPL_API_BASE}/event/${gameweek}/live/`, {
    method:  "GET",
    headers: { "Content-Type": "application/json" },
    cache:   "no-store",
  });

  if (!res.ok) {
    throw new Error(`FPL_EVENT_LIVE_FETCH_FAILED_${res.status}`);
  }

  return res.json();
}

export async function syncPlayerGameweekStats(gameweek?: number) {
  const gw   = gameweek ?? (await getCurrentGameweekId());
  const live  = await fetchEventLive(gw);

  if (!live?.elements?.length) {
    return { success: true, gameweek: gw, upserted: 0, skipped: 0, message: "No live stats returned." };
  }

  const existingPlayers = await prisma.fplPlayer.findMany({ select: { id: true } });
  const existingPlayerIds = new Set(existingPlayers.map((p) => p.id));

  let upserted = 0;
  let skipped  = 0;

  // Filter to only players we have in the DB
  const elements = live.elements.filter((el) => {
    if (!existingPlayerIds.has(el.id)) { skipped++; return false; }
    return true;
  });

  // Process in batches of BATCH_SIZE — parallel within each batch,
  // sequential between batches. No wrapping transaction — each upsert
  // is idempotent so we don't need atomicity across all 700+ rows.
  for (let i = 0; i < elements.length; i += BATCH_SIZE) {
    const batch = elements.slice(i, i + BATCH_SIZE);

    await Promise.all(
      batch.map(async (el) => {
        const statData = {
          minutes:         el.stats.minutes         ?? 0,
          totalPoints:     el.stats.total_points     ?? 0,
          goalsScored:     el.stats.goals_scored     ?? 0,
          assists:         el.stats.assists          ?? 0,
          cleanSheets:     (el.stats.clean_sheets    ?? 0) > 0,
          goalsConceded:   el.stats.goals_conceded   ?? 0,
          ownGoals:        el.stats.own_goals        ?? 0,
          penaltiesSaved:  el.stats.penalties_saved  ?? 0,
          penaltiesMissed: el.stats.penalties_missed ?? 0,
          yellowCards:     el.stats.yellow_cards     ?? 0,
          redCards:        el.stats.red_cards        ?? 0,
          saves:           el.stats.saves            ?? 0,
          bonus:           el.stats.bonus            ?? 0,
          bps:             el.stats.bps              ?? 0,
          influence:       el.stats.influence        ?? null,
          creativity:      el.stats.creativity       ?? null,
          threat:          el.stats.threat           ?? null,
          ictIndex:        el.stats.ict_index        ?? null,
        };

        // Upsert stat row — no transaction, each is independent
        await prisma.playerGameweekStat.upsert({
          where:  { playerId_gameweek: { playerId: el.id, gameweek: gw } },
          update: statData,
          create: { playerId: el.id, gameweek: gw, ...statData },
        });

        // Mirror live points into fpl_players for quick UI reads.
        // Best-effort — swallow errors so one bad player doesn't abort the batch.
        await prisma.fplPlayer.update({
          where: { id: el.id },
          data:  { eventPoints: el.stats.total_points ?? 0, minutes: el.stats.minutes ?? 0 },
        }).catch(() => {});

        upserted++;
      }),
    );
  }

  return { success: true, gameweek: gw, upserted, skipped };
}