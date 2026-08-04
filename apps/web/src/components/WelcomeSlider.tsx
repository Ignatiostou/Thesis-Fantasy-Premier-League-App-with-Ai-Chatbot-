'use client';

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";

const WELCOME_SEEN_KEY = "fpl_welcome_seen_v1";

const slides = [
  {
    id: 1,
    eyebrow: "Welcome to",
    title: "Fantasy\nPremier\nLeague",
    body: "Step into the dugout. You're no longer just a fan — you're the manager. Build your squad, outmaneuver your rivals, and chase glory across every matchweek of the season.",
    accent: "#00FF87",
    icon: "⚽",
    stat: { label: "Season 2026/27", value: "38 Gameweeks" },
  },
  {
    id: 2,
    eyebrow: "Build Your",
    title: "Dream\nSquad",
    body: "Select 15 players — 2 goalkeepers, 5 defenders, 5 midfielders, and 3 forwards — from any Premier League club, within your £100m budget.",
    accent: "#38BDF8",
    icon: "🧑‍🤝‍🧑",
    stat: { label: "Total Players", value: "15 Picks" },
  },
  {
    id: 3,
    eyebrow: "Earn",
    title: "Points\nEvery\nMatchweek",
    body: "Goals, assists, clean sheets, saves — every action earns points. Captain your star man to double his haul. Every tackle, every strike counts.",
    accent: "#FACC15",
    icon: "📊",
    stat: { label: "Avg Captain Pts", value: "12 / GW" },
  },
  {
    id: 4,
    eyebrow: "Manage",
    title: "Transfers\n& Chips",
    body: "1 free transfer per gameweek. Use your chips wisely — Wildcard, Bench Boost, Triple Captain, Free Hit — to surge the rankings when it matters most.",
    accent: "#F97316",
    icon: "🔄",
    stat: { label: "Free Transfers", value: "1 / Week" },
  },
  {
    id: 5,
    eyebrow: "Compete In",
    title: "Private\nLeagues",
    body: "Create or join leagues with friends, family, or colleagues. Climb private and global leaderboards all season. Bragging rights are everything.",
    accent: "#A78BFA",
    icon: "🏆",
    stat: { label: "League Types", value: "H2H & Classic" },
  },
  {
    id: 6,
    eyebrow: "Are You",
    title: "Ready to\nMake Your\nMove?",
    body: "The whistle has blown. Every decision is yours — the glory, the heartbreak, the late-night transfer regrets. Join millions worldwide.",
    accent: "#00FF87",
    icon: "🚀",
    stat: { label: "Global Managers", value: "11M+" },
    cta: true,
  },
];

export default function WelcomeSlider() {
  const router = useRouter();

  const [current, setCurrent] = useState(0);
  const [phase, setPhase] = useState<"idle" | "exiting" | "entering">("idle");
  const [dir, setDir] = useState<"next" | "prev">("next");
  const [displayed, setDisplayed] = useState(0);

  // // NEW: first-time only gate
  // useEffect(() => {
  //   try {
  //     const seen = localStorage.getItem(WELCOME_SEEN_KEY);
  //     if (seen === "1") {
  //       router.replace("/auth"); // ή "/app" αν θες
  //     }
  //   } catch {
  //     // ignore if storage blocked
  //   }
  // }, [router]);

  const goTo = useCallback(
    (index: number, d: "next" | "prev" = "next") => {
      if (phase !== "idle" || index === current) return;
      setDir(d);
      setPhase("exiting");
      setTimeout(() => {
        setDisplayed(index);
        setCurrent(index);
        setPhase("entering");
        setTimeout(() => setPhase("idle"), 420);
      }, 350);
    },
    [phase, current],
  );

  const next = () => goTo((current + 1) % slides.length, "next");
  const prev = () => goTo((current - 1 + slides.length) % slides.length, "prev");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, phase]);

  // Swipe navigation on touch devices
  const touchStartX = useRef<number | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(dx) < 50) return;
    if (dx < 0) next();
    else prev();
  };

  const slide = slides[displayed];

  const exitStyle: React.CSSProperties = {
    opacity: 0,
    transform:
      phase === "exiting"
        ? dir === "next"
          ? "translateX(-50px)"
          : "translateX(50px)"
        : "translateX(0)",
    transition: "opacity 0.35s ease, transform 0.35s ease",
  };

  const enterStyle: React.CSSProperties = {
    opacity: phase === "entering" || phase === "idle" ? 1 : 0,
    transform: "translateX(0)",
    transition: "opacity 0.4s ease 0.05s, transform 0.4s ease 0.05s",
  };

  const contentStyle = phase === "exiting" ? exitStyle : enterStyle;

  //NEW: single CTA button -> /auth and set "seen"
  const handleGetStarted = () => {
    try {
      localStorage.setItem(WELCOME_SEEN_KEY, "1");
    } catch {
      // ignore
    }
    router.push("/auth");
  };

  return (
    <div
      style={{
        fontFamily: "'Barlow Condensed', 'Impact', sans-serif",
        minHeight: "100vh",
        background: "#0a0e1a",
        display: "flex",
        flexDirection: "column",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@300;400;600;700;800;900&family=Barlow:wght@300;400;500&display=swap');
        @keyframes float { 0%,100%{transform:translateY(0) rotate(0deg)} 50%{transform:translateY(-10px) rotate(3deg)} }
        @keyframes pulseRing { 0%,100%{transform:scale(1);opacity:.12} 50%{transform:scale(1.12);opacity:.25} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
        .float-icon { animation: float 4s ease-in-out infinite; }
        .pulse-ring { animation: pulseRing 3s ease-in-out infinite; }
        .fade-1 { animation: fadeUp 0.5s 0.1s both ease-out; }
        .fade-2 { animation: fadeUp 0.5s 0.2s both ease-out; }
        .fade-3 { animation: fadeUp 0.5s 0.3s both ease-out; }
        .fade-4 { animation: fadeUp 0.5s 0.4s both ease-out; }
        .fade-5 { animation: fadeUp 0.5s 0.5s both ease-out; }

        /* ── Responsive: phones & small tablets ── */
        @media (max-width: 760px) {
          .ws-content {
            flex-direction: column-reverse !important;
            justify-content: center !important;
            gap: 20px !important;
            padding: 0 22px !important;
            text-align: left;
          }
          .ws-icon .ws-ring { width: 150px !important; height: 150px !important; }
          .ws-icon .ws-bubble { width: 110px !important; height: 110px !important; }
          .ws-icon .ws-bubble span { font-size: 44px !important; }
          .ws-header { padding: 18px 22px 10px !important; }
          .ws-footer { padding: 14px 22px calc(22px + env(safe-area-inset-bottom, 0px)) !important; }
        }

        @media (max-width: 760px) and (max-height: 700px) {
          .ws-icon { display: none !important; }
        }
      `}</style>

      {/* Pitch lines background */}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        <svg
          width="100%"
          height="100%"
          viewBox="0 0 1200 750"
          preserveAspectRatio="xMidYMid slice"
          style={{ opacity: 0.035 }}
        >
          <ellipse cx="600" cy="375" rx="300" ry="210" fill="none" stroke="white" strokeWidth="2" />
          <circle cx="600" cy="375" r="28" fill="none" stroke="white" strokeWidth="2" />
          <line x1="600" y1="0" x2="600" y2="750" stroke="white" strokeWidth="1.5" />
          <rect x="80" y="245" width="110" height="260" fill="none" stroke="white" strokeWidth="1.5" />
          <rect x="80" y="310" width="45" height="130" fill="none" stroke="white" strokeWidth="1.5" />
          <rect x="1010" y="245" width="110" height="260" fill="none" stroke="white" strokeWidth="1.5" />
          <rect x="1075" y="310" width="45" height="130" fill="none" stroke="white" strokeWidth="1.5" />
        </svg>

        <div
          style={{
            position: "absolute",
            inset: 0,
            background: `radial-gradient(ellipse 55% 50% at 72% 35%, ${slide.accent}1A 0%, transparent 65%), radial-gradient(ellipse 35% 55% at 15% 75%, #1a237e22 0%, transparent 55%)`,
            transition: "background 0.7s ease",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 3,
            background: slide.accent,
            transition: "background 0.5s ease",
          }}
        />
      </div>

      {/* Header */}
      <div
        className="ws-header"
        style={{
          position: "relative",
          zIndex: 10,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "24px 40px 16px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              background: slide.accent,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 900,
              fontSize: 14,
              color: "#0a0e1a",
              transition: "background 0.5s",
            }}
          >
            F
          </div>
          <span
            style={{
              color: "white",
              fontWeight: 700,
              fontSize: 16,
              letterSpacing: "0.2em",
            }}
          >
            FPL MANAGER
          </span>
        </div>

        <div
          style={{
            color: slide.accent,
            border: `1px solid ${slide.accent}44`,
            borderRadius: 99,
            padding: "6px 14px",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.2em",
            transition: "all 0.5s",
          }}
        >
          2024 / 25
        </div>
      </div>

      {/* Content */}
      <div
        className="ws-content"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        style={{
          position: "relative",
          zIndex: 10,
          flex: 1,
          display: "flex",
          alignItems: "center",
          padding: "0 40px",
          gap: 40,
        }}
      >
        {/* Left text */}
        <div key={`text-${displayed}`} style={{ flex: 1, maxWidth: 520, ...contentStyle }}>
          <p
            className="fade-1"
            style={{
              color: slide.accent,
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.3em",
              textTransform: "uppercase",
              marginBottom: 12,
              fontFamily: "'Barlow', sans-serif",
            }}
          >
            {slide.eyebrow}
          </p>

          <h1
            className="fade-2"
            style={{
              color: "white",
              fontSize: "clamp(52px, 8vw, 88px)",
              fontWeight: 900,
              textTransform: "uppercase",
              lineHeight: 0.92,
              marginBottom: 24,
              whiteSpace: "pre-line",
            }}
          >
            {slide.title}
          </h1>

          <p
            className="fade-3"
            style={{
              color: "#cbd5e1",
              fontSize: 16,
              fontWeight: 300,
              lineHeight: 1.7,
              marginBottom: 32,
              maxWidth: 420,
              fontFamily: "'Barlow', sans-serif",
            }}
          >
            {slide.body}
          </p>

          {/* Stat */}
          <div
            className="fade-4"
            style={{
              display: "inline-block",
              padding: "10px 18px",
              borderRadius: 12,
              border: `1px solid ${slide.accent}30`,
              background: `${slide.accent}0F`,
              marginBottom: 14,
            }}
          >
            <p
              style={{
                color: "#94a3b8",
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.2em",
                fontFamily: "'Barlow', sans-serif",
                fontWeight: 500,
              }}
            >
              {slide.stat.label}
            </p>
            <p style={{ color: "white", fontSize: 22, fontWeight: 900, marginTop: 2 }}>
              {slide.stat.value}
            </p>
          </div>

          {/* NEW: show note about first-time only */}
          <p
            className="fade-5"
            style={{
              marginTop: 10,
              color: "rgba(203, 213, 225, 0.75)",
              fontSize: 12,
              fontFamily: "'Barlow', sans-serif",
            }}
          >
            Note: This welcome screen is shown only the first time you use the app.
          </p>

          {/* NEW: only one CTA button */}
          {slide.cta && (
            <div className="fade-5" style={{ display: "flex", gap: 12, marginTop: 18 }}>
              <button
                onClick={handleGetStarted}
                style={{
                  padding: "14px 32px",
                  borderRadius: 12,
                  background: slide.accent,
                  color: "#0a0e1a",
                  fontWeight: 700,
                  fontSize: 12,
                  letterSpacing: "0.15em",
                  textTransform: "uppercase",
                  border: "none",
                  cursor: "pointer",
                  fontFamily: "'Barlow Condensed', sans-serif",
                }}
              >
                Let&apos;s get started
              </button>
            </div>
          )}
        </div>

        {/* Right icon */}
        <div
          key={`icon-${displayed}`}
          className="ws-icon"
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            ...contentStyle,
          }}
        >
          <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div
              className="pulse-ring ws-ring"
              style={{
                position: "absolute",
                width: 260,
                height: 260,
                borderRadius: "50%",
                border: `1.5px solid ${slide.accent}`,
                transition: "border-color 0.5s",
              }}
            />
            <div
              className="ws-bubble"
              style={{
                width: 180,
                height: 180,
                borderRadius: "50%",
                background: `${slide.accent}14`,
                border: `1px solid ${slide.accent}28`,
                boxShadow: `0 0 60px ${slide.accent}18`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "all 0.5s",
              }}
            >
              <span className="float-icon" style={{ fontSize: 72, userSelect: "none" }}>
                {slide.icon}
              </span>
            </div>
            <div
              style={{
                position: "absolute",
                bottom: -4,
                right: -4,
                width: 38,
                height: 38,
                borderRadius: "50%",
                background: slide.accent,
                color: "#0a0e1a",
                fontWeight: 900,
                fontSize: 14,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "background 0.5s",
              }}
            >
              {current + 1}
            </div>
          </div>
        </div>
      </div>

      {/* Footer nav */}
      <div
        className="ws-footer"
        style={{
          position: "relative",
          zIndex: 10,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 40px 32px",
        }}
      >
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {slides.map((_, idx) => (
            <button
              key={idx}
              onClick={() => goTo(idx, idx > current ? "next" : "prev")}
              style={{
                width: idx === current ? 28 : 8,
                height: 8,
                borderRadius: 99,
                border: "none",
                cursor: "pointer",
                background: idx === current ? slide.accent : "rgba(255,255,255,0.18)",
                transition: "all 0.3s ease",
                padding: 0,
              }}
            />
          ))}
        </div>

        <div
          style={{
            color: `${slide.accent}88`,
            fontSize: 11,
            letterSpacing: "0.2em",
            fontWeight: 600,
            fontFamily: "'Barlow', sans-serif",
          }}
        >
          {String(current + 1).padStart(2, "0")} / {String(slides.length).padStart(2, "0")}
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={prev}
            disabled={phase !== "idle"}
            style={{
              width: 44,
              height: 44,
              borderRadius: "50%",
              border: "1px solid rgba(255,255,255,0.18)",
              background: "transparent",
              color: "white",
              fontSize: 16,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            ←
          </button>
          <button
            onClick={next}
            disabled={phase !== "idle"}
            style={{
              width: 44,
              height: 44,
              borderRadius: "50%",
              border: "none",
              background: slide.accent,
              color: "#0a0e1a",
              fontSize: 16,
              fontWeight: 700,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "background 0.5s",
            }}
          >
            →
          </button>
        </div>
      </div>
    </div>
  );
}