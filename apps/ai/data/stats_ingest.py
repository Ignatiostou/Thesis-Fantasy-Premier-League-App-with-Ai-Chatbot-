"""
Writes per-gameweek player stats into the player_gameweek_stats table.

Two sources are supported:
  - element-summary history rows  (full-season backfill, one call per player)
  - event/{gw}/live elements      (single-gameweek incremental update)

The table uses camelCase column names (Prisma default mapping), so all
identifiers are double-quoted. `id` is a Prisma cuid generated client-side,
so raw inserts must supply their own unique id — we use a uuid4 hex with a
"bk" prefix. Double gameweeks produce two history rows for the same round;
those are summed into one row to satisfy the (playerId, gameweek) unique key.
"""

import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pandas as pd
from sqlalchemy import text

from db import read_sql
from db_writer import get_writer_engine
from logging_utils import get_logger

logger = get_logger(__name__)

# Integer stat fields summed across fixtures of a double gameweek.
_INT_STATS = [
    "minutes", "total_points", "goals_scored", "assists", "goals_conceded",
    "own_goals", "penalties_saved", "penalties_missed", "yellow_cards",
    "red_cards", "saves", "bonus", "bps",
]
# Float stats (stored as strings in the DB, matching FPL's API format).
_FLOAT_STATS = ["influence", "creativity", "threat", "ict_index"]

UPSERT_SQL = text("""
    INSERT INTO player_gameweek_stats (
        id, "playerId", gameweek, minutes, "totalPoints", "goalsScored",
        assists, "cleanSheets", "goalsConceded", "ownGoals", "penaltiesSaved",
        "penaltiesMissed", "yellowCards", "redCards", saves, bonus, bps,
        influence, creativity, threat, "ictIndex",
        "teamId", "opponentTeamId", "wasHome", "fixtureCount",
        "createdAt", "updatedAt"
    ) VALUES (
        :id, :player_id, :gameweek, :minutes, :total_points, :goals_scored,
        :assists, :clean_sheets, :goals_conceded, :own_goals, :penalties_saved,
        :penalties_missed, :yellow_cards, :red_cards, :saves, :bonus, :bps,
        :influence, :creativity, :threat, :ict_index,
        :team_id, :opponent_team_id, :was_home, :fixture_count,
        NOW(), NOW()
    )
    ON CONFLICT ("playerId", gameweek) DO UPDATE SET
        "teamId"          = COALESCE(EXCLUDED."teamId",         player_gameweek_stats."teamId"),
        "opponentTeamId"  = COALESCE(EXCLUDED."opponentTeamId", player_gameweek_stats."opponentTeamId"),
        "wasHome"         = COALESCE(EXCLUDED."wasHome",        player_gameweek_stats."wasHome"),
        "fixtureCount"    = COALESCE(EXCLUDED."fixtureCount",   player_gameweek_stats."fixtureCount"),
        minutes           = EXCLUDED.minutes,
        "totalPoints"     = EXCLUDED."totalPoints",
        "goalsScored"     = EXCLUDED."goalsScored",
        assists           = EXCLUDED.assists,
        "cleanSheets"     = EXCLUDED."cleanSheets",
        "goalsConceded"   = EXCLUDED."goalsConceded",
        "ownGoals"        = EXCLUDED."ownGoals",
        "penaltiesSaved"  = EXCLUDED."penaltiesSaved",
        "penaltiesMissed" = EXCLUDED."penaltiesMissed",
        "yellowCards"     = EXCLUDED."yellowCards",
        "redCards"        = EXCLUDED."redCards",
        saves             = EXCLUDED.saves,
        bonus             = EXCLUDED.bonus,
        bps               = EXCLUDED.bps,
        influence         = EXCLUDED.influence,
        creativity        = EXCLUDED.creativity,
        threat            = EXCLUDED.threat,
        "ictIndex"        = EXCLUDED."ictIndex",
        "updatedAt"       = NOW()
""")


def known_player_ids() -> set[int]:
    df = read_sql("SELECT id FROM fpl_players")
    return set(df["id"].astype(int))


def known_gameweeks() -> set[int]:
    df = read_sql("SELECT id FROM fpl_events")
    return set(df["id"].astype(int))


def _stat_row(player_id: int, gameweek: int, stats: dict, ctx: dict | None = None) -> dict:
    """Normalises one aggregated stat blob into DB upsert params.

    `ctx` carries the fixture context (team, opponent, venue). It is captured
    here because it cannot be recovered later — see the note on the Prisma
    model. Missing context is written as NULL rather than guessed.
    """
    ctx = ctx or {}
    row = {
        "id": f"bk{uuid.uuid4().hex}",
        "player_id": int(player_id),
        "gameweek": int(gameweek),
        "clean_sheets": bool(stats.get("clean_sheets", 0)),
        "team_id": ctx.get("team_id"),
        "opponent_team_id": ctx.get("opponent_team_id"),
        "was_home": ctx.get("was_home"),
        "fixture_count": ctx.get("fixture_count"),
    }
    for f in _INT_STATS:
        row[f] = int(stats.get(f) or 0)
    for f in _FLOAT_STATS:
        # Keep FPL's string representation; sum was done as float upstream.
        val = stats.get(f)
        row[f] = f"{float(val):.1f}" if val is not None else None
    return row


def _fixture_team_map() -> dict[int, tuple[int, int]]:
    """fixture id → (home team id, away team id), read while it is still current."""
    df = read_sql('SELECT id, "teamHId", "teamAId" FROM fpl_fixtures')
    return {int(r.id): (int(r.teamHId), int(r.teamAId)) for r in df.itertuples()}


def _player_team_map() -> dict[int, int]:
    """player id → club id, as of now (correct during the season it describes)."""
    df = read_sql('SELECT id, "teamId" FROM fpl_players')
    return {int(r.id): int(r.teamId) for r in df.itertuples()}


def rows_from_history(player_id: int, history: list[dict],
                      team_id: int | None = None) -> list[dict]:
    """
    element-summary 'history' entries → one row per gameweek.
    Double gameweeks (two fixtures in one round) are summed.

    Each history entry carries `opponent_team` and `was_home`; those are kept
    for the FIRST fixture of the round, with fixture_count recording how many
    there were, since summed stats cannot describe two opponents at once.
    """
    by_round: dict[int, dict] = {}
    ctx_by_round: dict[int, dict] = {}
    for h in history:
        gw = int(h["round"])
        agg = by_round.setdefault(gw, {f: 0 for f in _INT_STATS + _FLOAT_STATS} | {"clean_sheets": 0})
        for f in _INT_STATS:
            agg[f] += int(h.get(f) or 0)
        for f in _FLOAT_STATS:
            agg[f] = float(agg[f]) + float(h.get(f) or 0)
        agg["clean_sheets"] += int(h.get("clean_sheets") or 0)

        ctx = ctx_by_round.setdefault(gw, {
            "team_id": team_id,
            "opponent_team_id": int(h["opponent_team"]) if h.get("opponent_team") else None,
            "was_home": bool(h["was_home"]) if h.get("was_home") is not None else None,
            "fixture_count": 0,
        })
        ctx["fixture_count"] += 1

    return [_stat_row(player_id, gw, stats, ctx_by_round.get(gw))
            for gw, stats in sorted(by_round.items())]


def rows_from_event_live(gameweek: int, elements: list[dict]) -> list[dict]:
    """event/{gw}/live 'elements' → one row per player (already GW-aggregated).

    The live payload has no opponent field, but each element's `explain` block
    names the fixture(s) it played in, which resolves to the opponent through
    fpl_fixtures while that table still describes the current season.
    """
    fixtures = _fixture_team_map()
    teams = _player_team_map()

    rows = []
    for el in elements:
        pid = int(el["id"])
        stats = el.get("stats") or {}
        explains = el.get("explain") or []
        fixture_ids = [int(e["fixture"]) for e in explains if e.get("fixture")]

        ctx = {"team_id": teams.get(pid), "fixture_count": len(fixture_ids) or None,
               "opponent_team_id": None, "was_home": None}
        if fixture_ids and ctx["team_id"] and fixture_ids[0] in fixtures:
            home, away = fixtures[fixture_ids[0]]
            if ctx["team_id"] in (home, away):
                ctx["was_home"] = ctx["team_id"] == home
                ctx["opponent_team_id"] = away if ctx["was_home"] else home

        rows.append(_stat_row(pid, gameweek, stats, ctx))
    return rows


def upsert_stat_rows(rows: list[dict], batch_size: int = 500) -> int:
    """Upserts stat rows, filtering out players/gameweeks not present in the DB
    (foreign keys would reject them)."""
    if not rows:
        logger.warning("upsert_stat_rows called with no rows")
        return 0

    players = known_player_ids()
    events = known_gameweeks()

    valid = [r for r in rows if r["player_id"] in players and r["gameweek"] in events]
    skipped = len(rows) - len(valid)
    if skipped:
        logger.warning("Skipping %d rows with unknown playerId/gameweek (FK)", skipped)

    engine = get_writer_engine()
    written = 0
    with engine.begin() as conn:
        for i in range(0, len(valid), batch_size):
            batch = valid[i:i + batch_size]
            conn.execute(UPSERT_SQL, batch)
            written += len(batch)

    logger.info("Upserted %d rows into player_gameweek_stats", written)
    return written


def gw_row_counts() -> pd.DataFrame:
    return read_sql(
        "SELECT gameweek, COUNT(*) AS players "
        "FROM player_gameweek_stats GROUP BY gameweek ORDER BY gameweek"
    )
