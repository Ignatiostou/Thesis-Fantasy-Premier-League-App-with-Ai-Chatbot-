// apps/web/src/components/chatbot/ChatPanel.tsx

'use client';

import { useEffect, useRef, useState, KeyboardEvent } from 'react';
import type { ChatMessage } from '@/lib/hooks/useChat';
import { MessageBubble } from './MessageBubble';

interface Props {
  messages:    ChatMessage[];
  isStreaming: boolean;
  error:       string | null;
  onSend:      (text: string) => void;
  onStop:      () => void;
  onNewChat:   () => void;
}

// Quick-start prompts shown on empty state
const QUICK_PROMPTS = [
  { icon: '👑', label: 'Who should I captain this week?' },
  { icon: '🔄', label: 'Suggest a transfer for me' },
  { icon: '📊', label: 'Analyse my squad' },
  { icon: '📅', label: 'Check my upcoming fixtures' },
];

export function ChatPanel({ messages, isStreaming, error, onSend, onStop, onNewChat }: Props) {
  const [input,   setInput]   = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);
  const isEmpty   = messages.length === 0;

  // Auto-scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function handleSend() {
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput('');
    onSend(text);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const lastMsg        = messages[messages.length - 1];
  const streamingMsgId = isStreaming && lastMsg?.role === 'assistant' ? lastMsg.id : null;

  return (
    <>
      <style>{`
        @keyframes chatBounce {
          0%,100% { transform: translateY(0);    opacity: 0.3; }
          50%      { transform: translateY(-4px); opacity: 1;   }
        }
        .chat-scroll::-webkit-scrollbar { width: 4px; }
        .chat-scroll::-webkit-scrollbar-track { background: transparent; }
        .chat-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 99px; }
        .chat-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }
        .quick-prompt:hover {
          border-color: rgba(0,255,135,0.35) !important;
          background: rgba(0,255,135,0.06) !important;
          color: white !important;
        }
        .send-btn:not(:disabled):hover {
          background: rgba(0,255,135,0.25) !important;
        }
        .send-btn:disabled { opacity: 0.3; cursor: not-allowed; }
      `}</style>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          fontFamily: "'Barlow', sans-serif",
        }}
      >
        {/* Sub-header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 14px',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            flexShrink: 0,
          }}
        >
          <span
            style={{
              color: 'rgba(255,255,255,0.25)',
              fontSize: 10,
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              fontFamily: "'Barlow Condensed', sans-serif",
              fontWeight: 600,
            }}
          >
            {isStreaming ? 'Thinking…' : 'Ready'}
          </span>
          <button
            onClick={onNewChat}
            style={{
              background: 'none',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 8,
              color: 'rgba(255,255,255,0.35)',
              fontSize: 10,
              fontFamily: "'Barlow Condensed', sans-serif",
              fontWeight: 600,
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              cursor: 'pointer',
              padding: '4px 10px',
              transition: 'all 0.15s',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(0,255,135,0.3)';
              (e.currentTarget as HTMLButtonElement).style.color = '#00FF87';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.1)';
              (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.35)';
            }}
          >
            + New Chat
          </button>
        </div>

        {/* Messages */}
        <div
          className="chat-scroll"
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '10px 0',
          }}
        >
          {isEmpty ? (
            /* Welcome / empty state */
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                padding: '0 18px',
                gap: 16,
              }}
            >
              {/* Icon — matches your slide icon circles */}
              <div style={{ position: 'relative' }}>
                <div
                  style={{
                    width: 60,
                    height: 60,
                    borderRadius: '50%',
                    background: 'rgba(0,255,135,0.08)',
                    border: '1px solid rgba(0,255,135,0.2)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 26,
                    boxShadow: '0 0 32px rgba(0,255,135,0.12)',
                  }}
                >
                  ⚽
                </div>
              </div>

              <div style={{ textAlign: 'center' }}>
                <p
                  style={{
                    color: 'white',
                    fontSize: 16,
                    fontWeight: 800,
                    letterSpacing: '0.05em',
                    textTransform: 'uppercase',
                    fontFamily: "'Barlow Condensed', sans-serif",
                    margin: '0 0 4px',
                  }}
                >
                  Your Coach is Ready
                </p>
                <p
                  style={{
                    color: 'rgba(255,255,255,0.3)',
                    fontSize: 12,
                    lineHeight: 1.5,
                    margin: 0,
                  }}
                >
                  Ask me anything about your FPL squad
                </p>
              </div>

              {/* Quick prompts — matching your pill stat style */}
              <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                {QUICK_PROMPTS.map((p) => (
                  <button
                    key={p.label}
                    className="quick-prompt"
                    onClick={() => onSend(p.label)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '9px 13px',
                      borderRadius: 10,
                      border: '1px solid rgba(255,255,255,0.07)',
                      background: 'rgba(255,255,255,0.03)',
                      color: 'rgba(255,255,255,0.55)',
                      fontSize: 12,
                      fontFamily: "'Barlow', sans-serif",
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                    }}
                  >
                    <span style={{ fontSize: 15 }}>{p.icon}</span>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {messages.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  isStreaming={msg.id === streamingMsgId}
                />
              ))}

              {error && (
                <div
                  style={{
                    margin: '4px 14px',
                    padding: '9px 12px',
                    borderRadius: 10,
                    background: 'rgba(239,68,68,0.08)',
                    border: '1px solid rgba(239,68,68,0.2)',
                    display: 'flex',
                    gap: 8,
                    alignItems: 'center',
                  }}
                >
                  <span style={{ fontSize: 13 }}>⚠️</span>
                  <span
                    style={{
                      color: '#fca5a5',
                      fontSize: 12,
                      fontFamily: "'Barlow', sans-serif",
                    }}
                  >
                    {error}
                  </span>
                </div>
              )}
              <div ref={bottomRef} />
            </>
          )}
        </div>

        {/* Input — matches your auth-input style */}
        <div
          style={{
            padding: '10px 14px 14px',
            borderTop: '1px solid rgba(255,255,255,0.06)',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              gap: 8,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 12,
              padding: '8px 8px 8px 12px',
              transition: 'border-color 0.2s',
            }}
            onFocusCapture={(e) => {
              (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(0,255,135,0.35)';
              (e.currentTarget as HTMLDivElement).style.boxShadow = '0 0 0 3px rgba(0,255,135,0.07)';
            }}
            onBlurCapture={(e) => {
              (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(255,255,255,0.1)';
              (e.currentTarget as HTMLDivElement).style.boxShadow = 'none';
            }}
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask your coach…"
              rows={1}
              disabled={isStreaming}
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: 'white',
                fontSize: 13,
                fontFamily: "'Barlow', sans-serif",
                fontWeight: 400,
                lineHeight: 1.5,
                resize: 'none',
                maxHeight: 80,
                overflowY: 'auto',
                scrollbarWidth: 'none',
              }}
            />

            {isStreaming ? (
              <button
                onClick={onStop}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  border: '1px solid rgba(239,68,68,0.4)',
                  background: 'rgba(239,68,68,0.1)',
                  color: '#fca5a5',
                  fontSize: 10,
                  cursor: 'pointer',
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontFamily: "'Barlow Condensed', sans-serif",
                  fontWeight: 700,
                  letterSpacing: '0.05em',
                }}
              >
                ■
              </button>
            ) : (
              <button
                className="send-btn"
                onClick={handleSend}
                disabled={!input.trim()}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  border: '1px solid rgba(0,255,135,0.3)',
                  background: 'rgba(0,255,135,0.12)',
                  color: '#00FF87',
                  fontSize: 15,
                  cursor: 'pointer',
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'background 0.15s',
                }}
              >
                ↑
              </button>
            )}
          </div>

          <p
            style={{
              textAlign: 'center',
              color: 'rgba(255,255,255,0.12)',
              fontSize: 9,
              fontFamily: "'Barlow', sans-serif",
              letterSpacing: '0.1em',
              marginTop: 6,
              marginBottom: 0,
            }}
          >
            ENTER TO SEND · SHIFT+ENTER FOR NEW LINE
          </p>
        </div>
      </div>
    </>
  );
}
