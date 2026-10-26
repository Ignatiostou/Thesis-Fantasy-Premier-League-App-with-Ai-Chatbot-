"use client";

import { FplFixture } from "@/lib/types";
import { formatDayLabel } from "@/lib/dates";
import FixtureRow from "./FixtureRow";

/**
 * Fixtures grouped under a day heading.
 *
 * A gameweek runs across a Friday night through to Monday, and the rows only
 * carried a kick-off time — so a Friday game and a Sunday game read identically.
 * Grouping states the day once per block rather than repeating a date on every
 * row, which keeps the list quiet while still answering "when".
 */

function dayKey(f: FplFixture): string {
  return f.kickoffTime ? new Date(f.kickoffTime).toDateString() : "TBC";
}

function dayLabel(key: string): string {
  if (key === "TBC") return "Date to be confirmed";
  return formatDayLabel(new Date(key), "short");
}


export default function FixtureList({
  fixtures,
  limit,
}: {
  fixtures: FplFixture[];
  limit?: number;
}) {
  const shown = limit ? fixtures.slice(0, limit) : fixtures;

  // Preserve the order the API returned (chronological) rather than sorting by
  // the map's insertion-independent key.
  const groups: { key: string; items: FplFixture[] }[] = [];
  for (const f of shown) {
    const key = dayKey(f);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(f);
    else groups.push({ key, items: [f] });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {groups.map(({ key, items }) => (
        <div key={key} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "0 2px 2px",
            }}
          >
            <span
              style={{
                color: "rgba(255,255,255,.62)",
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: ".18em",
                textTransform: "uppercase",
                fontFamily: "'DM Sans',sans-serif",
                whiteSpace: "nowrap",
              }}
            >
              {dayLabel(key)}
            </span>
            {/* Hairline that fades out — separates days without adding a hard
                rule that would compete with the fixture cards themselves. */}
            <span
              aria-hidden
              style={{
                flex: 1,
                height: 1,
                background:
                  "linear-gradient(90deg, rgba(255,255,255,.14) 0%, rgba(255,255,255,0) 100%)",
              }}
            />
          </div>

          {items.map((f) => (
            <FixtureRow key={f.id} f={f} />
          ))}
        </div>
      ))}
    </div>
  );
}
