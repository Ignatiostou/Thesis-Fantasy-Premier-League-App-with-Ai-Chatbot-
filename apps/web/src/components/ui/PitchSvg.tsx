"use client";

export default function PitchSvg() {
  return (
    <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
      <rect x="3%"  y="1.5%"  width="94%" height="97%" fill="none" stroke="rgba(255,255,255,.2)"  strokeWidth="1.5" rx="5" />
      <line x1="3%" y1="50%"  x2="97%"    y2="50%"      stroke="rgba(255,255,255,.2)"  strokeWidth="1.5" />
      <ellipse cx="50%" cy="50%" rx="14%" ry="9%"        fill="none" stroke="rgba(255,255,255,.2)"  strokeWidth="1.5" />
      <circle cx="50%" cy="50%" r="3"                    fill="rgba(255,255,255,.35)" />
      <rect x="20%" y="1.5%"  width="60%" height="17%"  fill="none" stroke="rgba(255,255,255,.15)" strokeWidth="1" />
      <rect x="33%" y="1.5%"  width="34%" height="7%"   fill="none" stroke="rgba(255,255,255,.1)"  strokeWidth="1" />
      <rect x="20%" y="81.5%" width="60%" height="17%"  fill="none" stroke="rgba(255,255,255,.15)" strokeWidth="1" />
      <rect x="33%" y="91.5%" width="34%" height="7%"   fill="none" stroke="rgba(255,255,255,.1)"  strokeWidth="1" />
      <path d="M 3% 1.5%   Q 5%  1.5%  5%  4.5%"  fill="none" stroke="rgba(255,255,255,.1)" strokeWidth="1" />
      <path d="M 97% 1.5%  Q 95% 1.5%  95% 4.5%"  fill="none" stroke="rgba(255,255,255,.1)" strokeWidth="1" />
      <path d="M 3% 98.5%  Q 5%  98.5% 5%  95.5%" fill="none" stroke="rgba(255,255,255,.1)" strokeWidth="1" />
      <path d="M 97% 98.5% Q 95% 98.5% 95% 95.5%" fill="none" stroke="rgba(255,255,255,.1)" strokeWidth="1" />
    </svg>
  );
}
