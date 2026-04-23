"use client";
import { POS_COLOR, POS_LABEL } from "@/lib/constants";

export default function PosTag({ pos }: { pos: number }) {
  const c = POS_COLOR[pos];
  return (
    <span style={{
      fontSize: 9, fontWeight: 900, color: c,
      background: `${c}18`, border: `1px solid ${c}35`,
      borderRadius: 4, padding: "1px 5px",
      letterSpacing: "0.08em",
      fontFamily: "'Barlow Condensed', sans-serif",
    }}>
      {POS_LABEL[pos]}
    </span>
  );
}
