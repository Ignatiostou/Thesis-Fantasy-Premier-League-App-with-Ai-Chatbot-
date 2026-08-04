"use client";
// src/app/app/team/page.tsx

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { useTeamGuard } from "@/lib/hooks/useTeamGuard";
import "./page.css";
import { ACCENT, POS_COLOR, POS_LABEL } from "@/lib/constants";
import { TeamPlayer, UserTeam, ChipAvailability } from "@/lib/types";

import Spinner from "@/components/ui/Spinner";
import PitchSvg from "@/components/ui/PitchSvg";
import PlayerSlot, {
  canSwap,
  legalFormation,
} from "@/features/team/PlayerSlot";
import ContextMenu from "@/features/team/ContextMenu";
import ChipCard from "@/features/team/ChipCard";

const CHIP_DEFS = [
  {
    key: "WILDCARD",
    name: "Wildcard",
    icon: "♻️",
    desc: "Unlimited free transfers this GW. Usable twice per season.",
  },
  {
    key: "BENCH_BOOST",
    name: "Bench Boost",
    icon: "📈",
    desc: "Bench players' points count toward your GW total.",
  },
  {
    key: "TRIPLE_CAPTAIN",
    name: "Triple Captain",
    icon: "3️⃣",
    desc: "Captain scores 3× points instead of 2×.",
  },
  {
    key: "FREE_HIT",
    name: "Free Hit",
    icon: "🎯",
    desc: "One-GW wildcard — squad reverts at the next deadline.",
  },
] as const;

export default function MyTeamPage() {
  const router = useRouter();
  const { checking } = useTeamGuard("mustHaveTeam");

  // ── State (all hooks before any return) ───────────────────────────────────
  const [team, setTeam] = useState<UserTeam | null>(null);
  const [picks, setPicks] = useState<TeamPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [ctx, setCtx] = useState<{
    player: TeamPlayer;
    x: number;
    y: number;
  } | null>(null);
  const [subMode, setSubMode] = useState(false);
  const [subSrc, setSubSrc] = useState<TeamPlayer | null>(null);
  const [chip, setChip] = useState<string | null>(null);
  const [chipAvail, setChipAvail] = useState<ChipAvailability>({
    WILDCARD: true,
    BENCH_BOOST: true,
    TRIPLE_CAPTAIN: true,
    FREE_HIT: true,
  });
  const [chipPlaying, setChipPlaying] = useState(false);
  const [chipErr, setChipErr] = useState<string | null>(null);
  const [draggedPlayer, setDraggedPlayer] = useState<TeamPlayer | null>(null);
  const [dragOverPlayer, setDragOverPlayer] = useState<TeamPlayer | null>(null);

  // ── Data fetch ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (checking) return;
    let alive = true;
    (async () => {
      try {
        const [d, chipRes] = await Promise.all([
          apiFetch<{ team: UserTeam | null }>("/team/me"),
          apiFetch<{
            success: boolean;
            data: { played: any[]; available: ChipAvailability };
          }>("/chips/status").catch(() => null),
        ]);
        if (!alive) return;
        if (d.team) {
          setTeam(d.team);
          setPicks(d.team.picks ?? []);
          setChip(d.team.activeChip ?? null);
        }
        if (chipRes?.data?.available) setChipAvail(chipRes.data.available);
      } catch {
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [checking]);

  // ── Close ctx menu on outside click ──────────────────────────────────────
  useEffect(() => {
    const h = () => setCtx(null);
    window.addEventListener("click", h);
    return () => window.removeEventListener("click", h);
  }, []);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const onSlotClick = useCallback(
    (player: TeamPlayer, e: React.MouseEvent) => {
      e.stopPropagation();
      if (subMode && subSrc) {
        if (player.id === subSrc.id) {
          setSubMode(false);
          setSubSrc(null);
          return;
        }
        if (canSwap(subSrc, player)) {
          const nx = picks.map((p) => {
            if (p.id === subSrc.id)
              return {
                ...p,
                isOnBench: player.isOnBench,
                benchOrder: player.isOnBench ? player.benchOrder : null,
              };
            if (p.id === player.id)
              return {
                ...p,
                isOnBench: subSrc.isOnBench,
                benchOrder: subSrc.isOnBench ? subSrc.benchOrder : null,
              };
            return p;
          });
          if (legalFormation(nx)) {
            setPicks(nx);
            setDirty(true);
          }
        }
        setSubMode(false);
        setSubSrc(null);
        return;
      }
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setCtx({ player, x: rect.left, y: rect.bottom + 8 });
    },
    [subMode, subSrc, picks],
  );

  const onAction = useCallback((a: string, player: TeamPlayer) => {
    setCtx(null);
    if (a === "cancel") return;
    if (a === "captain") {
      setPicks((prev) =>
        prev.map((p) => ({
          ...p,
          isCaptain: p.id === player.id ? !p.isCaptain : false,
          isViceCaptain:
            p.id === player.id && !p.isCaptain ? false : p.isViceCaptain,
        })),
      );
      setDirty(true);
    }
    if (a === "vice_captain") {
      setPicks((prev) =>
        prev.map((p) => ({
          ...p,
          isViceCaptain: p.id === player.id ? !p.isViceCaptain : false,
          isCaptain:
            p.id === player.id && !p.isViceCaptain ? false : p.isCaptain,
        })),
      );
      setDirty(true);
    }
    if (a === "sub") {
      setSubMode(true);
      setSubSrc(player);
    }
  }, []);

  // ── Drag handlers ─────────────────────────────────────────────────────────
  const handleDragStart = useCallback((player: TeamPlayer, e: React.DragEvent) => {
    e.stopPropagation();
    setDraggedPlayer(player);
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(player.id));
    }
  }, []);

  const handleDragOver = useCallback(
    (player: TeamPlayer, e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!draggedPlayer || draggedPlayer.id === player.id) return;
      if (canSwap(draggedPlayer, player)) {
        setDragOverPlayer(player);
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      } else {
        if (e.dataTransfer) e.dataTransfer.dropEffect = "none";
      }
    },
    [draggedPlayer],
  );

  const handleDragLeave = useCallback((player: TeamPlayer, e: React.DragEvent) => {
    e.stopPropagation();
    if (dragOverPlayer?.id === player.id) {
      setDragOverPlayer(null);
    }
  }, [dragOverPlayer]);

  const handleDrop = useCallback(
    (player: TeamPlayer, e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!draggedPlayer || draggedPlayer.id === player.id) return;
      if (!canSwap(draggedPlayer, player)) return;

      const nx = picks.map((p) => {
        if (p.id === draggedPlayer.id)
          return {
            ...p,
            isOnBench: player.isOnBench,
            benchOrder: player.isOnBench ? player.benchOrder : null,
          };
        if (p.id === player.id)
          return {
            ...p,
            isOnBench: draggedPlayer.isOnBench,
            benchOrder: draggedPlayer.isOnBench ? draggedPlayer.benchOrder : null,
          };
        return p;
      });

      if (legalFormation(nx)) {
        setPicks(nx);
        setDirty(true);
      }

      setDraggedPlayer(null);
      setDragOverPlayer(null);
    },
    [draggedPlayer, picks],
  );

  const handleDragEnd = useCallback(() => {
    setDraggedPlayer(null);
    setDragOverPlayer(null);
  }, []);

  const save = useCallback(async () => {
    if (!dirty || saving) return;
    setSaving(true);
    setSaveErr(null);
    try {
      const cap = picks.find((p) => p.isCaptain);
      const vc = picks.find((p) => p.isViceCaptain);
      const bench = picks
        .filter((p) => p.isOnBench)
        .sort((a, b) => (a.benchOrder ?? 0) - (b.benchOrder ?? 0));
      await apiFetch("/team/lineup", {
        method: "PUT",
        body: JSON.stringify({
          captain: cap?.playerId ?? 0,
          viceCaptain: vc?.playerId ?? 0,
          benchOrder: bench.map((p) => p.playerId),
        }),
      });
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2600);
    } catch (e: any) {
      setSaveErr(e.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  }, [dirty, saving, picks]);

  // ── Safe early returns ────────────────────────────────────────────────────
  if (checking) return null;
  if (loading) return <Spinner fullScreen />;

  // ── Derived values ────────────────────────────────────────────────────────
  const bench = picks
    .filter((p) => p.isOnBench)
    .sort((a, b) => (a.benchOrder ?? 0) - (b.benchOrder ?? 0));
  const rows: Record<number, TeamPlayer[]> = { 1: [], 2: [], 3: [], 4: [] };
  picks
    .filter((p) => !p.isOnBench)
    .forEach((p) => {
      const pos = Number(p.position);
      rows[pos]?.push(p);
    });
  const gwPts = picks.reduce((s, p) => {
    const ep = p.eventPoints ?? 0;
    if (p.isOnBench && chip !== "BENCH_BOOST") return s;
    return s + (p.isCaptain ? ep * 2 : ep);
  }, 0);

  return (
    <div
      className="team-root"
      style={{
        fontFamily: "'Barlow Condensed','Impact',sans-serif",
        height: "100vh",
        background: "#0a0e1a",
        display: "flex",
        flexDirection: "column",
        position: "relative",
        overflow: "hidden",
        ['--accent' as any]: ACCENT,
        ['--accent-22' as any]: `${ACCENT}22`,
        ['--accent-44' as any]: `${ACCENT}44`,
        ['--accent-88' as any]: `${ACCENT}88`,
      }}
      onClick={() => {
        if (subMode) {
          setSubMode(false);
          setSubSrc(null);
        }
        setCtx(null);
      }}
    >

      {/* BG glow */}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: `radial-gradient(ellipse 58% 55% at 38% 50%, ${ACCENT}04 0%, transparent 65%)`,
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

      {/* ── Top bar ── */}
      <div
        className="anim-a team-topbar"
        style={{
          position: "relative",
          zIndex: 30,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 20px",
          borderBottom: "1px solid rgba(255,255,255,.06)",
          flexShrink: 0,
          gap: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: "50%",
              background: `linear-gradient(135deg,${ACCENT}33,${ACCENT}11)`,
              border: `2px solid ${ACCENT}44`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 15,
              fontWeight: 900,
              color: ACCENT,
            }}
          >
            {(team?.name ?? "T").slice(0, 1).toUpperCase()}
          </div>
          <div>
            <div
              style={{
                color: "white",
                fontWeight: 900,
                fontSize: 18,
                lineHeight: 1,
              }}
            >
              {team?.name ?? "My Team"}
            </div>
            <div
              style={{
                color: "rgba(255,255,255,.45)",
                fontSize: 9,
                fontFamily: "'Barlow',sans-serif",
                letterSpacing: "0.18em",
                marginTop: 1,
              }}
            >
              GW{team?.gameweek ?? "—"} ·{" "}
              {team?.overallRank
                ? `Rank #${team.overallRank.toLocaleString()}`
                : "Unranked"}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                color: "rgba(255,255,255,.45)",
                fontSize: 8,
                letterSpacing: ".2em",
                textTransform: "uppercase",
                fontFamily: "'Barlow',sans-serif",
              }}
            >
              GW Points
            </div>
            <div
              style={{
                color: ACCENT,
                fontSize: 30,
                fontWeight: 900,
                lineHeight: 1,
              }}
            >
              {gwPts}
            </div>
          </div>
          <div
            style={{
              width: 1,
              height: 32,
              background: "rgba(255,255,255,.07)",
            }}
          />
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                color: "rgba(255,255,255,.45)",
                fontSize: 8,
                letterSpacing: ".2em",
                textTransform: "uppercase",
                fontFamily: "'Barlow',sans-serif",
              }}
            >
              Total
            </div>
            <div
              style={{
                color: "white",
                fontSize: 22,
                fontWeight: 900,
                lineHeight: 1,
              }}
            >
              {team?.totalPoints ?? 0}
              <span style={{ color: "rgba(255,255,255,.35)", fontSize: 12 }}>
                {" "}
                pts
              </span>
            </div>
          </div>
        </div>

        <div
          className="team-actions"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginLeft: "auto",
          }}
        >
          {subMode && (
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                background: `${ACCENT}14`,
                border: `1px solid ${ACCENT}44`,
                borderRadius: 8,
                padding: "7px 12px",
                color: ACCENT,
                fontSize: 11,
                fontWeight: 700,
                animation: "fadeIn .15s both",
              }}
            >
              <span style={{ fontSize: 13 }}>⇄</span>
              Swapping{" "}
              <strong style={{ margin: "0 3px" }}>{subSrc?.webName}</strong>—
              pick target
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setSubMode(false);
                  setSubSrc(null);
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: ACCENT,
                  cursor: "pointer",
                  fontSize: 17,
                  padding: "0 0 0 4px",
                  lineHeight: 1,
                }}
              >
                x
              </button>
            </div>
          )}
          {saved && (
            <div
              style={{
                background: `${ACCENT}14`,
                border: `1px solid ${ACCENT}44`,
                borderRadius: 7,
                padding: "6px 12px",
                color: ACCENT,
                fontSize: 10,
                fontWeight: 800,
                animation: "fadeIn .2s both",
              }}
            >
              Saved successfully
            </div>
          )}
          {saveErr && (
            <div
              style={{
                background: "rgba(239,68,68,.1)",
                border: "1px solid rgba(239,68,68,.28)",
                borderRadius: 7,
                padding: "6px 12px",
                color: "#fca5a5",
                fontSize: 10,
                fontFamily: "'Barlow',sans-serif",
              }}
            >
              {saveErr}
            </div>
          )}
          <button
            disabled={!dirty || saving}
            onClick={save}
            style={{
              padding: "10px 22px",
              borderRadius: 10,
              border: "none",
              fontFamily: "'Barlow Condensed',sans-serif",
              fontWeight: 800,
              fontSize: 12,
              letterSpacing: ".2em",
              textTransform: "uppercase",
              cursor: dirty ? "pointer" : "not-allowed",
              background: dirty
                ? `linear-gradient(135deg,${ACCENT},#00d4ff)`
                : "rgba(255,255,255,.05)",
              color: dirty ? "#0a0e1a" : "rgba(255,255,255,.38)",
              boxShadow: dirty ? `0 0 20px ${ACCENT}44` : "none",
              animation: dirty ? "glow 2s ease-in-out infinite" : "none",
              transition: "all .25s",
              opacity: !dirty || saving ? (saving ? 1 : 0.35) : 1,
            }}
          >
            {saving ? (
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span
                  style={{
                    width: 10,
                    height: 10,
                    border: "2px solid #0a0e1a44",
                    borderTopColor: "#0a0e1a",
                    borderRadius: "50%",
                    animation: "spin .7s linear infinite",
                    display: "inline-block",
                  }}
                />
                Saving
              </span>
            ) : (
              "Save Changes"
            )}
          </button>
          <button
            onClick={() => router.push("/app/transfers")}
            style={{
              padding: "10px 16px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,.1)",
              background: "transparent",
              color: "rgba(255,255,255,.5)",
              fontFamily: "'Barlow Condensed',sans-serif",
              fontWeight: 700,
              fontSize: 12,
              letterSpacing: ".15em",
              cursor: "pointer",
              transition: "all .18s",
              textTransform: "uppercase",
            }}
          >
            Transfers
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      <div
        className="anim-b team-body"
        style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}
      >
        {/* Pitch */}
        <div
          className="team-pitchcol"
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            padding: "8px 8px 8px 14px",
            minWidth: 0,
          }}
        >
          <div
            className="team-pitch"
            style={{
              flex: 1,
              position: "relative",
              background:
                "linear-gradient(180deg,#195830 0%,#1d6636 14.28%,#195830 28.57%,#1d6636 42.85%,#195830 57.14%,#1d6636 71.42%,#195830 85.71%,#1d6636 100%)",
              borderRadius: "18px 18px 0 0",
              border: "2px solid rgba(255,255,255,.14)",
              borderBottom: "none",
              overflow: "hidden",
              padding: "10px 8px 8px",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-around",
              transition: "box-shadow .3s",
              boxShadow: subMode ? `inset 0 0 0 2000px ${ACCENT}07` : "none",
            }}
          >
            <PitchSvg />
            {([4, 3, 2, 1] as const).map((posId) => (
              <div
                key={posId}
                style={{
                  display: "flex",
                  justifyContent: "center",
                  gap: 6,
                  position: "relative",
                  zIndex: 1,
                }}
              >
                {(rows[posId] ?? []).map((player) => (
                  <PlayerSlot
                    key={player.id}
                    player={player}
                    subSrc={subSrc}
                    subMode={subMode}
                    benchBoost={chip === "BENCH_BOOST"}
                    onClick={onSlotClick}
                    onDragStart={handleDragStart}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onDragEnd={handleDragEnd}
                    isDragging={draggedPlayer?.id === player.id}
                    isDragOver={dragOverPlayer?.id === player.id}
                  />
                ))}
              </div>
            ))}
          </div>

          {/* Bench */}
          <div
            style={{
              background: "#0c1220",
              border: "2px solid rgba(255,255,255,.1)",
              borderTop: "1px solid rgba(255,255,255,.04)",
              borderRadius: "0 0 18px 18px",
              padding: "8px 14px",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span
              style={{
                color: "rgba(255,255,255,.45)",
                fontSize: 8,
                fontWeight: 700,
                letterSpacing: "0.25em",
                textTransform: "uppercase",
                fontFamily: "'Barlow',sans-serif",
                flexShrink: 0,
                marginRight: 8,
              }}
            >
              BENCH
            </span>
            <div
              style={{
                flex: 1,
                display: "flex",
                justifyContent: "space-around",
                alignItems: "center",
              }}
            >
              {bench.map((player) => (
                <PlayerSlot
                  key={player.id}
                  player={player}
                  subSrc={subSrc}
                  subMode={subMode}
                  benchBoost={chip === "BENCH_BOOST"}
                  onClick={onSlotClick}
                  onDragStart={handleDragStart}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onDragEnd={handleDragEnd}
                  isDragging={draggedPlayer?.id === player.id}
                  isDragOver={dragOverPlayer?.id === player.id}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Right panel */}
        <div
          className="team-side"
          style={{
            width: 272,
            flexShrink: 0,
            background: "rgba(5,9,18,.76)",
            borderLeft: "1px solid rgba(255,255,255,.07)",
            display: "flex",
            flexDirection: "column",
            padding: "14px 12px",
            overflow: "hidden auto",
          }}
        >
          {/* Chips */}
          <div style={{ marginBottom: 14 }}>
            <div
              style={{
                color: "rgba(255,255,255,.35)",
                fontSize: 8,
                fontWeight: 700,
                letterSpacing: ".25em",
                textTransform: "uppercase",
                fontFamily: "'Barlow',sans-serif",
                marginBottom: 8,
              }}
            >
              Chips
            </div>
            {chipErr && (
              <div
                style={{
                  padding: "6px 9px",
                  borderRadius: 7,
                  background: "rgba(239,68,68,.1)",
                  border: "1px solid rgba(239,68,68,.25)",
                  color: "#fca5a5",
                  fontSize: 9,
                  fontFamily: "'Barlow',sans-serif",
                  marginBottom: 7,
                }}
              >
                ⚠️ {chipErr}
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {CHIP_DEFS.map(({ key, name, icon, desc }) => {
                const isActive = chip === key;
                const isUsed = !chipAvail[key] && !isActive;
                const handleToggle = async () => {
                  if (chipPlaying) return;
                  setChipErr(null);
                  setChipPlaying(true);
                  try {
                    if (isActive) {
                      await apiFetch(`/chips/cancel/${team!.gameweek}`, {
                        method: "DELETE",
                      });
                      setChip(null);
                    } else {
                      await apiFetch("/chips/play", {
                        method: "POST",
                        body: JSON.stringify({
                          chip: key,
                          gameweek: team!.gameweek,
                        }),
                      });
                      setChip(key);
                    }
                    const r = await apiFetch<{
                      success: boolean;
                      data: { available: ChipAvailability };
                    }>("/chips/status").catch(() => null);
                    if (r?.data?.available) setChipAvail(r.data.available);
                  } catch (e: any) {
                    setChipErr(e?.message ?? "Failed to update chip");
                  } finally {
                    setChipPlaying(false);
                  }
                };
                return (
                  <ChipCard
                    key={key}
                    id={key}
                    name={name}
                    desc={desc}
                    icon={icon}
                    active={isActive}
                    used={isUsed}
                    onToggle={handleToggle}
                  />
                );
              })}
            </div>
          </div>

          <div
            style={{
              height: 1,
              background: "rgba(255,255,255,.06)",
              marginBottom: 14,
            }}
          />

          {/* Squad list */}
          <div style={{ flex: 1, overflow: "hidden auto" }}>
            <div
              style={{
                color: "rgba(255,255,255,.35)",
                fontSize: 8,
                fontWeight: 700,
                letterSpacing: ".25em",
                textTransform: "uppercase",
                fontFamily: "'Barlow',sans-serif",
                marginBottom: 8,
              }}
            >
              Squad
            </div>
            {picks.map((p) => {
              const c = POS_COLOR[p.position];
              const onBench = p.isOnBench;
              const ep = p.eventPoints ?? 0;
              return (
                <div
                  key={p.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "16px 1fr 24px 20px 20px",
                    alignItems: "center",
                    gap: 5,
                    padding: "5px 7px",
                    borderRadius: 7,
                    marginBottom: 3,
                    background: onBench
                      ? "rgba(255,255,255,.01)"
                      : "rgba(255,255,255,.03)",
                    border: onBench
                      ? "1px solid rgba(255,255,255,.03)"
                      : `1px solid ${c}15`,
                    opacity: onBench && chip !== "BENCH_BOOST" ? 0.48 : 1,
                    transition: "all .18s",
                  }}
                >
                  <div
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: 4,
                      background: `${c}20`,
                      border: `1px solid ${c}40`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 6,
                      fontWeight: 900,
                      color: c,
                    }}
                  >
                    {POS_LABEL[p.position]}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        color: "white",
                        fontSize: 11,
                        fontWeight: 700,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {p.webName}
                    </div>
                    <div
                      style={{
                        color: "rgba(255,255,255,.45)",
                        fontSize: 8,
                        fontFamily: "'Barlow',sans-serif",
                      }}
                    >
                      {p.team.shortName}
                    </div>
                  </div>
                  <div
                    style={{
                      color: ep > 0 ? ACCENT : "#2a3a4a",
                      fontSize: 11,
                      fontWeight: 700,
                      textAlign: "right",
                    }}
                  >
                    {ep}
                  </div>
                  {/* C / V buttons */}
                  {(["C", "V"] as const).map((badge) => {
                    const isCap = badge === "C";
                    const active = isCap ? p.isCaptain : p.isViceCaptain;
                    const color = isCap ? "#f59e0b" : "#94a3b8";
                    return (
                      <button
                        key={badge}
                        disabled={onBench}
                        onClick={() => {
                          if (onBench) return;
                          setPicks((prev) =>
                            prev.map((q) =>
                              isCap
                                ? {
                                    ...q,
                                    isCaptain:
                                      q.id === p.id ? !q.isCaptain : false,
                                    isViceCaptain:
                                      q.id === p.id && !q.isCaptain
                                        ? false
                                        : q.isViceCaptain,
                                  }
                                : {
                                    ...q,
                                    isViceCaptain:
                                      q.id === p.id ? !q.isViceCaptain : false,
                                    isCaptain:
                                      q.id === p.id && !q.isViceCaptain
                                        ? false
                                        : q.isCaptain,
                                  },
                            ),
                          );
                          setDirty(true);
                        }}
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: "50%",
                          padding: 0,
                          background: active
                            ? color + "22"
                            : "rgba(255,255,255,.04)",
                          border: `1.5px solid ${active ? color : "rgba(255,255,255,.1)"}`,
                          color: active ? color : "#2a3a4a",
                          fontSize: 7,
                          fontWeight: 900,
                          cursor: onBench ? "not-allowed" : "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          transition: "all .15s",
                        }}
                        title={isCap ? "Captain" : "Vice Captain"}
                      >
                        {badge}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>

          <div
            style={{
              height: 1,
              background: "rgba(255,255,255,.06)",
              margin: "14px 0 12px",
            }}
          />

          {/* Tips */}
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {[
              { icon: "👆", text: "Click any player on the pitch for options" },
              {
                icon: "🖱️",
                text: "Drag & drop players to swap positions or change formation",
              },
              {
                icon: "⇄",
                text: "Move to Bench starts a sub — click the target",
              },
              {
                icon: "🎖️",
                text: "Captain scores 2× points. Assign from pitch or list",
              },
            ].map((t, i) => (
              <div
                key={i}
                style={{ display: "flex", gap: 7, alignItems: "flex-start" }}
              >
                <span style={{ fontSize: 11, flexShrink: 0, marginTop: 1 }}>
                  {t.icon}
                </span>
                <span
                  style={{
                    color: "rgba(255,255,255,.45)",
                    fontSize: 9,
                    fontFamily: "'Barlow',sans-serif",
                    lineHeight: 1.55,
                  }}
                >
                  {t.text}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {ctx && (
        <div onClick={(e) => e.stopPropagation()}>
          <ContextMenu
            player={ctx.player}
            x={ctx.x}
            y={ctx.y}
            onAction={onAction}
          />
        </div>
      )}
    </div>
  );
}
