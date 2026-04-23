"use client";
// src/app/app/page.tsx — Dashboard

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { useTeamGuard } from "@/lib/hooks/useTeamGuard";
import { useCountdown } from "@/lib/hooks/useCountdown";
import { ACCENT, GOLD, CHIP_DISPLAY } from "@/lib/constants";
import {
  FplEvent,
  FplFixture,
  League,
  Me,
  TeamPlayer,
  GwState,
  LiveScore,
} from "@/lib/types";

import Spinner from "@/components/ui/Spinner";
import DeadlineHero from "@/features/dashboard/DeadlineHero";
import StatCard from "@/features/dashboard/StatCard";
import MiniPitch from "@/features/dashboard/MiniPitch";
import FixtureRow from "@/features/dashboard/FixtureRow";

// ── Types local to this page ──────────────────────────────────────────────────

interface TeamData {
  id: string;
  name: string;
  budget: number;
  gameweek: number;
  season?: string;
  activeChip: string | null;
  picks: TeamPlayer[];
}

interface DashData {
  me: Me | null;
  event: FplEvent | null;
  nextEvent: FplEvent | null;
  team: TeamData | null;
  score: LiveScore | null;
  gwState: GwState | null;
  leagues: League[];
  fixtures: FplFixture[];
}

// ── Shared panel wrapper ──────────────────────────────────────────────────────

function Panel({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        background: "rgba(255,255,255,.025)",
        border: "1px solid rgba(255,255,255,.06)",
        borderRadius: 22,
        padding: 22,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function SLabel({ children, href }: { children: string; href?: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 14,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div
          style={{ width: 3, height: 16, borderRadius: 2, background: ACCENT }}
        />
        <span
          style={{
            color: "rgba(255,255,255,.5)",
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: ".3em",
            textTransform: "uppercase",
            fontFamily: "'DM Sans',sans-serif",
          }}
        >
          {children}
        </span>
      </div>
      {href && (
        <Link
          href={href}
          style={{
            color: ACCENT,
            fontSize: 9,
            fontFamily: "'DM Sans',sans-serif",
            fontWeight: 600,
            letterSpacing: ".08em",
            textDecoration: "none",
            opacity: 0.6,
          }}
        >
          View all →
        </Link>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { checking } = useTeamGuard("mustHaveTeam");
  const [data, setData] = useState<DashData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (checking) return;
    setLoading(true);
    try {
      const [meRes, eventRes, eventsRes] = await Promise.all([
        apiFetch<Me>("/auth/me").catch(() => null),
        apiFetch<FplEvent>("/fpl/events/current").catch(() => null),
        apiFetch<FplEvent[]>("/fpl/events").catch(() => null),
      ]);

      const event = eventRes ?? null;
      const allEvents = eventsRes ?? [];
      const nextEvent = event
        ? (allEvents.find((e) => e.id === event.id + 1) ?? null)
        : (allEvents.find((e) => !e.finished) ?? null);

      const [teamRes, liveRes, stateRes, leaguesRes, fixturesRes] =
        await Promise.all([
          apiFetch<{ team: TeamData | null }>("/team/me").catch(() => null),
          apiFetch<{ score: LiveScore }>("/points/me/live").catch(() => null),
          apiFetch<any>("/transfers/state").catch(() => null),
          apiFetch<{ items: League[] }>("/leagues/mine").catch(() => null),
          event
            ? apiFetch<FplFixture[]>(`/fpl/fixtures?event=${event.id}`).catch(
                () => null,
              )
            : null,
        ]);

      setData({
        me: meRes,
        event,
        nextEvent,
        team: teamRes?.team ?? null,
        score: liveRes?.score ?? null,
        gwState: stateRes?.gwState ?? null,
        leagues: leaguesRes?.items ?? [],
        fixtures: fixturesRes ?? [],
      });
    } finally {
      setLoading(false);
    }
  }, [checking]);

  useEffect(() => {
    load();
  }, [load]);

  if (checking) return null;

  const gw = data?.event;
  const nxt = data?.nextEvent;
  const team = data?.team;
  const gwState = data?.gwState;
  const score = data?.score;

  const deadlineIso = !gw?.finished
    ? (gw?.deadlineTime ?? null)
    : (nxt?.deadlineTime ?? null);
  const deadlineLabel = !gw?.finished
    ? `${gw?.name ?? "Gameweek"} Deadline`
    : nxt?.name
      ? `${nxt.name} Deadline`
      : "Next Deadline";

  const remaining = Math.max(
    0,
    (gwState?.freeTransfers ?? 1) - (gwState?.transfersMade ?? 0),
  );
  const hits = gwState?.pointsHit ?? 0;
  const budget = team ? `£${(team.budget / 10).toFixed(1)}m` : "—";

  const topPlayers = (score?.breakdown ?? [])
    .filter((p) => !p.isOnBench)
    .sort((a, b) => b.finalPoints - a.finalPoints)
    .slice(0, 5);

  return (
    <div
      style={{
        fontFamily: "'DM Sans',sans-serif",
        minHeight: "100vh",
        background: "#060b14",
        padding: "28px 28px 60px",
        position: "relative",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;600;700;800;900&display=swap');
        @keyframes spin       { to { transform: rotate(360deg); } }
        @keyframes fadeUp     { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }
        @keyframes colonBlink { 0%,100%{opacity:1} 50%{opacity:.2} }
        @keyframes urgentPulse{ 0%,100%{opacity:.6;transform:scale(1)} 50%{opacity:1;transform:scale(1.15)} }
        .d1 { animation: fadeUp .5s .00s both; }
        .d2 { animation: fadeUp .5s .08s both; }
        .d3 { animation: fadeUp .5s .15s both; }
        .d4 { animation: fadeUp .5s .22s both; }
      `}</style>

      {/* Atmospheric orbs */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 0,
          pointerEvents: "none",
          background: `radial-gradient(ellipse 60% 50% at 90% 10%, ${ACCENT}08 0%, transparent 55%), radial-gradient(ellipse 40% 40% at 5% 80%, #38bdf808 0%, transparent 50%)`,
        }}
      />

      <div
        style={{
          position: "relative",
          zIndex: 1,
          maxWidth: 1280,
          margin: "0 auto",
        }}
      >
        {/* ── Hero header ── */}
        <div
          className="d1"
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 24,
            marginBottom: 32,
            flexWrap: "wrap",
          }}
        >
          <div>
            {data?.me && (
              <div
                style={{
                  color: "rgba(255,255,255,.35)",
                  fontSize: 12,
                  fontWeight: 500,
                  letterSpacing: ".08em",
                  marginBottom: 4,
                }}
              >
                Welcome back,{" "}
                <span style={{ color: ACCENT, fontWeight: 700 }}>
                  {data.me.username}
                </span>
              </div>
            )}
            <h1
              style={{
                fontFamily: "'Bebas Neue',sans-serif",
                fontSize: "clamp(44px,6vw,76px)",
                fontWeight: 400,
                color: "white",
                margin: 0,
                lineHeight: 0.9,
                letterSpacing: ".04em",
              }}
            >
              {team?.name ?? "Dashboard"}
            </h1>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginTop: 10,
                flexWrap: "wrap",
              }}
            >
              {gw && (
                <>
                  <div
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: gw.finished ? "rgba(255,255,255,.2)" : ACCENT,
                      boxShadow: gw.finished ? "none" : `0 0 10px ${ACCENT}`,
                    }}
                  />
                  <span
                    style={{
                      color: "rgba(255,255,255,.35)",
                      fontSize: 12,
                      fontWeight: 500,
                      letterSpacing: ".06em",
                    }}
                  >
                    {gw.name} · {gw.finished ? "Finished" : "In Progress"}
                  </span>
                  {gwState?.activeChip && (
                    <span
                      style={{
                        background: "rgba(245,200,66,.12)",
                        border: "1px solid rgba(245,200,66,.3)",
                        color: GOLD,
                        fontSize: 9,
                        fontWeight: 700,
                        letterSpacing: ".15em",
                        borderRadius: 6,
                        padding: "2px 8px",
                        textTransform: "uppercase",
                      }}
                    >
                      {gwState.activeChip.replace(/_/g, " ")}
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
          <DeadlineHero
            iso={deadlineIso}
            label={deadlineLabel}
            gwName={nxt?.name ?? gw?.name ?? ""}
          />
        </div>

        {loading ? (
          <Spinner label="Loading dashboard…" />
        ) : (
          <>
            {/* ── KPI strip ── */}
            <div
              className="d2"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                gap: 12,
                marginBottom: 28,
              }}
            >
              <StatCard
                label="GW Points"
                value={score?.finalPoints ?? "—"}
                accent
                href="/app/points"
                sub={gw?.name}
              />
              <StatCard
                label="Free Transfers"
                value={remaining}
                href="/app/transfers"
                sub={`${gwState?.transfersMade ?? 0} made this GW`}
              />
              <StatCard
                label="Bank"
                value={budget}
                sub={team?.season ?? "2025-26"}
              />
              {hits > 0 && (
                <StatCard
                  label="Hit Deduction"
                  value={`−${hits}`}
                  warn
                  sub="points this GW"
                />
              )}
            </div>

            {/* ── Main 3-col grid ── */}
            <div
              className="d3"
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 340px",
                gap: 16,
                alignItems: "start",
              }}
            >
              {/* Col 1: Squad */}
              <Panel>
                <SLabel href="/app/team">My Squad</SLabel>
                <MiniPitch picks={team?.picks ?? []} />
              </Panel>

              {/* Col 2: Fixtures + Live points */}
              <div
                style={{ display: "flex", flexDirection: "column", gap: 16 }}
              >
                <Panel>
                  <SLabel href="/app/fixtures">{`${gw?.name ?? "GW"} Fixtures`}</SLabel>
                  {data?.fixtures?.length ? (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                      }}
                    >
                      {data.fixtures.slice(0, 7).map((f) => (
                        <FixtureRow key={f.id} f={f} />
                      ))}
                    </div>
                  ) : (
                    <div
                      style={{
                        color: "rgba(255,255,255,.18)",
                        fontSize: 12,
                        textAlign: "center",
                        padding: "16px 0",
                      }}
                    >
                      No fixtures this gameweek
                    </div>
                  )}
                </Panel>

                <Panel>
                  <SLabel href="/app/points">Live Points</SLabel>
                  {topPlayers.length ? (
                    <>
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 5,
                        }}
                      >
                        {topPlayers.map((p: any) => (
                          <div
                            key={p.playerId}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              padding: "8px 12px",
                              borderRadius: 10,
                              background: p.isCaptain
                                ? `${GOLD}08`
                                : "rgba(255,255,255,.025)",
                              border: `1px solid ${p.isCaptain ? GOLD + "22" : "rgba(255,255,255,.05)"}`,
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                              }}
                            >
                              {p.isCaptain && (
                                <div
                                  style={{
                                    width: 16,
                                    height: 16,
                                    borderRadius: "50%",
                                    background: `linear-gradient(135deg,${GOLD},#fbbf24)`,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    fontSize: 7,
                                    fontWeight: 900,
                                    color: "#0a0e1a",
                                  }}
                                >
                                  C
                                </div>
                              )}
                              <span
                                style={{
                                  color: "rgba(255,255,255,.8)",
                                  fontSize: 12,
                                  fontWeight: 600,
                                }}
                              >
                                {p.webName}
                              </span>
                            </div>
                            <span
                              style={{
                                fontFamily: "'Bebas Neue',sans-serif",
                                fontSize: 18,
                                letterSpacing: ".04em",
                                color:
                                  p.finalPoints > 0
                                    ? ACCENT
                                    : "rgba(255,255,255,.2)",
                              }}
                            >
                              {p.finalPoints}
                            </span>
                          </div>
                        ))}
                      </div>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginTop: 12,
                          paddingTop: 12,
                          borderTop: "1px solid rgba(255,255,255,.06)",
                        }}
                      >
                        <span
                          style={{
                            color: "rgba(255,255,255,.3)",
                            fontSize: 10,
                          }}
                        >
                          GW Total
                        </span>
                        <span
                          style={{
                            fontFamily: "'Bebas Neue',sans-serif",
                            fontSize: 28,
                            color: ACCENT,
                            letterSpacing: ".04em",
                          }}
                        >
                          {score?.finalPoints ?? 0}
                        </span>
                      </div>
                    </>
                  ) : (
                    <div
                      style={{
                        color: "rgba(255,255,255,.18)",
                        fontSize: 12,
                        textAlign: "center",
                        padding: "16px 0",
                      }}
                    >
                      No live data yet
                    </div>
                  )}
                </Panel>
              </div>

              {/* Col 3: Transfers + Leagues */}
              <div
                style={{ display: "flex", flexDirection: "column", gap: 16 }}
              >
                <Panel>
                  <SLabel href="/app/transfers">Transfers</SLabel>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    {[
                      {
                        label: "Free Transfers",
                        val: `${remaining} remaining`,
                        col: remaining > 0 ? ACCENT : "rgba(255,255,255,.4)",
                      },
                      {
                        label: "Transfers Made",
                        val: gwState?.transfersMade ?? 0,
                        col: "rgba(255,255,255,.7)",
                      },
                      {
                        label: "Points Hit",
                        val: hits > 0 ? `−${hits} pts` : "None",
                        col: hits > 0 ? "#ef4444" : "rgba(255,255,255,.25)",
                      },
                      {
                        label: "Bank",
                        val: budget,
                        col: "rgba(255,255,255,.7)",
                      },
                    ].map(({ label, val, col }, i, arr) => (
                      <div
                        key={label}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          padding: "11px 0",
                          borderBottom:
                            i < arr.length - 1
                              ? "1px solid rgba(255,255,255,.04)"
                              : "none",
                        }}
                      >
                        <span
                          style={{
                            color: "rgba(255,255,255,.28)",
                            fontSize: 11,
                          }}
                        >
                          {label}
                        </span>
                        <span
                          style={{ color: col, fontSize: 14, fontWeight: 700 }}
                        >
                          {val}
                        </span>
                      </div>
                    ))}
                  </div>
                </Panel>

                <Panel>
                  <SLabel href="/app/leagues">Leagues</SLabel>
                  {data?.leagues?.length ? (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                      }}
                    >
                      {data.leagues.slice(0, 4).map((l) => (
                        <Link
                          key={l.id}
                          href="/app/leagues"
                          style={{ textDecoration: "none" }}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              padding: "10px 12px",
                              borderRadius: 12,
                              background: "rgba(255,255,255,.02)",
                              border: "1px solid rgba(255,255,255,.05)",
                              transition: "all .18s",
                            }}
                          >
                            <div>
                              <div
                                style={{
                                  color: "rgba(255,255,255,.82)",
                                  fontSize: 12,
                                  fontWeight: 600,
                                  marginBottom: 2,
                                }}
                              >
                                {l.name}
                              </div>
                              <div
                                style={{
                                  color: "rgba(255,255,255,.22)",
                                  fontSize: 9,
                                  letterSpacing: ".1em",
                                  textTransform: "uppercase",
                                }}
                              >
                                {l.type === "CLASSIC" ? "Classic" : "H2H"}
                              </div>
                            </div>
                            <div
                              style={{
                                background: "rgba(255,255,255,.04)",
                                border: "1px solid rgba(255,255,255,.08)",
                                borderRadius: 6,
                                padding: "3px 8px",
                                color: "rgba(255,255,255,.3)",
                                fontSize: 9,
                                letterSpacing: ".12em",
                              }}
                            >
                              {l.code}
                            </div>
                          </div>
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <div style={{ textAlign: "center", padding: "8px 0 4px" }}>
                      <div
                        style={{
                          color: "rgba(255,255,255,.18)",
                          fontSize: 12,
                          marginBottom: 12,
                        }}
                      >
                        No leagues yet
                      </div>
                      <Link
                        href="/app/leagues"
                        style={{
                          display: "block",
                          padding: "10px",
                          borderRadius: 10,
                          border: `1px solid ${ACCENT}33`,
                          background: `${ACCENT}0d`,
                          color: ACCENT,
                          fontSize: 11,
                          fontWeight: 700,
                          letterSpacing: ".15em",
                          textTransform: "uppercase",
                          textDecoration: "none",
                        }}
                      >
                        + Create or Join
                      </Link>
                    </div>
                  )}
                </Panel>
              </div>
            </div>

            {/* ── Quick nav ── */}
            <div
              className="d4"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: 12,
                marginTop: 20,
              }}
            >
              {[
                {
                  href: "/app/team",
                  label: "My Team",
                  icon: "⚽",
                  desc: "Manage squad & chips",
                },
                {
                  href: "/app/transfers",
                  label: "Transfers",
                  icon: "↔",
                  desc: "Buy & sell players",
                },
                {
                  href: "/app/fixtures",
                  label: "Fixtures",
                  icon: "📅",
                  desc: "Match schedule",
                },
                {
                  href: "/app/points",
                  label: "Points",
                  icon: "◎",
                  desc: "GW breakdown",
                },
              ].map(({ href, label, icon, desc }) => (
                <Link key={href} href={href} style={{ textDecoration: "none" }}>
                  <div
                    style={{
                      padding: "18px 20px",
                      borderRadius: 18,
                      background: "rgba(255,255,255,.025)",
                      border: "1px solid rgba(255,255,255,.06)",
                      transition: "all .22s",
                    }}
                  >
                    <div style={{ fontSize: 24, marginBottom: 10 }}>{icon}</div>
                    <div
                      style={{
                        color: "white",
                        fontSize: 14,
                        fontWeight: 700,
                        marginBottom: 4,
                      }}
                    >
                      {label}
                    </div>
                    <div
                      style={{ color: "rgba(255,255,255,.25)", fontSize: 10 }}
                    >
                      {desc}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
