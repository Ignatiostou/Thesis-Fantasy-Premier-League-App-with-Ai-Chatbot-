// apps/web/src/components/chatbot/MessageBubble.tsx

'use client';

import type { ChatMessage } from '@/lib/hooks/useChat';

interface Props {
  message:     ChatMessage;
  isStreaming?: boolean;
}

// Formats **bold** markdown and preserves line breaks
function formatContent(text: string) {
  return text.split('\n').map((line, i, arr) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g);
    const formatted = parts.map((part, j) =>
      part.startsWith('**') && part.endsWith('**') ? (
        <strong key={j} style={{ color: 'white', fontWeight: 700 }}>
          {part.slice(2, -2)}
        </strong>
      ) : (
        part
      ),
    );
    return (
      <span key={i}>
        {formatted}
        {i < arr.length - 1 && <br />}
      </span>
    );
  });
}

export function MessageBubble({ message, isStreaming }: Props) {
  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '3px 14px' }}>
        <div
          style={{
            maxWidth: '80%',
            background: 'rgba(0,255,135,0.1)',
            border: '1px solid rgba(0,255,135,0.2)',
            borderRadius: '14px 14px 4px 14px',
            padding: '9px 13px',
          }}
        >
          <p
            style={{
              color: 'rgba(255,255,255,0.9)',
              fontSize: 13,
              fontFamily: "'Barlow', sans-serif",
              fontWeight: 400,
              lineHeight: 1.5,
              margin: 0,
            }}
          >
            {message.content}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        padding: '3px 14px',
      }}
    >
      {/* Bot avatar */}
      <div
        style={{
          width: 26,
          height: 26,
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #00FF87, #00d4ff)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 12,
          flexShrink: 0,
          marginTop: 2,
          boxShadow: '0 0 8px rgba(0,255,135,0.2)',
        }}
      >
        ⚽
      </div>

      <div style={{ flex: 1, maxWidth: '85%' }}>
        <div
          style={{
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '4px 14px 14px 14px',
            padding: '9px 13px',
          }}
        >
          {message.content ? (
            <p
              style={{
                color: 'rgba(255,255,255,0.85)',
                fontSize: 13,
                fontFamily: "'Barlow', sans-serif",
                fontWeight: 400,
                lineHeight: 1.55,
                margin: 0,
              }}
            >
              {formatContent(message.content)}
              {/* Streaming cursor */}
              {isStreaming && (
                <span
                  style={{
                    display: 'inline-block',
                    width: 2,
                    height: 13,
                    background: '#00FF87',
                    marginLeft: 3,
                    borderRadius: 1,
                    verticalAlign: 'middle',
                    animation: 'chatPulse 0.8s ease-in-out infinite',
                  }}
                />
              )}
            </p>
          ) : (
            /* Thinking dots */
            <div style={{ display: 'flex', gap: 4, alignItems: 'center', padding: '2px 0' }}>
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: '50%',
                    background: 'rgba(255,255,255,0.25)',
                    animation: `chatBounce 1.2s ${i * 0.15}s ease-in-out infinite`,
                  }}
                />
              ))}
            </div>
          )}
        </div>

        <p
          style={{
            color: 'rgba(255,255,255,0.18)',
            fontSize: 9,
            fontFamily: "'Barlow', sans-serif",
            letterSpacing: '0.08em',
            margin: '4px 0 0 4px',
          }}
        >
          {new Date(message.createdAt).toLocaleTimeString([], {
            hour:   '2-digit',
            minute: '2-digit',
          })}
        </p>
      </div>
    </div>
  );
}
