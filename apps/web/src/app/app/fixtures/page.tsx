"use client";

import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import "./page.css";

// ── Types ─────────────────────────────────────────────────────────────────────
interface FplTeam {
  id: number;
  name: string;
  shortName: string;
}

interface FplEvent {
  id: number;
  name: string;
  deadlineTime: string | null;
  finished: boolean | null;
  isCurrent: boolean | null;
}

interface FplFixture {
  id: number;
  event: number | null;
  kickoffTime: string | null;
  teamHId: number;
  teamAId: number;
  teamHScore: number | null;
  teamAScore: number | null;
  finished: boolean | null;
  started: boolean | null;
  teamH: FplTeam;
  teamA: FplTeam;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const ACCENT = "#00FF87";

function groupByDate(fixtures: FplFixture[]): Map<string, FplFixture[]> {
  const map = new Map<string, FplFixture[]>();
  for (const f of fixtures) {
    const key = f.kickoffTime
      ? new Date(f.kickoffTime).toLocaleDateString("en-GB", {
          weekday: "long",
          day: "numeric",
          month: "long",
        })
      : "Date TBC";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(f);
  }
  return map;
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function FixturesPage() {
  const [events, setEvents] = useState<FplEvent[]>([]);
  const [teams, setTeams] = useState<FplTeam[]>([]);
  const [fixtures, setFixtures] = useState<FplFixture[]>([]);
  const [selectedGw, setSelectedGw] = useState<number | null>(null);
  const [selectedTeam, setSelectedTeam] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load events + teams once on mount
  useEffect(() => {
    Promise.all([
      apiFetch<FplEvent[]>("/fpl/events"),
      apiFetch<FplTeam[]>("/fpl/teams"),
    ])
      .then(([evts, tms]) => {
        setEvents(evts);
        setTeams(tms);
        const current = evts.find((e) => e.isCurrent);
        setSelectedGw(current?.id ?? evts[0]?.id ?? null);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  // Reload fixtures whenever GW or team filter changes
  const loadFixtures = useCallback(async () => {
    if (selectedGw === null) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ event: String(selectedGw) });
      if (selectedTeam) params.set("teamId", String(selectedTeam));
      const data = await apiFetch<FplFixture[]>(`/fpl/fixtures?${params}`);
      setFixtures(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [selectedGw, selectedTeam]);

  useEffect(() => {
    loadFixtures();
  }, [loadFixtures]);

  const grouped = groupByDate(fixtures);

  return (
    <div
      style={{
        fontFamily: "'Barlow Condensed','Impact',sans-serif",
        minHeight: "100vh",
        background: "#0a0e1a",
        display: "flex",
        flexDirection: "column",
        position: "relative",
        ['--accent' as any]: ACCENT,
        ['--accent-18' as any]: `${ACCENT}18`,
        ['--accent-44' as any]: `${ACCENT}44`,
      }}
    >

      {/* Background */}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        <svg
          width="100%"
          height="100%"
          viewBox="0 0 1200 800"
          preserveAspectRatio="xMidYMid slice"
          style={{ opacity: 0.03 }}
        >
          <ellipse
            cx="600"
            cy="400"
            rx="300"
            ry="200"
            fill="none"
            stroke="white"
            strokeWidth="2"
          />
          <circle
            cx="600"
            cy="400"
            r="28"
            fill="none"
            stroke="white"
            strokeWidth="2"
          />
          <line
            x1="600"
            y1="0"
            x2="600"
            y2="800"
            stroke="white"
            strokeWidth="1.5"
          />
          <rect
            x="60"
            y="240"
            width="100"
            height="320"
            fill="none"
            stroke="white"
            strokeWidth="1.5"
          />
          <rect
            x="1040"
            y="240"
            width="100"
            height="320"
            fill="none"
            stroke="white"
            strokeWidth="1.5"
          />
        </svg>
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: `radial-gradient(ellipse 55% 45% at 80% 15%, ${ACCENT}0E 0%, transparent 60%)`,
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 3,
            background: ACCENT,
          }}
        />
      </div>

      {/* Header */}
      <div
        className="fade-1"
        style={{
          position: "relative",
          zIndex: 10,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "22px 32px 16px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              background: ACCENT,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 900,
              fontSize: 14,
              color: "#0a0e1a",
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
            color: `${ACCENT}88`,
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.2em",
            border: `1px solid ${ACCENT}33`,
            borderRadius: 99,
            padding: "6px 14px",
            fontFamily: "'Barlow',sans-serif",
          }}
        >
          Fixtures
        </div>
      </div>

      {/* Title */}
      <div
        className="fade-2"
        style={{ position: "relative", zIndex: 10, padding: "4px 32px 24px" }}
      >
        <p
          style={{
            color: ACCENT,
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.3em",
            textTransform: "uppercase",
            fontFamily: "'Barlow',sans-serif",
            marginBottom: 6,
          }}
        >
          Premier League
        </p>
        <h1
          style={{
            color: "white",
            fontSize: "clamp(36px,5vw,58px)",
            fontWeight: 900,
            textTransform: "uppercase",
            lineHeight: 0.92,
            margin: 0,
          }}
        >
          Fixtures
        </h1>
      </div>

      {/* Filters */}
      <div
        className="fade-3"
        style={{
          position: "relative",
          zIndex: 10,
          padding: "0 32px 24px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        {/* Gameweek strip */}
        <div
          style={{
            display: "flex",
            gap: 6,
            overflowX: "auto",
            paddingBottom: 4,
          }}
        >
          {events.map((ev) => (
            <button
              key={ev.id}
              className={`gw-btn${selectedGw === ev.id ? " active" : ""}`}
              onClick={() => setSelectedGw(ev.id)}
            >
              GW{ev.id}
              {ev.isCurrent && (
                <span style={{ marginLeft: 4, fontSize: 8, color: ACCENT }}>
                  ●
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Team filter + result count */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <select
            className="team-select"
            value={selectedTeam}
            onChange={(e) => setSelectedTeam(Number(e.target.value))}
          >
            <option value={0}>All clubs</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>

          {selectedTeam > 0 && (
            <button
              onClick={() => setSelectedTeam(0)}
              style={{
                background: "none",
                border: "none",
                color: `${ACCENT}88`,
                cursor: "pointer",
                fontSize: 11,
                fontFamily: "'Barlow',sans-serif",
                letterSpacing: "0.1em",
              }}
            >
              ✕ Clear
            </button>
          )}

          <span
            style={{
              color: "#475569",
              fontSize: 11,
              fontFamily: "'Barlow',sans-serif",
              marginLeft: "auto",
            }}
          >
            {!loading &&
              `${fixtures.length} fixture${fixtures.length !== 1 ? "s" : ""}`}
          </span>
        </div>
      </div>

      {/* Content */}
      <div
        style={{
          position: "relative",
          zIndex: 10,
          flex: 1,
          padding: "0 32px 32px",
        }}
      >
        {error && (
          <div
            style={{
              padding: "14px 18px",
              borderRadius: 12,
              background: "rgba(239,68,68,.1)",
              border: "1px solid rgba(239,68,68,.3)",
              color: "#fca5a5",
              fontFamily: "'Barlow',sans-serif",
              fontSize: 14,
              marginBottom: 16,
            }}
          >
            ⚠️ {error}
          </div>
        )}

        {loading && !error && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[...Array(6)].map((_, i) => (
              <div key={i} className="skeleton" style={{ height: 62 }} />
            ))}
          </div>
        )}

        {!loading && !error && fixtures.length === 0 && (
          <div
            style={{
              textAlign: "center",
              padding: "60px 0",
              color: "#475569",
              fontFamily: "'Barlow',sans-serif",
            }}
          >
            No fixtures found for this gameweek.
          </div>
        )}

        {!loading &&
          !error &&
          [...grouped.entries()].map(([dateLabel, dayFixtures]) => (
            <div key={dateLabel} style={{ marginBottom: 28 }}>
              {/* Date divider */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  marginBottom: 10,
                }}
              >
                <span
                  style={{
                    color: "#94a3b8",
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: "0.2em",
                    textTransform: "uppercase",
                    fontFamily: "'Barlow',sans-serif",
                    flexShrink: 0,
                  }}
                >
                  {dateLabel}
                </span>
                <div
                  style={{
                    flex: 1,
                    height: 1,
                    background: "rgba(255,255,255,.06)",
                  }}
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {dayFixtures.map((f) => (
                  <div key={f.id} className="fixture-row">
                    {/* Home */}
                    <div
                      style={{
                        flex: 1,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "flex-end",
                        gap: 10,
                      }}
                    >
                      <span
                        style={{
                          color: "white",
                          fontSize: 15,
                          fontWeight: 800,
                          letterSpacing: "0.03em",
                        }}
                      >
                        {f.teamH.name}
                      </span>
                      <span
                        style={{
                          color: "#475569",
                          fontSize: 11,
                          fontWeight: 700,
                          background: "rgba(255,255,255,.06)",
                          padding: "3px 8px",
                          borderRadius: 6,
                        }}
                      >
                        {f.teamH.shortName}
                      </span>
                    </div>

                    {/* Score / time */}
                    <div
                      style={{
                        width: 110,
                        textAlign: "center",
                        flexShrink: 0,
                        padding: "0 8px",
                      }}
                    >
                      {f.finished ? (
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: 10,
                          }}
                        >
                          <span
                            style={{
                              color:
                                (f.teamHScore ?? 0) > (f.teamAScore ?? 0)
                                  ? ACCENT
                                  : "white",
                              fontSize: 22,
                              fontWeight: 900,
                              lineHeight: 1,
                            }}
                          >
                            {f.teamHScore}
                          </span>
                          <span style={{ color: "#334155", fontSize: 12 }}>
                            –
                          </span>
                          <span
                            style={{
                              color:
                                (f.teamAScore ?? 0) > (f.teamHScore ?? 0)
                                  ? ACCENT
                                  : "white",
                              fontSize: 22,
                              fontWeight: 900,
                              lineHeight: 1,
                            }}
                          >
                            {f.teamAScore}
                          </span>
                        </div>
                      ) : f.started ? (
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: 6,
                          }}
                        >
                          <div className="live-dot" />
                          <span
                            style={{
                              color: "#ef4444",
                              fontSize: 13,
                              fontWeight: 700,
                            }}
                          >
                            LIVE
                          </span>
                        </div>
                      ) : (
                        <span
                          style={{
                            color: "#64748b",
                            fontSize: 12,
                            fontFamily: "'Barlow',sans-serif",
                          }}
                        >
                          {f.kickoffTime
                            ? new Date(f.kickoffTime).toLocaleTimeString(
                                "en-GB",
                                { hour: "2-digit", minute: "2-digit" },
                              )
                            : "TBC"}
                        </span>
                      )}
                    </div>

                    {/* Away */}
                    <div
                      style={{
                        flex: 1,
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                      }}
                    >
                      <span
                        style={{
                          color: "#475569",
                          fontSize: 11,
                          fontWeight: 700,
                          background: "rgba(255,255,255,.06)",
                          padding: "3px 8px",
                          borderRadius: 6,
                        }}
                      >
                        {f.teamA.shortName}
                      </span>
                      <span
                        style={{
                          color: "white",
                          fontSize: 15,
                          fontWeight: 800,
                          letterSpacing: "0.03em",
                        }}
                      >
                        {f.teamA.name}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
