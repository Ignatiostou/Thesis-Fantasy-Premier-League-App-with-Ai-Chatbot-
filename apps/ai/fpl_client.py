"""
Thin client for the public Fantasy Premier League API.

Used by the backfill / update scripts to pull per-gameweek player stats
directly from FPL, so the ML pipeline does not depend on the API app
having been online for every gameweek of the season.
"""

import time

import requests

from logging_utils import get_logger

logger = get_logger(__name__)

BASE_URL = "https://fantasy.premierleague.com/api"

_session = requests.Session()
_session.headers.update({
    "User-Agent": "Mozilla/5.0",
    "Accept": "application/json",
})

MAX_RETRIES = 4
TIMEOUT_S = 20


def fetch_json(path: str) -> dict | list:
    """GET {BASE_URL}{path} with retries and exponential backoff."""
    url = f"{BASE_URL}{path}"
    last_exc: Exception | None = None

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            res = _session.get(url, timeout=TIMEOUT_S)
            if res.status_code == 429:
                wait = 5 * attempt
                logger.warning("Rate limited on %s — sleeping %ds", path, wait)
                time.sleep(wait)
                continue
            res.raise_for_status()
            return res.json()
        except Exception as exc:  # noqa: BLE001 — retry any transport error
            last_exc = exc
            wait = 2 ** attempt
            logger.warning("Fetch failed (%s), attempt %d/%d — retrying in %ds",
                           exc, attempt, MAX_RETRIES, wait)
            time.sleep(wait)

    raise RuntimeError(f"FPL API request failed after {MAX_RETRIES} retries: {url}") from last_exc


def get_bootstrap() -> dict:
    """bootstrap-static: events, teams, elements (players), element_types."""
    return fetch_json("/bootstrap-static/")


def get_element_summary(player_id: int) -> dict:
    """element-summary/{id}: per-GW 'history' for the current/most recent season."""
    return fetch_json(f"/element-summary/{player_id}/")


def get_event_live(gameweek: int) -> dict:
    """event/{gw}/live: aggregated per-player stats for one gameweek."""
    return fetch_json(f"/event/{gameweek}/live/")
