"use client";

import { useEffect, useRef, useState } from "react";
import { ACCENT } from "@/lib/constants";
import { FORMATIONS, formationLabel } from "./formations";

/**
 * Formation picker for the pitch.
 *
 * Custom dropdown rather than a native <select>: the OS-drawn popup renders as
 * a white sheet over the dark pitch and cannot be themed.
 */
export default function FormationSelect({
  current,
  onSelect,
}: {
  current: string;
  onSelect: (f: readonly [number, number, number]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div
      ref={ref}
      style={{ position: "absolute", top: 10, right: 12, zIndex: 30 }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          borderRadius: 9,
          border: `1px solid ${open ? ACCENT + "88" : "rgba(255,255,255,.28)"}`,
          background: "rgba(6,14,10,.72)",
          backdropFilter: "blur(6px)",
          color: "#ffffff",
          fontFamily: "'Barlow Condensed',sans-serif",
          fontSize: 13,
          fontWeight: 800,
          letterSpacing: ".1em",
          cursor: "pointer",
          transition: "all .16s",
        }}
      >
        <span style={{ color: "rgba(255,255,255,.62)", fontSize: 10, letterSpacing: ".18em" }}>
          FORMATION
        </span>
        <span style={{ color: ACCENT, fontSize: 14 }}>{current}</span>
        <span
          style={{
            fontSize: 9,
            color: "rgba(255,255,255,.6)",
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform .16s",
          }}
        >
          ▼
        </span>
      </button>

      {open && (
        <div
          role="listbox"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            minWidth: 152,
            padding: 6,
            borderRadius: 11,
            border: "1px solid rgba(255,255,255,.16)",
            background: "rgba(9,17,26,.97)",
            backdropFilter: "blur(10px)",
            boxShadow: "0 18px 40px -18px rgba(0,0,0,.9)",
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          {FORMATIONS.map((f) => {
            const label = formationLabel(f);
            const active = label === current;
            return (
              <button
                key={label}
                role="option"
                aria-selected={active}
                onClick={() => {
                  onSelect(f);
                  setOpen(false);
                }}
                onMouseEnter={(e) => {
                  if (!active) e.currentTarget.style.background = "rgba(255,255,255,.07)";
                }}
                onMouseLeave={(e) => {
                  if (!active) e.currentTarget.style.background = "transparent";
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "9px 11px",
                  borderRadius: 8,
                  border: "none",
                  background: active ? `${ACCENT}1e` : "transparent",
                  color: active ? ACCENT : "rgba(255,255,255,.88)",
                  fontFamily: "'Barlow Condensed',sans-serif",
                  fontSize: 14,
                  fontWeight: 800,
                  letterSpacing: ".12em",
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "background .14s",
                }}
              >
                <span>{label}</span>
                <span style={{ fontSize: 11, opacity: active ? 1 : 0 }}>✓</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
