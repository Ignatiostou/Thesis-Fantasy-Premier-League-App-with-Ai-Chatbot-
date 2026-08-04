"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";

type Mode = "login" | "register";

// ─── Validators ───────────────────────────────────────────────────────────────
function validateEmail(v: string) {
  if (!v.trim()) return "Email is required.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return "Please enter a valid email address.";
  return null;
}
function validateUsername(v: string) {
  if (!v.trim()) return "Username is required.";
  if (v.length < 3) return "Must be at least 3 characters.";
  if (v.length > 20) return "Must be at most 20 characters.";
  if (!/^[a-zA-Z0-9_]+$/.test(v)) return "Only letters, numbers and underscores allowed.";
  return null;
}
function validatePassword(v: string, mode: Mode) {
  if (!v) return "Password is required.";
  if (mode === "login") return null;
  if (v.length < 8) return "Password must be at least 8 characters.";
  return null;
}

const PW_RULES = [
  { label: "8+ characters",        test: (v: string) => v.length >= 8 },
  { label: "Uppercase letter",     test: (v: string) => /[A-Z]/.test(v) },
  { label: "Lowercase letter",     test: (v: string) => /[a-z]/.test(v) },
  { label: "Number (0–9)",         test: (v: string) => /[0-9]/.test(v) },
  { label: "Special char (!@#…)",  test: (v: string) => /[^a-zA-Z0-9]/.test(v) },
];

const STRENGTH = [
  { label: "Too weak", color: "#ef4444" },
  { label: "Weak",     color: "#f97316" },
  { label: "Fair",     color: "#facc15" },
  { label: "Good",     color: "#84cc16" },
  { label: "Strong",   color: "#00FF87" },
];

const ACCENT = "#00FF87";

// ─── Component ────────────────────────────────────────────────────────────────
export default function AuthPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");

  const [email,    setEmail]    = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw,   setShowPw]   = useState(false);

  const [touched,   setTouched]   = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const [busy,      setBusy]      = useState(false);
  const [serverErr, setServerErr] = useState<string | null>(null);

  const emailErr    = validateEmail(email);
  const usernameErr = mode === "register" ? validateUsername(username) : null;
  const passwordErr = validatePassword(password, mode);
  const pwRules     = PW_RULES.map((r) => ({ ...r, pass: r.test(password) }));
  const pwScore     = pwRules.filter((r) => r.pass).length;
  const strength    = STRENGTH[Math.min(pwScore, STRENGTH.length - 1)] ?? STRENGTH[0];

  const show = (f: string) => submitted || !!touched[f];
  const touch = (f: string) => setTouched((t) => ({ ...t, [f]: true }));

  function switchMode(m: Mode) {
    setMode(m); setServerErr(null); setTouched({}); setSubmitted(false);
  }

  async function submit() {
    setSubmitted(true);
    if (emailErr || usernameErr || passwordErr) return;
    setBusy(true); setServerErr(null);
    try {
      const body: Record<string, string> = { email, password };
      if (mode === "register") body.username = username;
      await apiFetch(`/auth/${mode}`, { method: "POST", body: JSON.stringify(body) });
      router.push("/app");
    } catch (e: any) {
      setServerErr(e.message ?? "Authentication failed");
    } finally { setBusy(false); }
  }

  return (
    <div style={{ fontFamily:"'Barlow Condensed','Impact',sans-serif", minHeight:"100vh", background:"#0a0e1a", display:"flex", flexDirection:"column", position:"relative", overflow:"hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@300;400;600;700;800;900&family=Barlow:wght@300;400;500&display=swap');
        @keyframes fadeUp  { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
        @keyframes slideIn { from{opacity:0;transform:translateY(-5px)} to{opacity:1;transform:translateY(0)} }
        @keyframes shake   { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-5px)} 75%{transform:translateX(5px)} }
        .fade-1{animation:fadeUp .5s .05s both ease-out}
        .fade-2{animation:fadeUp .5s .15s both ease-out}
        .fade-3{animation:fadeUp .5s .25s both ease-out}
        .fade-4{animation:fadeUp .5s .35s both ease-out}
        .fade-5{animation:fadeUp .5s .45s both ease-out}
        .err-row{animation:slideIn .2s ease;display:flex;align-items:flex-start;gap:6px;color:#fca5a5;font-size:11px;font-family:'Barlow',sans-serif;margin-top:6px;line-height:1.5}
        .shake{animation:shake .35s ease}
        .auth-input{width:100%;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:13px 44px 13px 16px;color:white;font-size:14px;font-family:'Barlow',sans-serif;outline:none;box-sizing:border-box;transition:border-color .2s,background .2s,box-shadow .2s}
        .auth-input:focus{border-color:#00FF8755;background:rgba(0,255,135,.04);box-shadow:0 0 0 3px rgba(0,255,135,.07)}
        .auth-input.bad{border-color:rgba(239,68,68,.55)!important;background:rgba(239,68,68,.04)!important}
        .auth-input.good-field{border-color:rgba(0,255,135,.4)!important}
        .auth-input::placeholder{color:rgba(255,255,255,.22)}
        .tab-btn{flex:1;padding:10px 0;border-radius:10px;border:none;font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:13px;letter-spacing:.15em;text-transform:uppercase;cursor:pointer;transition:all .25s}
        .submit-btn{width:100%;padding:14px;border-radius:12px;border:none;background:#00FF87;color:#0a0e1a;font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:14px;letter-spacing:.2em;text-transform:uppercase;cursor:pointer;transition:opacity .2s,transform .15s,box-shadow .2s}
        .submit-btn:not(:disabled):hover{opacity:.88;transform:translateY(-1px);box-shadow:0 8px 28px rgba(0,255,135,.28)}
        .submit-btn:active{transform:translateY(0)}
        .submit-btn:disabled{opacity:.42;cursor:not-allowed;transform:none}
        .feature-pill{display:flex;align-items:center;gap:10px;padding:12px 16px;border-radius:14px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03)}
        .pw-rule{display:flex;align-items:center;gap:7px;font-size:11px;font-family:'Barlow',sans-serif;transition:color .25s}
        .pw-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0;transition:background .25s,transform .2s}
        .pw-dot.ok{transform:scale(1.3)}
        input[type=password]::-ms-reveal{display:none}

        /* ── Responsive: stack card above branding on small screens ── */
        @media (max-width: 900px) {
          .auth-main {
            flex-direction: column !important;
            gap: 32px !important;
            padding: 8px 18px 48px !important;
            align-items: stretch !important;
          }
          .auth-card {
            order: -1;
            width: 100% !important;
            padding: 24px 20px 26px !important;
          }
          .auth-brand {
            max-width: none !important;
          }
        }
      `}</style>

      {/* Background */}
      <div style={{ position:"absolute", inset:0, pointerEvents:"none" }}>
        <svg width="100%" height="100%" viewBox="0 0 1200 750" preserveAspectRatio="xMidYMid slice" style={{ opacity:.035 }}>
          <ellipse cx="600" cy="375" rx="300" ry="210" fill="none" stroke="white" strokeWidth="2"/>
          <circle  cx="600" cy="375" r="28"       fill="none" stroke="white" strokeWidth="2"/>
          <line x1="600" y1="0" x2="600" y2="750"              stroke="white" strokeWidth="1.5"/>
          <rect x="80"   y="245" width="110" height="260" fill="none" stroke="white" strokeWidth="1.5"/>
          <rect x="80"   y="310" width="45"  height="130" fill="none" stroke="white" strokeWidth="1.5"/>
          <rect x="1010" y="245" width="110" height="260" fill="none" stroke="white" strokeWidth="1.5"/>
          <rect x="1075" y="310" width="45"  height="130" fill="none" stroke="white" strokeWidth="1.5"/>
        </svg>
        <div style={{ position:"absolute", inset:0, background:"radial-gradient(ellipse 55% 50% at 72% 35%, #00FF8712 0%, transparent 65%), radial-gradient(ellipse 35% 55% at 15% 75%, #1a237e22 0%, transparent 55%)" }}/>
        <div style={{ position:"absolute", top:0, left:0, right:0, height:3, background:ACCENT }}/>
      </div>

      {/* Header */}
      <div style={{ position:"relative", zIndex:10, display:"flex", alignItems:"center", justifyContent:"space-between", padding:"24px clamp(18px, 4vw, 40px) 16px", gap:12, flexWrap:"wrap" }}>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <div style={{ width:32, height:32, borderRadius:"50%", background:ACCENT, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:900, fontSize:14, color:"#0a0e1a" }}>F</div>
          <span style={{ color:"white", fontWeight:700, fontSize:16, letterSpacing:"0.2em" }}>FPL MANAGER</span>
        </div>
        <a href="/" style={{ color:`${ACCENT}88`, fontSize:11, fontWeight:600, letterSpacing:"0.2em", textDecoration:"none", border:`1px solid ${ACCENT}44`, borderRadius:99, padding:"6px 14px", fontFamily:"'Barlow',sans-serif" }}>
          ← Back to Welcome
        </a>
      </div>

      {/* Main */}
      <div className="auth-main" style={{ position:"relative", zIndex:10, flex:1, display:"flex", alignItems:"center", padding:"16px 40px 40px", gap:60, maxWidth:1120, margin:"0 auto", width:"100%", boxSizing:"border-box" }}>

        {/* LEFT: branding */}
        <div className="auth-brand" style={{ flex:1, maxWidth:440 }}>
          <p className="fade-1" style={{ color:ACCENT, fontSize:11, fontWeight:600, letterSpacing:"0.3em", textTransform:"uppercase", marginBottom:14, fontFamily:"'Barlow',sans-serif" }}>
            {mode === "login" ? "Welcome back" : "Join the game"}
          </p>
          <h1 className="fade-2" style={{ color:"white", fontSize:"clamp(44px,7vw,70px)", fontWeight:900, textTransform:"uppercase", lineHeight:.92, marginBottom:20, whiteSpace:"pre-line" }}>
            {mode === "login" ? "Sign\nBack\nIn" : "Create\nYour\nAccount"}
          </h1>
          <p className="fade-3" style={{ color:"#94a3b8", fontSize:15, fontWeight:300, lineHeight:1.7, marginBottom:32, maxWidth:360, fontFamily:"'Barlow',sans-serif" }}>
            {mode === "login"
              ? "Your squad is waiting. Sign in to check your lineup, track points, and make that crucial transfer."
              : "Build your dream squad within a £100m budget and compete with managers worldwide."}
          </p>
          <div className="fade-4" style={{ display:"flex", flexDirection:"column", gap:10 }}>
            {[
              { icon:"🧑‍🤝‍🧑", label:"Team Management", sub:"Squad, bench & captain picks" },
              { icon:"📊",      label:"Live Points",      sub:"Gameweek scoring & rankings" },
              { icon:"🏆",      label:"Private Leagues",  sub:"Compete with friends" },
            ].map((f) => (
              <div key={f.label} className="feature-pill">
                <span style={{ fontSize:22 }}>{f.icon}</span>
                <div>
                  <div style={{ color:"white", fontSize:13, fontWeight:700, letterSpacing:"0.05em" }}>{f.label}</div>
                  <div style={{ color:"#64748b", fontSize:11, fontFamily:"'Barlow',sans-serif", marginTop:1 }}>{f.sub}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT: card */}
        <div className="fade-5 auth-card" style={{ width:430, maxWidth:"100%", flexShrink:0, background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:24, padding:"28px 30px 30px", backdropFilter:"blur(14px)", boxShadow:"0 24px 80px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)", boxSizing:"border-box" }}>

          {/* Mode tabs */}
          <div style={{ display:"flex", gap:6, background:"rgba(0,0,0,0.3)", borderRadius:12, padding:4, marginBottom:24 }}>
            {(["login","register"] as Mode[]).map((m) => (
              <button key={m} className="tab-btn" onClick={() => switchMode(m)}
                style={{ background:mode===m ? ACCENT:"transparent", color:mode===m ? "#0a0e1a":"rgba(255,255,255,0.35)" }}>
                {m === "login" ? "Sign In" : "Register"}
              </button>
            ))}
          </div>

          <div style={{ color:"white", fontSize:21, fontWeight:800, letterSpacing:"0.05em", textTransform:"uppercase", marginBottom:4 }}>
            {mode === "login" ? "Sign In" : "Create Account"}
          </div>
          <p style={{ color:"#64748b", fontSize:12, fontFamily:"'Barlow',sans-serif", marginBottom:22 }}>
            {mode === "login" ? "Enter your credentials to continue." : "Fill in the details below to get started."}
          </p>

          <div style={{ display:"flex", flexDirection:"column", gap:14 }}>

            {/* ── Email ── */}
            <FieldWrap label="Email" error={show("email") ? emailErr : null}>
              <div style={{ position:"relative" }}>
                <input className={`auth-input${show("email") && emailErr ? " bad" : !emailErr && email ? " good-field" : ""}`}
                  placeholder="you@example.com" type="email"
                  value={email} onChange={(e) => setEmail(e.target.value)} onBlur={() => touch("email")} />
                {!emailErr && email && (
                  <span style={{ position:"absolute", right:14, top:"50%", transform:"translateY(-50%)", color:ACCENT, fontSize:14 }}>✓</span>
                )}
              </div>
            </FieldWrap>

            {/* ── Username (register only) ── */}
            {mode === "register" && (
              <FieldWrap label="Username" error={show("username") ? usernameErr : null} hint="3–20 chars · letters, numbers, underscores">
                <div style={{ position:"relative" }}>
                  <input className={`auth-input${show("username") && usernameErr ? " bad" : !usernameErr && username ? " good-field" : ""}`}
                    placeholder="e.g. manager_hawk" type="text"
                    value={username} onChange={(e) => setUsername(e.target.value)} onBlur={() => touch("username")} />
                  {!usernameErr && username && (
                    <span style={{ position:"absolute", right:14, top:"50%", transform:"translateY(-50%)", color:ACCENT, fontSize:14 }}>✓</span>
                  )}
                </div>
              </FieldWrap>
            )}

            {/* ── Password ── */}
            <FieldWrap label="Password" error={show("password") && mode === "login" ? passwordErr : null}>
              <div style={{ position:"relative" }}>
                <input className={`auth-input${show("password") && mode==="login" && passwordErr ? " bad" : ""}`}
                  placeholder="••••••••" type={showPw ? "text" : "password"}
                  value={password} onChange={(e) => setPassword(e.target.value)} onBlur={() => touch("password")} />
                <button onClick={() => setShowPw((v) => !v)}
                  style={{ position:"absolute", right:13, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", cursor:"pointer", color:"rgba(255,255,255,0.28)", fontSize:15, display:"flex", alignItems:"center", lineHeight:1 }}>
                  {showPw ? "🙈" : "👁️"}
                </button>
              </div>

              {/* Strength — register only */}
              {mode === "register" && password.length > 0 && (
                <div style={{ marginTop:12 }}>
                  {/* Bar */}
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:7 }}>
                    <span style={{ color:"rgba(255,255,255,0.28)", fontSize:10, fontFamily:"'Barlow',sans-serif", letterSpacing:"0.1em", textTransform:"uppercase" }}>
                      Password strength
                    </span>
                    <span style={{ color:strength.color, fontSize:11, fontFamily:"'Barlow',sans-serif", fontWeight:600 }}>
                      {strength.label}
                    </span>
                  </div>
                  <div style={{ height:4, borderRadius:99, background:"rgba(255,255,255,0.08)", overflow:"hidden" }}>
                    <div style={{ height:"100%", borderRadius:99, background:strength.color, width:`${(pwScore/5)*100}%`, transition:"width .4s ease, background .3s" }}/>
                  </div>
                  {/* Checklist */}
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"7px 14px", marginTop:12 }}>
                    {pwRules.map((r) => (
                      <div key={r.label} className="pw-rule" style={{ color:r.pass ? "rgba(255,255,255,0.75)" : "rgba(255,255,255,0.25)" }}>
                        <div className={`pw-dot${r.pass ? " ok" : ""}`} style={{ background:r.pass ? ACCENT : "rgba(255,255,255,0.15)" }}/>
                        {r.label}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </FieldWrap>

            {/* Forgot pw */}
            {mode === "login" && (
              <div style={{ textAlign:"right", marginTop:-6 }}>
                <a href="#" style={{ color:`${ACCENT}78`, fontSize:11, fontFamily:"'Barlow',sans-serif", textDecoration:"none" }}>
                  Forgot password?
                </a>
              </div>
            )}

            {/* Server error */}
            {serverErr && (
              <div className="shake" style={{ padding:"11px 14px", borderRadius:12, background:"rgba(239,68,68,0.1)", border:"1px solid rgba(239,68,68,0.3)", color:"#fca5a5", fontSize:13, fontFamily:"'Barlow',sans-serif", display:"flex", gap:8, alignItems:"center" }}>
                <span>⚠️</span><span>{serverErr}</span>
              </div>
            )}

            {/* Submit */}
            <button className="submit-btn" disabled={busy} onClick={submit} style={{ marginTop:2 }}>
              {busy ? "Please wait…" : mode === "login" ? "Sign In →" : "Create Account →"}
            </button>

            {/* Divider */}
            <div style={{ display:"flex", alignItems:"center", gap:12 }}>
              <div style={{ flex:1, height:1, background:"rgba(255,255,255,0.08)" }}/>
              <span style={{ color:"rgba(255,255,255,0.18)", fontSize:11, fontFamily:"'Barlow',sans-serif" }}>or</span>
              <div style={{ flex:1, height:1, background:"rgba(255,255,255,0.08)" }}/>
            </div>

            <p style={{ textAlign:"center", color:"#64748b", fontSize:12, fontFamily:"'Barlow',sans-serif", margin:0 }}>
              {mode === "login" ? "Don't have an account? " : "Already have an account? "}
              <button onClick={() => switchMode(mode === "login" ? "register" : "login")}
                style={{ color:ACCENT, background:"none", border:"none", cursor:"pointer", fontWeight:600, fontSize:12, fontFamily:"'Barlow',sans-serif", padding:0 }}>
                {mode === "login" ? "Register" : "Sign In"}
              </button>
            </p>

            <p style={{ textAlign:"center", color:"rgba(255,255,255,0.13)", fontSize:10, fontFamily:"'Barlow',sans-serif", lineHeight:1.5, margin:0 }}>
              Τα δεδομένα χρησιμοποιούνται αποκλειστικά για την εφαρμογή της διπλωματικής.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Field wrapper ────────────────────────────────────────────────────────────
function FieldWrap({ label, error, hint, children }: { label: string; error?: string | null; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:6 }}>
        <span style={{ color:"#94a3b8", fontSize:10, fontWeight:600, letterSpacing:"0.18em", textTransform:"uppercase", fontFamily:"'Barlow',sans-serif" }}>
          {label}
        </span>
        {hint && !error && (
          <span style={{ color:"rgba(255,255,255,0.18)", fontSize:10, fontFamily:"'Barlow',sans-serif" }}>{hint}</span>
        )}
      </div>
      {children}
      {error && (
        <div className="err-row">
          <span style={{ flexShrink:0, marginTop:1 }}>⚠</span>
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
