"use client";

import Link from "next/link";
import { ACCENT } from "@/lib/constants";
import { StatCardProps } from "@/lib/types";



export default function StatCard({ label, value, sub, accent, warn, href }: StatCardProps) {
  const col = accent ? ACCENT : warn ? "#ef4444" : "white";

  const inner = (
    <div style={{
      padding: "20px 22px", borderRadius: 18,
      background: accent ? `linear-gradient(135deg, ${ACCENT}0f 0%, transparent 100%)` : warn ? "rgba(239,68,68,.06)" : "rgba(255,255,255,.03)",
      border: `1px solid ${accent ? ACCENT + "30" : warn ? "rgba(239,68,68,.2)" : "rgba(255,255,255,.07)"}`,
      transition: "all .22s", cursor: href ? "pointer" : "default",
      position: "relative", overflow: "hidden",
    }}>
      <div style={{ color: "rgba(255,255,255,.3)", fontSize: 9, fontWeight: 600, letterSpacing: ".25em", textTransform: "uppercase", fontFamily: "'DM Sans',sans-serif", marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ color: col, fontSize: 32, fontWeight: 700, fontFamily: "'Bebas Neue',sans-serif", lineHeight: 1, letterSpacing: ".02em", textShadow: accent ? `0 0 20px ${ACCENT}40` : "none" }}>
        {value}
      </div>
      {sub && (
        <div style={{ color: "rgba(255,255,255,.25)", fontSize: 10, fontFamily: "'DM Sans',sans-serif", marginTop: 4 }}>
          {sub}
        </div>
      )}
    </div>
  );

  if (href) return <Link href={href} style={{ textDecoration: "none" }}>{inner}</Link>;
  return inner;
}
