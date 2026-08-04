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
        influence, creativity, threat, "ictIndex", "createdAt", "updatedAt"
    ) VALUES (
        :id, :player_id, :gameweek, :minutes, :total_points, :goals_scored,
        :assists, :clean_sheets, :goals_conceded, :own_goals, :penalties_saved,
        :penalties_missed, :yellow_cards, :red_cards, :saves, :bonus, :bps,
        :influence, :creativity, :threat, :ict_index, NOW(), NOW()
    )
    ON CONFLICT ("playerId", gameweek) DO UPDATE SET
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


def _stat_row(player_id: int, gameweek: int, stats: dict) -> dict:
    """Normalises one aggregated stat blob into DB upsert params."""
    row = {
        "id": f"bk{uuid.uuid4().hex}",
        "player_id": int(player_id),
        "gameweek": int(gameweek),
        "clean_sheets": bool(stats.get("clean_sheets", 0)),
    }
    for f in _INT_STATS:
        row[f] = int(stats.get(f) or 0)
    for f in _FLOAT_STATS:
        # Keep FPL's string representation; sum was done as float upstream.
        val = stats.get(f)
        row[f] = f"{float(val):.1f}" if val is not None else None
    return row


def rows_from_history(player_id: int, history: list[dict]) -> list[dict]:
    """
    element-summary 'history' entries → one row per gameweek.
    Double gameweeks (two fixtures in one round) are summed.
    """
    by_round: dict[int, dict] = {}
    for h in history:
        gw = int(h["round"])
        agg = by_round.setdefault(gw, {f: 0 for f in _INT_STATS + _FLOAT_STATS} | {"clean_sheets": 0})
        for f in _INT_STATS:
            agg[f] += int(h.get(f) or 0)
        for f in _FLOAT_STATS:
            agg[f] = float(agg[f]) + float(h.get(f) or 0)
        agg["clean_sheets"] += int(h.get("clean_sheets") or 0)

    return [_stat_row(player_id, gw, stats) for gw, stats in sorted(by_round.items())]


def rows_from_event_live(gameweek: int, elements: list[dict]) -> list[dict]:
    """event/{gw}/live 'elements' → one row per player (already GW-aggregated)."""
    rows = []
    for el in elements:
        stats = el.get("stats") or {}
        rows.append(_stat_row(el["id"], gameweek, stats))
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
