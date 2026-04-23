"use client";
import { ACCENT } from "@/lib/constants";
import { SpinnerProps } from "@/lib/types";



export default function Spinner({ size = 36, label, fullScreen = false }: SpinnerProps) {
  const el = (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
      <style>{`@keyframes _spin { to { transform: rotate(360deg); } }`}</style>
      <div style={{
        width: size, height: size,
        border: `${size > 24 ? 3 : 2}px solid ${ACCENT}22`,
        borderTopColor: ACCENT, borderRadius: "50%",
        animation: "_spin .8s linear infinite",
      }} />
      {label && (
        <span style={{
          color: `${ACCENT}66`, fontSize: 11, letterSpacing: "0.3em",
          textTransform: "uppercase", fontWeight: 700,
          fontFamily: "'Barlow Condensed',sans-serif",
        }}>
          {label}
        </span>
      )}
    </div>
  );

  if (!fullScreen) return el;

  return (
    <div style={{
      minHeight: "100vh", background: "#0a0e1a",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      {el}
    </div>
  );
}
