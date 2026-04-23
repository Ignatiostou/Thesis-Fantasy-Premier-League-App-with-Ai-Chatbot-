"use client";
// src/features/leagues/LeagueModals.tsx

import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { ACCENT } from "@/lib/constants";
import { League } from "@/lib/types";

// ── Shared modal styles ───────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  display: "block", color: "rgba(255,255,255,.35)", fontSize: 9, fontWeight: 700,
  letterSpacing: ".18em", textTransform: "uppercase",
  fontFamily: "'Barlow',sans-serif", marginBottom: 5,
};

const inputStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box",
  background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.1)",
  borderRadius: 9, padding: "10px 12px", color: "white",
  fontSize: 13, fontFamily: "'Barlow',sans-serif", outline: "none", marginBottom: 14,
};

const primaryBtnStyle: React.CSSProperties = {
  padding: "10px 20px", borderRadius: 9,
  border: `1px solid ${ACCENT}44`, background: `${ACCENT}18`, color: ACCENT,
  fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 800, fontSize: 12,
  letterSpacing: ".12em", textTransform: "uppercase", cursor: "pointer",
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: "10px 16px", borderRadius: 9,
  border: "1px solid rgba(255,255,255,.1)", background: "rgba(255,255,255,.04)",
  color: "rgba(255,255,255,.45)", fontFamily: "'Barlow Condensed',sans-serif",
  fontWeight: 700, fontSize: 12, letterSpacing: ".1em",
  textTransform: "uppercase", cursor: "pointer",
};

// ── Modal shell ───────────────────────────────────────────────────────────────

export function Modal({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(0,0,0,.7)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "#0f1623", border: "1px solid rgba(255,255,255,.1)", borderRadius: 18, padding: "28px 26px", width: "100%", maxWidth: 400, boxShadow: "0 24px 64px rgba(0,0,0,.6)" }}
      >
        {children}
      </div>
    </div>
  );
}

// ── Error banner ──────────────────────────────────────────────────────────────

function ErrBanner({ msg }: { msg: string }) {
  return (
    <div style={{ color: "#f87171", fontSize: 11, fontFamily: "'Barlow',sans-serif", marginBottom: 12, padding: "8px 10px", background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.25)", borderRadius: 8 }}>
      ⚠️ {msg}
    </div>
  );
}

// ── Create League modal ───────────────────────────────────────────────────────

interface CreateProps {
  onClose: () => void;
  onCreate: (league: League) => void;
}

export function CreateLeagueModal({ onClose, onCreate }: CreateProps) {
  const [name,    setName]    = useState("");
  const [loading, setLoading] = useState(false);
  const [err,     setErr]     = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) return setErr("Name is required");
    setLoading(true); setErr(null);
    try {
      const res = await apiFetch<League>("/leagues", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      onCreate({ ...res, joinedAt: new Date().toISOString() });
      onClose();
    } catch (e: any) {
      setErr(e?.message ?? "Failed to create");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <h2 style={{ color: "white", fontSize: 20, fontWeight: 900, textTransform: "uppercase", margin: "0 0 20px" }}>Create League</h2>
      {err && <ErrBanner msg={err} />}
      <label style={labelStyle}>League Name</label>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Hawk United League" style={inputStyle} maxLength={40} />
      <p style={{ color: "rgba(255,255,255,.3)", fontSize: 10, fontFamily: "'Barlow',sans-serif", margin: "0 0 16px" }}>
        Classic format (cumulative points). Invite friends with the code after creating.
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onClose} style={secondaryBtnStyle}>Cancel</button>
        <button onClick={submit} disabled={loading} style={{ ...primaryBtnStyle, flex: 1 }}>
          {loading ? "Creating…" : "Create League"}
        </button>
      </div>
    </>
  );
}

// ── Join League modal ─────────────────────────────────────────────────────────

interface JoinProps {
  onClose: () => void;
  onJoin: () => void;
}

export function JoinLeagueModal({ onClose, onJoin }: JoinProps) {
  const [code,    setCode]    = useState("");
  const [loading, setLoading] = useState(false);
  const [err,     setErr]     = useState<string | null>(null);

  const submit = async () => {
    if (!code.trim()) return setErr("Code is required");
    setLoading(true); setErr(null);
    try {
      await apiFetch("/leagues/join", {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      onJoin();
      onClose();
    } catch (e: any) {
      setErr(e?.message ?? "Failed to join");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <h2 style={{ color: "white", fontSize: 20, fontWeight: 900, textTransform: "uppercase", margin: "0 0 20px" }}>Join League</h2>
      {err && <ErrBanner msg={err} />}
      <label style={labelStyle}>Invite Code</label>
      <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="e.g. ABCD1234" style={inputStyle} maxLength={12} />
      <p style={{ color: "rgba(255,255,255,.3)", fontSize: 10, fontFamily: "'Barlow',sans-serif", margin: "0 0 16px" }}>
        Ask the league admin for the invite code.
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onClose} style={secondaryBtnStyle}>Cancel</button>
        <button onClick={submit} disabled={loading} style={{ ...primaryBtnStyle, flex: 1 }}>
          {loading ? "Joining…" : "Join League"}
        </button>
      </div>
    </>
  );
}
