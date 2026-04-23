"use client";


import { useCountdown } from "@/lib/hooks/useCountdown";
import { ACCENT } from "@/lib/constants";
import { DeadlineHeroProps } from "@/lib/types";



export default function DeadlineHero({ iso, label, gwName }: DeadlineHeroProps) {
  const { days, hours, minutes, seconds, expired, urgent } = useCountdown(iso);

  if (!iso) return null;

  const glowColor = urgent ? "#ef4444" : ACCENT;
  const units = [
    { v: days,    l: "DAYS" },
    { v: hours,   l: "HRS"  },
    { v: minutes, l: "MIN"  },
    { v: seconds, l: "SEC"  },
  ];

  return (
    <div style={{
      position: "relative",
      background: "linear-gradient(135deg, rgba(0,255,135,.07) 0%, rgba(0,212,170,.03) 50%, transparent 100%)",
      border: `1px solid ${urgent ? "rgba(239,68,68,.35)" : "rgba(0,255,135,.2)"}`,
      borderRadius: 24, padding: "28px 36px", overflow: "hidden", flexShrink: 0,
    }}>
      <div style={{
        position: "absolute", top: -40, right: -40, width: 200, height: 200, borderRadius: "50%",
        background: `radial-gradient(circle, ${glowColor}18 0%, transparent 70%)`,
        animation: urgent ? "urgentPulse 1.5s ease-in-out infinite" : "none",
      }} />

      <div style={{ color: "rgba(255,255,255,.4)", fontSize: 9, fontWeight: 700, letterSpacing: ".35em", textTransform: "uppercase", fontFamily: "'DM Sans',sans-serif", marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 15, fontWeight: 800, fontFamily: "'Bebas Neue',sans-serif", letterSpacing: ".12em", marginBottom: 16, color: urgent ? "#ef4444" : "rgba(255,255,255,.7)" }}>
        {gwName}
      </div>

      {expired ? (
        <div style={{ color: "#ef4444", fontSize: 28, fontWeight: 900, fontFamily: "'Bebas Neue',sans-serif", letterSpacing: ".08em" }}>
          DEADLINE PASSED
        </div>
      ) : (
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          {units.map(({ v, l }, i) => (
            <div key={l} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ textAlign: "center" }}>
                <div style={{
                  fontFamily: "'Bebas Neue',sans-serif", fontSize: 52, fontWeight: 400, lineHeight: 1,
                  color: urgent ? "#ef4444" : ACCENT, letterSpacing: "-.02em",
                  textShadow: `0 0 30px ${glowColor}60`, minWidth: 60, textAlign: "center",
                }}>
                  {String(v).padStart(2, "0")}
                </div>
                <div style={{ color: "rgba(255,255,255,.28)", fontSize: 8, fontWeight: 700, letterSpacing: ".3em", fontFamily: "'DM Sans',sans-serif", textAlign: "center", marginTop: 4 }}>
                  {l}
                </div>
              </div>
              {i < 3 && (
                <div style={{ color: "rgba(255,255,255,.18)", fontSize: 36, fontFamily: "'Bebas Neue',sans-serif", lineHeight: 1, marginTop: 4, animation: "colonBlink 1s step-end infinite" }}>:</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
