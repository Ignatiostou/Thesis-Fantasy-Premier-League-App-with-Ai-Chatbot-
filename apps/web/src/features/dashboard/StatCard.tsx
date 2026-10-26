"use client";

import Link from "next/link";
import { useState } from "react";
import { ACCENT } from "@/lib/constants";
import { StatCardProps } from "@/lib/types";

/**
 * Dashboard stat tile.
 *
 * Same three pieces of information as before — label, value, optional sub — but
 * with a clearer hierarchy: the label is legible rather than a whisper at 30%
 * opacity, the value carries the emphasis, and each card gets a coloured rail
 * plus a soft corner glow so the accent and warning variants read at a glance
 * instead of relying on a barely-tinted background.
 */
export default function StatCard({ label, value, sub, accent, warn, href }: StatCardProps) {
  const [hover, setHover] = useState(false);

  const tone = accent ? ACCENT : warn ? "#ef4444" : "#93b0c4";
  const valueColor = accent ? ACCENT : warn ? "#ef4444" : "#ffffff";
  const interactive = Boolean(href);

  const inner = (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: "relative",
        overflow: "hidden",
        // Fill the grid row so every tile starts and ends at the same height,
        // whatever the sub-line says — cards without one used to come up short.
        height: "100%",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        padding: "18px 20px 17px",
        borderRadius: 16,
        background: accent
          ? `linear-gradient(150deg, ${ACCENT}14 0%, rgba(255,255,255,.02) 46%, rgba(255,255,255,.015) 100%)`
          : warn
          ? "linear-gradient(150deg, rgba(239,68,68,.12) 0%, rgba(255,255,255,.02) 46%, rgba(255,255,255,.015) 100%)"
          : "linear-gradient(150deg, rgba(255,255,255,.055) 0%, rgba(255,255,255,.022) 55%, rgba(255,255,255,.014) 100%)",
        border: `1px solid ${
          accent
            ? hover ? `${ACCENT}55` : `${ACCENT}2e`
            : warn
            ? hover ? "rgba(239,68,68,.42)" : "rgba(239,68,68,.22)"
            : hover ? "rgba(255,255,255,.16)" : "rgba(255,255,255,.085)"
        }`,
        boxShadow: hover
          ? `0 10px 26px -14px rgba(0,0,0,.75), inset 0 1px 0 rgba(255,255,255,.07)`
          : `0 4px 14px -12px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.05)`,
        transform: interactive && hover ? "translateY(-2px)" : "translateY(0)",
        transition: "transform .2s ease, box-shadow .2s ease, border-color .2s ease",
        cursor: interactive ? "pointer" : "default",
      }}
    >
      {/* Soft corner glow — gives the tile depth without washing out the text */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: -46,
          right: -34,
          width: 128,
          height: 128,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${tone}${accent || warn ? "26" : "14"} 0%, transparent 68%)`,
          opacity: hover ? 1 : 0.72,
          transition: "opacity .2s ease",
          pointerEvents: "none",
        }}
      />

      {/* Left rail — the quickest read of which tile matters */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: 0,
          top: 14,
          bottom: 14,
          width: 2.5,
          borderRadius: 3,
          background: accent
            ? `linear-gradient(180deg, ${ACCENT} 0%, ${ACCENT}22 100%)`
            : warn
            ? "linear-gradient(180deg, #ef4444 0%, rgba(239,68,68,.15) 100%)"
            : "linear-gradient(180deg, rgba(255,255,255,.30) 0%, rgba(255,255,255,.05) 100%)",
        }}
      />

      <div
        style={{
          color: accent ? `${ACCENT}d0` : warn ? "#f0a3a3" : "rgba(255,255,255,.62)",
          fontSize: 9.5,
          fontWeight: 700,
          letterSpacing: ".2em",
          textTransform: "uppercase",
          fontFamily: "'DM Sans',sans-serif",
          marginBottom: 9,
        }}
      >
        {label}
      </div>

      <div
        style={{
          color: valueColor,
          fontSize: 33,
          fontWeight: 700,
          fontFamily: "'Bebas Neue',sans-serif",
          lineHeight: 1,
          letterSpacing: ".015em",
          textShadow: accent ? `0 0 22px ${ACCENT}45` : warn ? "0 0 22px rgba(239,68,68,.35)" : "none",
        }}
      >
        {value}
      </div>

      {/* Reserved whether or not there is a sub-line, so the value sits at the
          same baseline across the row instead of drifting up on bare cards. */}
      <div
        style={{
          color: "rgba(255,255,255,.55)",
          fontSize: 10.5,
          fontFamily: "'DM Sans',sans-serif",
          marginTop: 7,
          minHeight: 14,
          letterSpacing: ".01em",
        }}
      >
        {sub ?? ""}
      </div>
    </div>
  );

  if (href) {
    return (
      <Link href={href} style={{ textDecoration: "none", display: "block", height: "100%" }}>
        {inner}
      </Link>
    );
  }
  return inner;
}
