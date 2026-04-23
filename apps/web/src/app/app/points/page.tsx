"use client";
// src/app/app/points/page.tsx

import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { useTeamGuard } from "@/lib/hooks/useTeamGuard";
import { ACCENT, CHIP_DISPLAY } from "@/lib/constants";
import { LiveSnapshot, HistoryScore } from "@/lib/types";
import "./page.css";

import Spinner from "@/components/ui/Spinner";
import StatBox from "@/features/points/StatBox";
import HistoryBar from "@/features/points/HistoryBar";
import PointsPitch from "@/features/points/PointsPitch";

export default function PointsPage() {
  const { checking } = useTeamGuard("mustHaveTeam");

  const [live, setLive] = useState<LiveSnapshot | null>(null);
  const [history, setHistory] = useState<HistoryScore[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"live" | "history">("live");

  const load = useCallback(async () => {
    if (checking) return;
    setLoading(true);
    try {
      const [liveRes, histRes] = await Promise.all([
        apiFetch<LiveSnapshot>("/points/me/live").catch(() => null),
        apiFetch<{ items: HistoryScore[] }>("/points/me/history").catch(
          () => null,
        ),
      ]);
      if (liveRes) setLive(liveRes);
      setHistory(histRes?.items ?? []);
    } finally {
      setLoading(false);
    }
  }, [checking]);

  useEffect(() => {
    load();
  }, [load]);

  if (checking) return null;

  const score = live?.score;
  const seasonTotal = history.reduce((s, g) => s + g.finalPoints, 0);
  const avg = history.length ? Math.round(seasonTotal / history.length) : 0;
  const best = history.reduce<HistoryScore | null>(
    (b, g) => (g.finalPoints > (b?.finalPoints ?? -1) ? g : b),
    null,
  );

  return (
    <div
      style={{
        fontFamily: "'Barlow Condensed','Impact',sans-serif",
        minHeight: "100vh",
        background: "#0a0e1a",
        padding: "22px 26px 48px",
      }}
    >

      <div
        style={{
          position: "fixed",
          inset: 0,
          pointerEvents: "none",
          zIndex: 0,
          background: `radial-gradient(ellipse 55% 45% at 75% 20%, ${ACCENT}06 0%, transparent 60%)`,
        }}
      />
      <div
        style={{
          position: "relative",
          zIndex: 1,
          maxWidth: 860,
          margin: "0 auto",
        }}
      >
        {/* Header */}
        <div className="pa" style={{ marginBottom: 22 }}>
          <div
            style={{
              color: ACCENT,
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: ".38em",
              textTransform: "uppercase",
              fontFamily: "'Barlow',sans-serif",
              marginBottom: 3,
            }}
          >
            Performance
          </div>
          <h1
            style={{
              color: "white",
              fontSize: 34,
              fontWeight: 900,
              textTransform: "uppercase",
              margin: 0,
              lineHeight: 0.95,
            }}
          >
            Points
          </h1>
          {live?.team && (
            <div
              style={{
                color: "rgba(255,255,255,.3)",
                fontSize: 11,
                fontFamily: "'Barlow',sans-serif",
                marginTop: 4,
              }}
            >
              {live.team.name} · GW{live.gameweek}
            </div>
          )}
        </div>

        {/* Stat boxes */}
        <div
          className="pa2"
          style={{
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            marginBottom: 22,
          }}
        >
          <StatBox
            label="GW Points"
            value={score?.finalPoints ?? "—"}
            accent
            sub={live ? `GW${live.gameweek}` : undefined}
          />
          <StatBox
            label="Raw Points"
            value={score?.pointsBeforeHits ?? "—"}
            sub="before hits"
          />
          <StatBox label="Bench Points" value={score?.benchPoints ?? "—"} />
          <StatBox label="Season Total" value={seasonTotal} />
          <StatBox label="Average" value={avg} sub="per gameweek" />
          {best && (
            <StatBox
              label="Best GW"
              value={best.finalPoints}
              sub={`GW${best.gameweek}`}
            />
          )}
          {(score?.pointsHit ?? 0) > 0 && (
            <StatBox
              label="Hit Deduction"
              value={`−${score!.pointsHit}`}
              warn
            />
          )}
          {score?.chipPlayed &&
            (() => {
              const cd = CHIP_DISPLAY[score.chipPlayed];
              return cd ? (
                <StatBox label="Chip" value={cd.label} sub="active" />
              ) : null;
            })()}
        </div>

        {/* Tabs */}
        <div
          className="pa2"
          style={{ display: "flex", gap: 4, marginBottom: 18 }}
        >
          {(["live", "history"] as const).map((t) => {
            const on = tab === t;
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  padding: "8px 20px",
                  borderRadius: 9,
                  border: `1px solid ${on ? ACCENT + "44" : "rgba(255,255,255,.08)"}`,
                  background: on ? `${ACCENT}14` : "rgba(255,255,255,.03)",
                  color: on ? ACCENT : "rgba(255,255,255,.4)",
                  fontFamily: "'Barlow Condensed',sans-serif",
                  fontWeight: 700,
                  fontSize: 12,
                  letterSpacing: ".1em",
                  textTransform: "uppercase",
                  cursor: "pointer",
                  transition: "all .18s",
                }}
              >
                {t === "live" ? "⚡ Live / Current" : "📊 History"}
              </button>
            );
          })}
        </div>

        {loading && <Spinner label="Loading…" />}

        {/* Live tab */}
        {!loading && tab === "live" && (
          <div
            className="pa3"
            style={{ display: "flex", flexDirection: "column", gap: 14 }}
          >
            {score ? (
              <>
                {/* Pitch visualization */}
                <PointsPitch breakdown={score.breakdown} />

                <div
                  style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    gap: 22,
                    padding: "12px 14px 0",
                    borderTop: "1px solid rgba(255,255,255,.06)",
                    marginTop: 6,
                  }}
                >
                  {score.pointsBeforeHits - score.finalPoints > 0 && (
                    <div style={{ textAlign: "right" }}>
                      <div
                        style={{
                          color: "rgba(255,255,255,.28)",
                          fontSize: 8,
                          fontFamily: "'Barlow',sans-serif",
                        }}
                      >
                        Transfer hits
                      </div>
                      <div
                        style={{
                          color: "#ef4444",
                          fontSize: 14,
                          fontWeight: 900,
                        }}
                      >
                        −{score.pointsHit}
                      </div>
                    </div>
                  )}
                  <div style={{ textAlign: "right" }}>
                    <div
                      style={{
                        color: "rgba(255,255,255,.28)",
                        fontSize: 8,
                        fontFamily: "'Barlow',sans-serif",
                      }}
                    >
                      Total
                    </div>
                    <div
                      style={{
                        color: ACCENT,
                        fontSize: 28,
                        fontWeight: 900,
                        lineHeight: 1,
                      }}
                    >
                      {score.finalPoints}
                    </div>
                  </div>
                </div>

                {live && (
                  <div
                    style={{
                      color: "rgba(255,255,255,.18)",
                      fontSize: 9,
                      fontFamily: "'Barlow',sans-serif",
                      textAlign: "right",
                      paddingRight: 14,
                      marginTop: 4,
                    }}
                  >
                    Updated {new Date(live.polledAt).toLocaleTimeString()}
                  </div>
                )}
              </>
            ) : (
              <div
                style={{
                  padding: "48px 0",
                  textAlign: "center",
                  color: "rgba(255,255,255,.2)",
                  fontFamily: "'Barlow',sans-serif",
                  fontSize: 13,
                }}
              >
                No points available yet.
              </div>
            )}
          </div>
        )}

        {/* History tab */}
        {!loading && tab === "history" && (
          <div
            className="pa3"
            style={{ display: "flex", flexDirection: "column", gap: 14 }}
          >
            {history.length ? (
              <>
                <div
                  style={{
                    background: "rgba(255,255,255,.03)",
                    border: "1px solid rgba(255,255,255,.07)",
                    borderRadius: 14,
                    padding: "18px 16px 12px",
                  }}
                >
                  <div
                    style={{
                      color: "rgba(255,255,255,.28)",
                      fontSize: 9,
                      fontWeight: 700,
                      letterSpacing: ".2em",
                      textTransform: "uppercase",
                      fontFamily: "'Barlow',sans-serif",
                      marginBottom: 12,
                    }}
                  >
                    Points per gameweek
                  </div>
                  <HistoryBar scores={history} />
                </div>
                <div
                  style={{
                    background: "rgba(255,255,255,.03)",
                    border: "1px solid rgba(255,255,255,.07)",
                    borderRadius: 14,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "52px 1fr 68px 68px 68px",
                      gap: 8,
                      padding: "10px 16px",
                      borderBottom: "1px solid rgba(255,255,255,.06)",
                      background: "rgba(255,255,255,.025)",
                    }}
                  >
                    {["GW", "Chip", "Hits", "Bench", "Pts"].map((h) => (
                      <div
                        key={h}
                        style={{
                          color: "rgba(255,255,255,.28)",
                          fontSize: 8,
                          fontWeight: 700,
                          letterSpacing: ".15em",
                          textTransform: "uppercase",
                          fontFamily: "'Barlow',sans-serif",
                          textAlign: "right",
                        }}
                      >
                        {h}
                      </div>
                    ))}
                  </div>
                  {[...history].reverse().map((s) => {
                    const cd = s.chipPlayed ? CHIP_DISPLAY[s.chipPlayed] : null;
                    return (
                      <div
                        key={s.id}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "52px 1fr 68px 68px 68px",
                          gap: 8,
                          padding: "9px 16px",
                          borderBottom: "1px solid rgba(255,255,255,.04)",
                          alignItems: "center",
                        }}
                      >
                        <div
                          style={{
                            color: "rgba(255,255,255,.5)",
                            fontSize: 11,
                            fontWeight: 700,
                            textAlign: "right",
                          }}
                        >
                          GW{s.gameweek}
                        </div>
                        <div
                          style={{
                            color: cd ? cd.color : "rgba(255,255,255,.15)",
                            fontSize: 10,
                            fontFamily: "'Barlow',sans-serif",
                          }}
                        >
                          {cd ? cd.label : "—"}
                        </div>
                        <div
                          style={{
                            color: s.transferHits
                              ? "#ef4444"
                              : "rgba(255,255,255,.2)",
                            fontSize: 11,
                            fontWeight: 700,
                            textAlign: "right",
                          }}
                        >
                          {s.transferHits ? `−${s.transferHits * 4}` : "—"}
                        </div>
                        <div
                          style={{
                            color: "rgba(255,255,255,.35)",
                            fontSize: 11,
                            textAlign: "right",
                            fontFamily: "'Barlow',sans-serif",
                          }}
                        >
                          {s.benchPoints}
                        </div>
                        <div
                          style={{
                            color: ACCENT,
                            fontSize: 15,
                            fontWeight: 900,
                            textAlign: "right",
                          }}
                        >
                          {s.finalPoints}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <div
                style={{
                  padding: "48px 0",
                  textAlign: "center",
                  color: "rgba(255,255,255,.2)",
                  fontFamily: "'Barlow',sans-serif",
                  fontSize: 13,
                }}
              >
                No history yet.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
