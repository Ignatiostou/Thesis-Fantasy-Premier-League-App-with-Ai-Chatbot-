

'use client';

import { useState, useEffect, useRef } from 'react';
import { useChat }       from '@/lib/hooks/useChat';
import { useOnboarding } from '@/lib/hooks/useOnboarding';
import { OnboardingFlow } from './OnboardingFlow';
import { ChatPanel }      from './ChatPanel';

export function ChatWidget() {
  const [isOpen,    setIsOpen]    = useState(false);
  const [hasUnread, setHasUnread] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const chat       = useChat();
  const onboarding = useOnboarding();

  // Load onboarding status when panel first opens
  useEffect(() => {
    if (isOpen) onboarding.loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Track unread messages while panel is closed
  useEffect(() => {
    if (!isOpen && chat.messages.length > 0) {
      const last = chat.messages[chat.messages.length - 1];
      if (last.role === 'assistant') setHasUnread(true);
    }
  }, [chat.messages, isOpen]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    function onDown(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [isOpen]);

  const showOnboarding = onboarding.status !== null && !onboarding.isCompleted;
  const showChat       = onboarding.status !== null &&  onboarding.isCompleted;
  const statusLoading  = isOpen && onboarding.status === null;

  return (
    <>
      <style>{`
        @keyframes chatSlideUp {
          from { opacity: 0; transform: translateY(14px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0)    scale(1);    }
        }
        @keyframes chatPulse {
          0%,100% { transform: scale(1); }
          50%     { transform: scale(1.08); }
        }
        .chat-widget-panel {
          animation: chatSlideUp 0.22s cubic-bezier(0.16,1,0.3,1) both;
        }
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
      `}</style>

      <div
        style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: 12,
          fontFamily: "'Barlow Condensed', 'Impact', sans-serif",
        }}
      >
        {/* ── Panel ── */}
        {isOpen && (
          <div
            ref={panelRef}
            className="chat-widget-panel"
            style={{
              width: 370,
              height: 540,
              borderRadius: 20,
              background: '#0f1623',
              border: '1px solid rgba(255,255,255,0.09)',
              boxShadow: '0 24px 80px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            {/* Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '14px 18px',
                borderBottom: '1px solid rgba(255,255,255,0.07)',
                background: 'rgba(0,255,135,0.04)',
                flexShrink: 0,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {/* Logo dot — matches your header "F" badge */}
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: '50%',
                    background: 'linear-gradient(135deg, #00FF87 0%, #00d4ff 100%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 16,
                    boxShadow: '0 0 16px rgba(0,255,135,0.3)',
                    flexShrink: 0,
                  }}
                >
                  ⚽
                </div>
                <div>
                  <p
                    style={{
                      color: 'white',
                      fontSize: 15,
                      fontWeight: 800,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      margin: 0,
                      lineHeight: 1,
                    }}
                  >
                    CoachBot
                  </p>
                  <p
                    style={{
                      color: showOnboarding ? '#00FF87' : 'rgba(255,255,255,0.35)',
                      fontSize: 10,
                      fontFamily: "'Barlow', sans-serif",
                      fontWeight: 500,
                      letterSpacing: '0.15em',
                      textTransform: 'uppercase',
                      margin: '3px 0 0',
                    }}
                  >
                    {showOnboarding ? 'Profile Setup' : 'FPL Assistant'}
                  </p>
                </div>
              </div>

              {/* Live indicator + close */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {showChat && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <div
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        background: '#00FF87',
                        animation: 'chatPulse 2s ease-in-out infinite',
                      }}
                    />
                    <span
                      style={{
                        color: '#00FF87',
                        fontSize: 9,
                        fontWeight: 600,
                        letterSpacing: '0.2em',
                        textTransform: 'uppercase',
                        fontFamily: "'Barlow', sans-serif",
                      }}
                    >
                      Live
                    </span>
                  </div>
                )}
                <button
                  onClick={() => setIsOpen(false)}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 8,
                    border: '1px solid rgba(255,255,255,0.1)',
                    background: 'rgba(255,255,255,0.05)',
                    color: 'rgba(255,255,255,0.5)',
                    fontSize: 18,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    lineHeight: 1,
                    transition: 'background 0.15s, color 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.1)';
                    (e.currentTarget as HTMLButtonElement).style.color = 'white';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.05)';
                    (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.5)';
                  }}
                >
                  ×
                </button>
              </div>
            </div>

            {/* Accent line — matches your page top bar */}
            <div style={{ height: 2, background: 'linear-gradient(90deg, #00FF87, #00d4ff)', flexShrink: 0 }} />

            {/* Content */}
            <div style={{ flex: 1, overflow: 'hidden' }}>
              {statusLoading && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      border: '2px solid rgba(0,255,135,0.2)',
                      borderTop: '2px solid #00FF87',
                      borderRadius: '50%',
                      animation: 'spin 0.7s linear infinite',
                    }}
                  />
                </div>
              )}
              {showOnboarding && <OnboardingFlow onComplete={() => onboarding.loadStatus()} />}
              {showChat && (
                <ChatPanel
                  messages={chat.messages}
                  isStreaming={chat.isStreaming}
                  error={chat.error}
                  onSend={chat.sendMessage}
                  onStop={chat.stopStreaming}
                  onNewChat={chat.newSession}
                />
              )}
            </div>
          </div>
        )}

        {/* ── FAB button ── */}
        <button
          className="chat-fab"
          onClick={() => {
            setIsOpen((v) => !v);
            setHasUnread(false);
          }}
          style={{
            width: 56,
            height: 56,
            borderRadius: '50%',
            border: 'none',
            cursor: 'pointer',
            position: 'relative',
            background: isOpen
              ? 'rgba(255,255,255,0.08)'
              : 'linear-gradient(135deg, #00FF87 0%, #00d4ff 100%)',
            boxShadow: isOpen
              ? '0 4px 16px rgba(0,0,0,0.4)'
              : '0 4px 24px rgba(0,255,135,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: isOpen ? 22 : 24,
            color: isOpen ? 'rgba(255,255,255,0.7)' : '#0a0e1a',
          }}
          aria-label={isOpen ? 'Close CoachBot' : 'Open CoachBot'}
        >
          {isOpen ? '×' : '⚽'}

          {/* Unread badge */}
          {hasUnread && !isOpen && (
            <span
              style={{
                position: 'absolute',
                top: -2,
                right: -2,
                width: 14,
                height: 14,
                borderRadius: '50%',
                background: '#ef4444',
                border: '2px solid #0a0e1a',
                animation: 'chatPulse 1.5s ease-in-out infinite',
              }}
            />
          )}
        </button>
      </div>
    </>
  );
}
