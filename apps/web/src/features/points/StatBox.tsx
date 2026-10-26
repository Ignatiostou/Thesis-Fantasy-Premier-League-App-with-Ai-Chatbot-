"use client";
// src/features/points/StatBox.tsx

import { ACCENT } from "@/lib/constants";

interface StatBoxProps {
  label: string;
  value: string | number;
  sub?: string;
  accent?: boolean;
  warn?: boolean;
}

export default function StatBox({ label, value, sub, accent, warn }: StatBoxProps) {
  const color = accent ? ACCENT : warn ? "#ef4444" : "white";
  return (
    <div style={{
      background: accent ? `${ACCENT}10` : warn ? "rgba(239,68,68,.07)" : "rgba(255,255,255,.04)",
      border: `1px solid ${accent ? ACCENT + "30" : warn ? "rgba(239,68,68,.22)" : "rgba(255,255,255,.08)"}`,
      borderRadius: 12, padding: "13px 18px", textAlign: "center", minWidth: 100,
    }}>
      <div style={{ color: "rgba(255,255,255,.68)", fontSize: 10, fontWeight: 700, letterSpacing: ".2em", textTransform: "uppercase", fontFamily: "'Barlow',sans-serif", marginBottom: 5 }}>
        {label}
      </div>
      <div style={{ color, fontSize: 26, fontWeight: 900, lineHeight: 1 }}>{value}</div>
      {sub && (
        <div style={{ color: "rgba(255,255,255,.55)", fontSize: 10, marginTop: 3, fontFamily: "'Barlow',sans-serif" }}>{sub}</div>
      )}
    </div>
  );
}
