import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))

from db import read_sql, dispose

def main():
    print("\n=== 1. Status distribution in fpl_players ===")
    df = read_sql('SELECT status, COUNT(*) AS n FROM fpl_players GROUP BY status ORDER BY n DESC')
    print(df.to_string(index=False))

    print("\n=== 2. Sample player rows ===")
    df = read_sql('SELECT id, "webName", status, position, "nowCost" FROM fpl_players LIMIT 10')
    print(df.to_string(index=False))

    print("\n=== 3. Total rows in player_gameweek_stats ===")
    df = read_sql('SELECT COUNT(*) AS total_rows FROM player_gameweek_stats')
    print(df.to_string(index=False))

    print("\n=== 4. Sample gameweek stat rows ===")
    df = read_sql('SELECT "playerId", gameweek, "totalPoints", minutes FROM player_gameweek_stats LIMIT 5')
    print(df.to_string(index=False))

    print("\n=== 5. Upcoming fixtures (finished = FALSE) ===")
    df = read_sql('SELECT COUNT(*) AS upcoming FROM fpl_fixtures WHERE finished = FALSE')
    print(df.to_string(index=False))

    print("\n=== 6. fpl_players column names (first row raw) ===")
    df = read_sql('SELECT * FROM fpl_players LIMIT 1')
    print("Columns:", df.columns.tolist())

    print("\n=== 7. fpl_events — isNext / isCurrent ===")
    df = read_sql('SELECT id, "isNext", "isCurrent", "name" FROM fpl_events WHERE "isNext" = TRUE OR "isCurrent" = TRUE')
    print(df.to_string(index=False))

if __name__ == "__main__":
    try:
        main()
    finally:
        dispose()