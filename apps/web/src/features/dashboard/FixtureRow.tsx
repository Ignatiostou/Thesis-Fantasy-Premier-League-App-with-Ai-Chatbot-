"use client";


import { ACCENT } from "@/lib/constants";
import { FplFixture } from "@/lib/types";

export default function FixtureRow({ f }: { f: FplFixture }) {
  const live = f.started && !f.finished;
  const done = f.finished;
  const ko   = f.kickoffTime ? new Date(f.kickoffTime) : null;

  return (
    <div style={{
      display: "grid", gridTemplateColumns: "1fr auto 1fr",
      alignItems: "center", gap: 12, padding: "10px 16px", borderRadius: 12,
      background: live ? `${ACCENT}08` : "rgba(255,255,255,.02)",
      border: `1px solid ${live ? ACCENT + "25" : "rgba(255,255,255,.05)"}`,
    }}>
      <div style={{ textAlign: "right", color: "rgba(255,255,255,.75)", fontSize: 12, fontWeight: 700, fontFamily: "'DM Sans',sans-serif", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {f.teamH.shortName}
      </div>
      <div style={{ textAlign: "center", minWidth: 52 }}>
        {done ? (
          <span style={{ color: "white", fontSize: 14, fontWeight: 800, fontFamily: "'Bebas Neue',sans-serif", letterSpacing: ".08em" }}>
            {f.teamHScore} — {f.teamAScore}
          </span>
        ) : live ? (
          <span style={{ color: ACCENT, fontSize: 8, fontWeight: 800, letterSpacing: ".25em" }}>LIVE</span>
        ) : ko ? (
          <span style={{ color: "rgba(255,255,255,.3)", fontSize: 10, fontFamily: "'DM Sans',sans-serif" }}>
            {ko.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
          </span>
        ) : (
          <span style={{ color: "rgba(255,255,255,.15)", fontSize: 10 }}>—</span>
        )}
      </div>
      <div style={{ color: "rgba(255,255,255,.75)", fontSize: 12, fontWeight: 700, fontFamily: "'DM Sans',sans-serif", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {f.teamA.shortName}
      </div>
    </div>
  );
}
