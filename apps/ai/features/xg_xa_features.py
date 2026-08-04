import sys
import time
import argparse
import re
from pathlib import Path
from urllib.parse import urljoin

sys.path.insert(0, str(Path(__file__).parent.parent))

import pandas as pd

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    print(
        "Missing dependencies. Run:\n"
        "  pip install requests beautifulsoup4 lxml",
        file=sys.stderr,
    )
    raise

from config import settings
from logging_utils import get_logger

logger = get_logger(__name__)

# ── Configuration ─────────────────────────────────────────────────────────────

BASE_URL          = "https://fbref.com"
PREMIER_LEAGUE_ID = 9     # FBref's competition ID for the Premier League

REQUEST_DELAY_SEC = 3.0   # FBref rate-limits aggressively; be polite
REQUEST_TIMEOUT   = 30
USER_AGENT        = (
    "AI Chatbot Coach Assistant — thesis project / educational use. "
    "Contact: see project README."
)

XG_XA_OUTPUT_PATH = settings.datasets_dir / "xg_xa_per_player_gw.parquet"


# ── HTTP helpers ──────────────────────────────────────────────────────────────

def _session() -> requests.Session:
    s = requests.Session()
    s.headers.update({"User-Agent": USER_AGENT, "Accept-Language": "en-GB,en;q=0.9"})
    return s


def _fetch(url: str, sess: requests.Session) -> str:
    logger.info("GET %s", url)
    resp = sess.get(url, timeout=REQUEST_TIMEOUT)
    resp.raise_for_status()
    time.sleep(REQUEST_DELAY_SEC)
    return resp.text


# ── Season fixtures discovery ─────────────────────────────────────────────────

def fetch_season_fixtures(season: str, sess: requests.Session) -> pd.DataFrame:
    """
    Returns a DataFrame of all matches in the season, with the FBref
    'match_report' link for each. We later visit each link to extract the
    per-player stats.
    """
    # FBref season URL convention: /en/comps/9/2025-2026/schedule/2025-2026-Premier-League-Scores-and-Fixtures
    url = f"{BASE_URL}/en/comps/{PREMIER_LEAGUE_ID}/{season}/schedule/{season}-Premier-League-Scores-and-Fixtures"
    html = _fetch(url, sess)
    soup = BeautifulSoup(html, "lxml")

    table = soup.find("table", {"id": "sched_all"}) or soup.find("table", {"id": "sched"})
    if table is None:
        # Fallback: find a table with sched_ in its id
        tables = soup.find_all("table")
        for t in tables:
            tid = t.get("id", "")
            if "sched" in tid:
                table = t
                break

    if table is None:
        raise RuntimeError("Could not find fixtures table in FBref page")

    rows = []
    for tr in table.find("tbody").find_all("tr"):
        if "thead" in (tr.get("class") or []): continue
        match_link = tr.find("td", {"data-stat": "match_report"}) or tr.find("td", {"data-stat": "score"})
        if not match_link: continue
        link_tag = match_link.find("a")
        if not link_tag: continue
        href = link_tag.get("href", "")
        if not href.startswith("/en/matches/"): continue

        gw_cell   = tr.find("th", {"data-stat": "gameweek"}) or tr.find("td", {"data-stat": "gameweek"})
        date_cell = tr.find("td", {"data-stat": "date"})
        home_cell = tr.find("td", {"data-stat": "home_team"}) or tr.find("td", {"data-stat": "squad_a"})
        away_cell = tr.find("td", {"data-stat": "away_team"}) or tr.find("td", {"data-stat": "squad_b"})

        try:
            gameweek = int(gw_cell.text.strip()) if gw_cell and gw_cell.text.strip() else None
        except ValueError:
            gameweek = None

        rows.append({
            "gameweek":    gameweek,
            "date":        date_cell.text.strip() if date_cell else None,
            "home_team":   home_cell.text.strip() if home_cell else None,
            "away_team":   away_cell.text.strip() if away_cell else None,
            "match_url":   urljoin(BASE_URL, href),
        })

    return pd.DataFrame(rows).dropna(subset=["match_url", "gameweek"])


# ── Per-match player stats ────────────────────────────────────────────────────

def parse_match_player_stats(match_url: str, sess: requests.Session) -> pd.DataFrame:
    """
    Extract per-player xG and xA from a single match report page.
    Returns columns: player_name, team, minutes, xg, xa
    """
    html = _fetch(match_url, sess)
    soup = BeautifulSoup(html, "lxml")

    # FBref's match pages have multiple "stats_<team_id>_summary" tables.
    # Each row is a player.
    summary_tables = soup.find_all("table", id=re.compile(r"^stats_.*_summary$"))
    if not summary_tables:
        # Some match pages embed tables inside HTML comments. Pull them out.
        for comment in soup.find_all(string=lambda x: isinstance(x, str) and "stats_" in x and "_summary" in x):
            sub = BeautifulSoup(comment, "lxml")
            summary_tables.extend(sub.find_all("table", id=re.compile(r"^stats_.*_summary$")))

    if not summary_tables:
        logger.warning("No summary tables found in %s", match_url)
        return pd.DataFrame()

    rows: list[dict] = []
    for tbl in summary_tables:
        # Team name from the table's caption or sibling
        team_name = None
        caption = tbl.find("caption")
        if caption: team_name = caption.text.split("Stats")[0].strip()

        body = tbl.find("tbody")
        if not body: continue
        for tr in body.find_all("tr"):
            classes = tr.get("class") or []
            if "thead" in classes: continue
            name_cell = tr.find("th", {"data-stat": "player"})
            if not name_cell: continue

            def num(stat_name):
                cell = tr.find("td", {"data-stat": stat_name})
                if not cell: return None
                t = cell.text.strip()
                if not t: return None
                try: return float(t)
                except ValueError: return None

            rows.append({
                "player_name": name_cell.text.strip(),
                "team":        team_name,
                "minutes":     num("minutes"),
                "xg":          num("xg"),
                "xa":          num("xg_assist"),       # FBref calls it xg_assist
            })

    return pd.DataFrame(rows)


# ── Name resolution (FBref ⇄ FPL) ─────────────────────────────────────────────

def normalise_name(name: str) -> str:
    """Lowercase + ASCII-fold + remove punctuation. For fuzzy matching."""
    import unicodedata
    n = unicodedata.normalize("NFKD", name).encode("ASCII", "ignore").decode("ASCII")
    n = re.sub(r"[^a-zA-Z\s]", " ", n).lower().strip()
    return re.sub(r"\s+", " ", n)


def build_fpl_name_lookup() -> dict:
    """
    Build a {normalised_full_name: fpl_player_id} dictionary from the FPL DB.
    Used to map FBref player names back to FPL IDs.
    """
    from db import read_sql
    df = read_sql('SELECT id, "firstName", "secondName", "webName" FROM fpl_players')
    lookup = {}
    for _, r in df.iterrows():
        fid = int(r["id"])
        full = normalise_name(f"{r['firstName']} {r['secondName']}")
        web  = normalise_name(r["webName"])
        lookup[full] = fid
        if web and web not in lookup: lookup[web] = fid
        # Also try last-name-only as a fallback
        if r["secondName"]:
            ln = normalise_name(r["secondName"])
            if ln and ln not in lookup: lookup[ln] = fid
    return lookup


def map_to_fpl_id(name: str, lookup: dict) -> int | None:
    n = normalise_name(name)
    if n in lookup: return lookup[n]
    # Last-name fallback
    parts = n.split()
    if parts and parts[-1] in lookup: return lookup[parts[-1]]
    return None


# ── Main scraper ──────────────────────────────────────────────────────────────

def scrape_season(season: str, resume: bool = False) -> pd.DataFrame:
    sess = _session()

    fixtures = fetch_season_fixtures(season, sess)
    logger.info("Found %d fixtures for season %s", len(fixtures), season)

    # If resuming, skip GWs already present in the existing output
    existing_gws: set[int] = set()
    if resume and XG_XA_OUTPUT_PATH.exists():
        existing = pd.read_parquet(XG_XA_OUTPUT_PATH)
        existing_gws = set(existing["gameweek"].dropna().astype(int).unique())
        logger.info("Resume mode — skipping %d already-scraped gameweeks", len(existing_gws))

    fpl_lookup = build_fpl_name_lookup()
    all_rows: list[pd.DataFrame] = []

    for _, fix in fixtures.iterrows():
        gw = int(fix["gameweek"])
        if gw in existing_gws: continue
        try:
            df = parse_match_player_stats(fix["match_url"], sess)
        except Exception as e:
            logger.error("Failed to scrape %s: %s", fix["match_url"], e)
            continue
        if df.empty: continue

        df["gameweek"]   = gw
        df["fpl_player_id"] = df["player_name"].apply(lambda n: map_to_fpl_id(n, fpl_lookup))
        df["match_url"]  = fix["match_url"]

        # Drop rows that couldn't be matched
        matched = df[df["fpl_player_id"].notna()].copy()
        matched["fpl_player_id"] = matched["fpl_player_id"].astype(int)

        logger.info(
            "GW%d %s vs %s — extracted %d players (%d matched to FPL)",
            gw, fix["home_team"], fix["away_team"], len(df), len(matched),
        )
        all_rows.append(matched)

    if not all_rows:
        return pd.DataFrame()

    combined = pd.concat(all_rows, ignore_index=True)

    # If resuming, merge with existing
    if resume and XG_XA_OUTPUT_PATH.exists():
        existing = pd.read_parquet(XG_XA_OUTPUT_PATH)
        combined = pd.concat([existing, combined], ignore_index=True)

    # Aggregate: a player might have a single row per (player_id, gameweek)
    aggregated = (
        combined.groupby(["fpl_player_id", "gameweek"])
        .agg(
            minutes=("minutes", "sum"),
            xg=("xg", "sum"),
            xa=("xa", "sum"),
            player_name=("player_name", "first"),
        )
        .reset_index()
    )

    return aggregated


# ── Feature derivation helpers (for player_features.py) ───────────────────────

def build_rolling_xg_xa_features(history: pd.DataFrame) -> pd.DataFrame:
    """
    Given the raw xG/xA per (player, GW) frame, produce rolling features
    parallel to the existing rolling-points features:

        xg_last_3gw_avg, xa_last_3gw_avg
        xg_last_5gw_avg, xa_last_5gw_avg
        xgxa_last_5gw_sum  (combined xG+xA, 5GW)

    These can be merged into the main training dataset on (player_id, gameweek).
    """
    history = history.sort_values(["fpl_player_id", "gameweek"]).copy()
    g_xg = history.groupby("fpl_player_id")["xg"]
    g_xa = history.groupby("fpl_player_id")["xa"]

    history["xg_last_3gw_avg"] = g_xg.transform(
        lambda s: s.shift(1).rolling(3, min_periods=1).mean()
    ).fillna(0)
    history["xg_last_5gw_avg"] = g_xg.transform(
        lambda s: s.shift(1).rolling(5, min_periods=1).mean()
    ).fillna(0)
    history["xa_last_3gw_avg"] = g_xa.transform(
        lambda s: s.shift(1).rolling(3, min_periods=1).mean()
    ).fillna(0)
    history["xa_last_5gw_avg"] = g_xa.transform(
        lambda s: s.shift(1).rolling(5, min_periods=1).mean()
    ).fillna(0)
    history["xgxa_last_5gw_sum"] = (
        history["xg_last_5gw_avg"] + history["xa_last_5gw_avg"]
    ) * 5
    return history.rename(columns={"fpl_player_id": "player_id"})


# ── CLI entry point ───────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Scrape xG/xA from FBref")
    parser.add_argument("--season", type=str, default="2025-2026", help="FBref season ID, e.g. 2025-2026")
    parser.add_argument("--resume", action="store_true", help="Skip already-scraped gameweeks")
    args = parser.parse_args()

    settings.ensure_artifact_dirs()
    df = scrape_season(args.season, resume=args.resume)
    if df.empty:
        logger.error("No data scraped.")
        sys.exit(1)

    df.to_parquet(XG_XA_OUTPUT_PATH, index=False)
    logger.info("Wrote %d rows to %s", len(df), XG_XA_OUTPUT_PATH)


if __name__ == "__main__":
    main()