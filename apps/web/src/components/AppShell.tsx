'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import Nav, { MobileTabBar } from './Nav';
import { ChatWidget } from '@/components/chatbot/ChatWidget';

const ACCENT = '#00FF87';

function getDisplayName(me: { id: string; email: string; username?: string } | null) {
  if (!me) return 'Manager';
  if (me.username) return me.username;
  return me.email.split('@')[0];
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [me,         setMe]         = useState<{ id: string; email: string; username?: string } | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);
  const router = useRouter();

  useEffect(() => {
    (async () => {
      try {
        const data = await apiFetch<{ id: string; email: string; username?: string }>('/auth/me');
        setMe(data);
      } catch {
        router.push('/auth');
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  async function logout() {
    setLoggingOut(true);
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } finally {
      router.push('/auth');
    }
  }

  // ── Loading screen ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          background: '#0a0e1a',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: "'Barlow Condensed', Impact, sans-serif",
        }}
      >
        <style>{`
          @keyframes _spin { to { transform: rotate(360deg); } }
        `}</style>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <div
            style={{
              width: 36,
              height: 36,
              border: `3px solid ${ACCENT}22`,
              borderTopColor: ACCENT,
              borderRadius: '50%',
              animation: '_spin .8s linear infinite',
            }}
          />
          <span
            style={{
              color: `${ACCENT}66`,
              fontSize: 11,
              letterSpacing: '0.3em',
              textTransform: 'uppercase',
              fontWeight: 700,
            }}
          >
            Loading
          </span>
        </div>
      </div>
    );
  }

  const displayName = getDisplayName(me);

  // ── Shell ──────────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0a0e1a',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: "'Barlow Condensed', Impact, sans-serif",
        position: 'relative',
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@300;400;600;700;800;900&family=Barlow:wght@300;400;500;600&display=swap');

        /* ── Shared keyframes (used by AppShell + ChatWidget) ── */
        @keyframes _spin       { to { transform: rotate(360deg); } }
        @keyframes spin        { to { transform: rotate(360deg); } }

        @keyframes chatSlideUp {
          from { opacity: 0; transform: translateY(14px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0)    scale(1);    }
        }

        @keyframes chatPulse {
          0%,100% { transform: scale(1);    opacity: 1;   }
          50%      { transform: scale(1.08); opacity: 0.7; }
        }

        @keyframes chatBounce {
          0%,100% { transform: translateY(0);    opacity: 0.3; }
          50%      { transform: translateY(-4px); opacity: 1;   }
        }

        /* ── Header ── */
        .as-header {
          position: sticky;
          top: 0;
          z-index: 50;
          display: flex;
          align-items: center;
          padding: 0 24px;
          height: 58px;
          background: rgba(5, 9, 18, 0.97);
          backdrop-filter: blur(20px);
          border-bottom: 1px solid rgba(255,255,255,.07);
          flex-shrink: 0;
          overflow: visible;
        }

        /* Green accent stripe */
        .as-header::before {
          content: '';
          position: absolute;
          top: 0; left: 0; right: 0;
          height: 2px;
          background: ${ACCENT};
        }

        /* ── Right user area ── */
        .as-user {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-shrink: 0;
          margin-left: auto;
        }

        /* Avatar circle */
        .as-avatar {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: linear-gradient(135deg, ${ACCENT}33, ${ACCENT}11);
          border: 1.5px solid ${ACCENT}55;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          font-weight: 900;
          color: ${ACCENT};
          flex-shrink: 0;
          letter-spacing: 0;
        }

        /* Username */
        .as-username {
          color: rgba(255,255,255,.55);
          font-size: 12px;
          font-family: 'Barlow Condensed', Impact, sans-serif;
          font-weight: 700;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          max-width: 160px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        /* Divider */
        .as-divider {
          width: 1px;
          height: 20px;
          background: rgba(255,255,255,.09);
          flex-shrink: 0;
        }

        /* Sign-out pill */
        .as-logout {
          display: flex;
          align-items: center;
          gap: 7px;
          padding: 7px 15px;
          border-radius: 99px;
          border: 1px solid rgba(255,255,255,.12);
          background: rgba(255,255,255,.04);
          color: rgba(255,255,255,.45);
          font-family: 'Barlow Condensed', Impact, sans-serif;
          font-weight: 700;
          font-size: 11px;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          cursor: pointer;
          transition: all 0.2s ease;
          white-space: nowrap;
          flex-shrink: 0;
        }

        .as-logout-icon {
          font-size: 13px;
          line-height: 1;
          transition: transform 0.2s ease;
        }

        .as-logout:hover:not(:disabled) {
          border-color: rgba(239,68,68,.5);
          background: rgba(239,68,68,.1);
          color: #f87171;
          box-shadow: 0 0 14px rgba(239,68,68,.18);
        }

        .as-logout:hover:not(:disabled) .as-logout-icon {
          transform: translateX(2px);
        }

        .as-logout:disabled {
          opacity: 0.35;
          cursor: not-allowed;
        }

        /* ── Main ── */
        .as-main {
          position: relative;
          z-index: 1;
          flex: 1;
          display: flex;
          flex-direction: column;
        }

        /* ── ChatWidget FAB ── */
        .chat-fab {
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        .chat-fab:hover {
          transform: scale(1.08);
          box-shadow: 0 8px 32px rgba(0,255,135,0.35) !important;
        }
        .chat-fab:active {
          transform: scale(0.95);
        }

        /* ── ChatPanel scrollbar ── */
        .chat-scroll::-webkit-scrollbar       { width: 4px; }
        .chat-scroll::-webkit-scrollbar-track { background: transparent; }
        .chat-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 99px; }
        .chat-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }

        /* ── ChatPanel quick prompts ── */
        .quick-prompt:hover {
          border-color: rgba(0,255,135,0.35) !important;
          background:   rgba(0,255,135,0.06) !important;
          color: white !important;
        }

        /* ── ChatPanel send button ── */
        .send-btn:not(:disabled):hover {
          background: rgba(0,255,135,0.25) !important;
        }
        .send-btn:disabled {
          opacity: 0.3;
          cursor: not-allowed;
        }

        /* ── ChatWidget panel animation ── */
        .chat-widget-panel {
          animation: chatSlideUp 0.22s cubic-bezier(0.16,1,0.3,1) both;
        }

        @media (max-width: 640px) {
          .as-username { display: none; }
          .as-header   { padding: 0 14px; }
          .as-divider  { display: none; }

          /* Content must clear the fixed bottom tab bar */
          .as-main {
            padding-bottom: calc(54px + env(safe-area-inset-bottom, 0px));
          }

          /* Keep the chat dock (FAB) above the tab bar */
          .chat-dock {
            bottom: calc(66px + env(safe-area-inset-bottom, 0px)) !important;
            right: 16px !important;
          }
        }
      `}</style>

      {/* Background glow */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 0,
          background: `
            radial-gradient(ellipse 55% 45% at 80% 15%, ${ACCENT}07 0%, transparent 60%),
            radial-gradient(ellipse 40% 50% at 10% 85%, #1a237e12 0%, transparent 55%)
          `,
        }}
      />

      {/* ── Header ── */}
      <header className="as-header">
        <Nav />

        <div className="as-user">
          <div className="as-avatar">
            {displayName.slice(0, 1).toUpperCase()}
          </div>

          <span className="as-username">{displayName}</span>

          <div className="as-divider" />

          <button
            className="as-logout"
            onClick={logout}
            disabled={loggingOut}
            title="Sign out"
          >
            {loggingOut ? (
              <>
                <span className="as-logout-icon">↻</span>
                Signing out
              </>
            ) : (
              <>
                <span className="as-logout-icon">→</span>
                Sign out
              </>
            )}
          </button>
        </div>
      </header>

      {/* ── Page content ── */}
      <main className="as-main">
        {children}
      </main>

      {/* ── Floating chat coach — renders on every app page ── */}
      <ChatWidget />

      {/* ── Mobile bottom tab bar (phones only) ── */}
      <MobileTabBar />
    </div>
  );
}
