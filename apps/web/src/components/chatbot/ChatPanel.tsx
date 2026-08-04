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

const QUICK_PROMPTS = [
  { icon: '👑', label: 'Who should I captain this week?',       category: 'Captain'  },
  { icon: '🔀', label: 'Suggest a transfer for me',             category: 'Transfer' },
  { icon: '📊', label: 'Analyse my squad strengths and risks',  category: 'Squad'    },
  { icon: '📅', label: 'How do my fixtures look next 3 GWs?',   category: 'Fixtures' },
  { icon: '🪑', label: "What's my optimal bench order?",        category: 'Bench'    },
  { icon: '🎰', label: 'Should I use a chip this week?',        category: 'Chips'    },
];

export function ChatPanel({ messages, isStreaming, error, onSend, onStop, onNewChat }: Props) {
  const [input,       setInput]       = useState('');
  const [copiedId,    setCopiedId]    = useState<string | null>(null);
  const bottomRef  = useRef<HTMLDivElement>(null);
  const inputRef   = useRef<HTMLTextAreaElement>(null);
  const isEmpty    = messages.length === 0;
  const charLimit  = 2000;
  const nearLimit  = input.length > charLimit * 0.85;

  // Auto-scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = inputRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 80)}px`;
  }, [input]);

  function handleSend() {
    const text = input.trim();
    if (!text || isStreaming || text.length > charLimit) return;
    setInput('');
    onSend(text);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function copyMessage(msg: ChatMessage) {
    navigator.clipboard.writeText(msg.content).then(() => {
      setCopiedId(msg.id);
      setTimeout(() => setCopiedId(null), 1800);
    });
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
        @keyframes chatPulse {
          0%,100% { transform: scale(1);    opacity: 1;   }
          50%      { transform: scale(1.08); opacity: 0.7; }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        .chat-scroll::-webkit-scrollbar { width: 4px; }
        .chat-scroll::-webkit-scrollbar-track { background: transparent; }
        .chat-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 99px; }
        .chat-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }

        .quick-prompt {
          transition: all 0.15s ease;
        }
        .quick-prompt:hover {
          border-color: rgba(0,255,135,0.35) !important;
          background: rgba(0,255,135,0.06) !important;
          transform: translateX(3px);
        }
        .send-btn:not(:disabled):hover {
          background: rgba(0,255,135,0.25) !important;
          transform: scale(1.05);
        }
        .send-btn { transition: all 0.15s ease; }
        .send-btn:disabled { opacity: 0.3; cursor: not-allowed; }

        .msg-copy-btn {
          opacity: 0;
          transition: opacity 0.15s ease;
        }
        .msg-row:hover .msg-copy-btn {
          opacity: 1;
        }

        .new-chat-btn:hover {
          border-color: rgba(0,255,135,0.3) !important;
          color: #00FF87 !important;
        }
        .new-chat-btn { transition: all 0.15s ease; }
      `}</style>

      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontFamily: "'Barlow', sans-serif" }}>

        {/* Sub-header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '7px 14px',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: isStreaming ? '#fbbf24' : '#00FF87',
                boxShadow: isStreaming ? '0 0 6px #fbbf24' : '0 0 6px #00FF87',
                transition: 'all 0.3s ease',
              }}
            />
            <span
              style={{
                color: 'rgba(255,255,255,0.3)',
                fontSize: 10,
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                fontFamily: "'Barlow Condensed', sans-serif",
                fontWeight: 600,
              }}
            >
              {isStreaming ? 'Thinking…' : messages.length > 0 ? `${messages.length} messages` : 'Ready'}
            </span>
          </div>

          <button
            className="new-chat-btn"
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
            }}
          >
            + New Chat
          </button>
        </div>

        {/* Messages */}
        <div
          className="chat-scroll"
          style={{ flex: 1, overflowY: 'auto', padding: '10px 0' }}
        >
          {isEmpty ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                height: '100%',
                padding: '16px 14px 0',
                gap: 12,
              }}
            >
              {/* Icon */}
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: '50%',
                  background: 'rgba(0,255,135,0.08)',
                  border: '1px solid rgba(0,255,135,0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 22,
                  boxShadow: '0 0 28px rgba(0,255,135,0.1)',
                }}
              >
                ⚽
              </div>

              <div style={{ textAlign: 'center' }}>
                <p
                  style={{
                    color: 'white',
                    fontSize: 15,
                    fontWeight: 800,
                    letterSpacing: '0.05em',
                    textTransform: 'uppercase',
                    fontFamily: "'Barlow Condensed', sans-serif",
                    margin: '0 0 3px',
                  }}
                >
                  Your Coach is Ready
                </p>
                <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11, lineHeight: 1.5, margin: 0 }}>
                  Ask anything about your FPL squad
                </p>
              </div>

              {/* Quick prompts */}
              <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 5 }}>
                {QUICK_PROMPTS.map((p) => (
                  <button
                    key={p.label}
                    className="quick-prompt"
                    onClick={() => onSend(p.label)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '8px 12px',
                      borderRadius: 10,
                      border: '1px solid rgba(255,255,255,0.07)',
                      background: 'rgba(255,255,255,0.03)',
                      color: 'rgba(255,255,255,0.55)',
                      fontSize: 12,
                      fontFamily: "'Barlow', sans-serif",
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 14 }}>{p.icon}</span>
                      {p.label}
                    </div>
                    <span
                      style={{
                        fontSize: 9,
                        color: 'rgba(255,255,255,0.2)',
                        fontFamily: "'Barlow Condensed', sans-serif",
                        letterSpacing: '0.1em',
                        textTransform: 'uppercase',
                        flexShrink: 0,
                      }}
                    >
                      {p.category}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {messages.map((msg) => (
                <div key={msg.id} className="msg-row" style={{ position: 'relative' }}>
                  <MessageBubble
                    message={msg}
                    isStreaming={msg.id === streamingMsgId}
                  />
                  {/* Copy button — appears on hover */}
                  {msg.role === 'assistant' && msg.content && (
                    <button
                      className="msg-copy-btn"
                      onClick={() => copyMessage(msg)}
                      title="Copy response"
                      style={{
                        position: 'absolute',
                        bottom: 18,
                        right: 14,
                        background: copiedId === msg.id ? 'rgba(0,255,135,0.15)' : 'rgba(255,255,255,0.06)',
                        border: `1px solid ${copiedId === msg.id ? 'rgba(0,255,135,0.3)' : 'rgba(255,255,255,0.1)'}`,
                        borderRadius: 6,
                        color: copiedId === msg.id ? '#00FF87' : 'rgba(255,255,255,0.35)',
                        fontSize: 10,
                        fontFamily: "'Barlow Condensed', sans-serif",
                        letterSpacing: '0.1em',
                        padding: '3px 8px',
                        cursor: 'pointer',
                      }}
                    >
                      {copiedId === msg.id ? '✓ Copied' : 'Copy'}
                    </button>
                  )}
                </div>
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
                  <span style={{ color: '#fca5a5', fontSize: 12, fontFamily: "'Barlow', sans-serif" }}>
                    {error}
                  </span>
                </div>
              )}
              <div ref={bottomRef} />
            </>
          )}
        </div>

        {/* Input */}
        <div style={{ padding: '8px 14px 12px', borderTop: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              gap: 8,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 12,
              padding: '8px 8px 8px 12px',
              transition: 'border-color 0.2s, box-shadow 0.2s',
            }}
            onFocusCapture={(e) => {
              (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(0,255,135,0.35)';
              (e.currentTarget as HTMLDivElement).style.boxShadow   = '0 0 0 3px rgba(0,255,135,0.07)';
            }}
            onBlurCapture={(e) => {
              (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(255,255,255,0.1)';
              (e.currentTarget as HTMLDivElement).style.boxShadow   = 'none';
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
              maxLength={charLimit}
              style={{
                flex: 1,
                background:  'transparent',
                border:      'none',
                outline:     'none',
                color:       nearLimit ? '#fbbf24' : 'white',
                fontSize:    13,
                fontFamily:  "'Barlow', sans-serif",
                fontWeight:  400,
                lineHeight:  1.5,
                resize:      'none',
                maxHeight:   80,
                overflowY:   'auto',
                scrollbarWidth: 'none',
                transition:  'color 0.2s',
              }}
            />

            {isStreaming ? (
              <button
                onClick={onStop}
                style={{
                  width: 32, height: 32,
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
                disabled={!input.trim() || input.length > charLimit}
                style={{
                  width: 32, height: 32,
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
                }}
              >
                ↑
              </button>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 5 }}>
            <p
              style={{
                color: 'rgba(255,255,255,0.12)',
                fontSize: 9,
                fontFamily: "'Barlow', sans-serif",
                letterSpacing: '0.1em',
                margin: 0,
              }}
            >
              ENTER TO SEND · SHIFT+ENTER FOR NEW LINE
            </p>
            {nearLimit && (
              <span
                style={{
                  color: input.length > charLimit * 0.95 ? '#ef4444' : '#fbbf24',
                  fontSize: 9,
                  fontFamily: "'Barlow', sans-serif",
                  letterSpacing: '0.05em',
                }}
              >
                {input.length}/{charLimit}
              </span>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
