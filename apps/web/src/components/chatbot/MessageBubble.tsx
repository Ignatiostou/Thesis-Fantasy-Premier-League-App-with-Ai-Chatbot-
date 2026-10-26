'use client';

import type { ChatMessage } from '@/lib/hooks/useChat';

interface Props {
  message:      ChatMessage;
  isStreaming?: boolean;
}

// ── Section header config ─────────────────────────────────────────────────────
// Maps heading text → emoji + colour treatment

const SECTION_STYLES: Array<{
  pattern: RegExp;
  emoji:   string;
  color:   string;
  bg:      string;
  border:  string;
}> = [
  { pattern: /squad strength/i,      emoji: '💪', color: '#4ade80', bg: 'rgba(74,222,128,0.07)',  border: 'rgba(74,222,128,0.2)'  },
  { pattern: /risk/i,                emoji: '⚠️', color: '#fbbf24', bg: 'rgba(251,191,36,0.07)',  border: 'rgba(251,191,36,0.2)'  },
  { pattern: /recommend/i,           emoji: '🏆', color: '#00FF87', bg: 'rgba(0,255,135,0.07)',   border: 'rgba(0,255,135,0.2)'   },
  { pattern: /captain/i,             emoji: '👑', color: '#fde68a', bg: 'rgba(253,230,138,0.07)', border: 'rgba(253,230,138,0.2)' },
  { pattern: /transfer/i,            emoji: '🔀', color: '#38bdf8', bg: 'rgba(56,189,248,0.07)',  border: 'rgba(56,189,248,0.2)'  },
  { pattern: /bench/i,               emoji: '🪑', color: '#94a3b8', bg: 'rgba(148,163,184,0.07)', border: 'rgba(148,163,184,0.2)' },
  { pattern: /form/i,                emoji: '📈', color: '#fb923c', bg: 'rgba(251,146,60,0.07)',  border: 'rgba(251,146,60,0.2)'  },
  { pattern: /fixture/i,             emoji: '📅', color: '#fb923c', bg: 'rgba(251,146,60,0.07)',  border: 'rgba(251,146,60,0.2)'  },
  { pattern: /budget|cost|price/i,   emoji: '💰', color: '#4ade80', bg: 'rgba(74,222,128,0.07)',  border: 'rgba(74,222,128,0.2)'  },
  { pattern: /chip/i,                emoji: '🎰', color: '#c084fc', bg: 'rgba(192,132,252,0.07)', border: 'rgba(192,132,252,0.2)' },
  { pattern: /ml|model|prediction/i, emoji: '🤖', color: '#a78bfa', bg: 'rgba(167,139,250,0.07)', border: 'rgba(167,139,250,0.2)' },
  { pattern: /analysis|analyse/i,    emoji: '📊', color: '#60a5fa', bg: 'rgba(96,165,250,0.07)',  border: 'rgba(96,165,250,0.2)'  },
  { pattern: /summary/i,             emoji: '📝', color: '#00FF87', bg: 'rgba(0,255,135,0.07)',   border: 'rgba(0,255,135,0.2)'   },
];



// Numbered item sub-label emojis (cycling through these for variety)
const ITEM_EMOJIS = ['💡', '🔍', '🎯', '⚡', '🔑', '📌', '🌟', '🚀'];

function getSectionStyle(text: string) {
  for (const s of SECTION_STYLES) {
    if (s.pattern.test(text)) return s;
  }
  // Default
  return { emoji: '📋', color: '#60a5fa', bg: 'rgba(96,165,250,0.07)', border: 'rgba(96,165,250,0.18)' };
}

/**
 * The model often writes its own icon into the heading ("## 🧤 Goalkeepers"),
 * and prepending ours on top of it read as "📋 🧤 GOALKEEPERS". Its choice is
 * the more specific one, so use that and keep only the colour from ours.
 */
function splitLeadingEmoji(text: string): { emoji: string | null; rest: string } {
  const match = text.match(
    /^([\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{200D}]+)\s*(.*)$/u,
  );
  if (!match || !match[2].trim()) return { emoji: null, rest: text };
  return { emoji: match[1], rest: match[2].trim() };
}

// ── Inline text formatter ─────────────────────────────────────────────────────

function formatInline(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} style={{ color: 'white', fontWeight: 700 }}>
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return (
        <em key={i} style={{ color: 'rgba(255,255,255,0.75)', fontStyle: 'italic' }}>
          {part.slice(1, -1)}
        </em>
      );
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={i}
          style={{
            background: 'rgba(0,255,135,0.12)',
            borderRadius: 4,
            padding: '1px 5px',
            fontSize: 11,
            fontFamily: 'monospace',
            color: '#00FF87',
          }}
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    // Hide incomplete bold delimiters while a streamed phrase is arriving.
    return <span key={i}>{part.replace(/\*\*/g, '')}</span>;
  });
}

// ── Block types ───────────────────────────────────────────────────────────────

type Block =
  | { type: 'heading';  text: string; level: number }
  | { type: 'numbered-section'; n: number; title: string; body: string }
  | { type: 'bullet';   text: string; indent: number }
  | { type: 'text';     text: string }
  | { type: 'table';    headers: string[]; rows: string[][]; numeric: boolean[] }
  | { type: 'divider' };

// ── Markdown tables ───────────────────────────────────────────────────────────
// The model answers player questions with pipe tables. Falling through to the
// plain-text branch printed them as raw pipe soup, which is most of what made a
// long answer unreadable.

const TABLE_ROW     = /^\s*\|.*\|\s*$/;
const TABLE_DIVIDER = /^\s*\|(?:\s*:?-{2,}:?\s*\|)+\s*$/;

function splitTableRow(line: string): string[] {
  return line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
}

/** Numeric columns read far better right-aligned — "£12.0m", "5.56", "98%". */
function isNumericCell(cell: string): boolean {
  const bare = cell.replace(/\*\*/g, '').trim();
  return bare !== '' && /^[£$€]?[+-]?[\d.,]+\s*(?:m|k|%|pts?)?$/i.test(bare);
}

function parseBlocks(content: string): Block[] {
  const lines  = content.split('\n');
  const blocks: Block[] = [];
  let   i      = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Skip blank lines
    if (line.trim() === '') { i++; continue; }

    // Horizontal rule
    if (/^[-─=]{3,}$/.test(line.trim())) {
      blocks.push({ type: 'divider' });
      i++; continue;
    }

    // Markdown table: a header row, usually an alignment row, then body rows.
    if (TABLE_ROW.test(line)) {
      const next = i + 1 < lines.length ? lines[i + 1] : null;

      // A pipe row on its own is a table still arriving mid-stream — drop it
      // rather than flashing raw pipes before the rest of the rows land.
      if (next === null || (!TABLE_DIVIDER.test(next) && !TABLE_ROW.test(next))) {
        i++; continue;
      }

      const headers = splitTableRow(line);
      const rows: string[][] = [];

      let j = TABLE_DIVIDER.test(next) ? i + 2 : i + 1;
      while (j < lines.length && TABLE_ROW.test(lines[j])) {
        if (!TABLE_DIVIDER.test(lines[j])) {
          const cells = splitTableRow(lines[j]);
          // Pad or trim so every row lines up with the header.
          rows.push(
            Array.from({ length: headers.length }, (_, c) => cells[c] ?? ''),
          );
        }
        j++;
      }

      const numeric = headers.map(
        (_, c) => rows.length > 0 && rows.every((r) => isNumericCell(r[c])),
      );

      blocks.push({ type: 'table', headers, rows, numeric });
      i = j;
      continue;
    }

    // ### Heading  (LLM uses ### Squad Strengths, ### Risks, ### Recommendations)
    const h3Match = line.match(/^(#{1,4})\s+(.+)/);
    if (h3Match) {
      blocks.push({
        type:  'heading',
        text:  h3Match[2].trim(),
        level: h3Match[1].length,
      });
      i++; continue;
    }

    // Numbered item with bold title on same line: "1.**Premium Midfield Assets**"
    // or split: "1.Premium Midfield Assets\n▸ body text"
    // Patterns: "1.Text", "1. Text", "1.**Text**"
    const numMatch = line.match(/^(\d+)\.\s*(.+?)\s*$/);
    if (numMatch) {
      const n     = parseInt(numMatch[1]);
      const title = numMatch[2].trim();

      // Collect following bullet lines as the body
      const bodyLines: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const next = lines[j].trim();
        if (next === '') { j++; break; }                    // blank → end of item
        if (/^\d+\./.test(next)) break;                     // next numbered item
        if (/^#{1,3}/.test(next)) break;                    // next heading
        if (/^[-─=]{3,}$/.test(next)) break;               // divider
        // Strip leading ▸, -, •, * bullet markers
        const stripped = next.replace(/^(?:[▸\-•]\s*|\*\s+)/, '').trim();
        if (stripped) bodyLines.push(stripped);
        j++;
      }

      blocks.push({
        type:  'numbered-section',
        n,
        title,
        body:  bodyLines.join(' '),
      });
      i = j;
      continue;
    }

    // Bullet: ▸, -, •, *
    const bulletMatch = line.match(/^(\s*)[▸\-•*]\s+(.+)/);
    if (bulletMatch) {
      const indent = Math.floor(bulletMatch[1].length / 2);
      blocks.push({ type: 'bullet', text: bulletMatch[2].trim(), indent });
      i++; continue;
    }

    // Plain text
    blocks.push({ type: 'text', text: line.trim() });
    i++;
  }

  return blocks;
}

// ── Renderer ──────────────────────────────────────────────────────────────────

function renderBlocks(blocks: Block[], isStreaming?: boolean) {
  return blocks.map((block, idx) => {
    const isLast = idx === blocks.length - 1;

    switch (block.type) {

      // ── ### Heading ──────────────────────────────────────────────────────────
      case 'heading': {
        const { emoji, rest } = splitLeadingEmoji(block.text);
        const s = getSectionStyle(rest);
        const icon = emoji ?? s.emoji;

        // A long answer usually opens with one `#` title over several `##`
        // sections. Rendering both as the same pill flattened that structure
        // and left the reader with no sense of where the answer began.
        if (block.level === 1) {
          return (
            <div
              key={idx}
              style={{
                display:      'flex',
                alignItems:   'baseline',
                gap:           8,
                marginTop:     idx === 0 ? 0 : 16,
                marginBottom:  10,
                paddingBottom: 8,
                borderBottom: '1px solid rgba(255,255,255,0.08)',
              }}
            >
              {/* No fallback icon here: on the answer's title a generic 📋 is
                  decoration competing with the words. */}
              {emoji && <span style={{ fontSize: 16, alignSelf: 'center' }}>{emoji}</span>}
              <span
                style={{
                  color:         'white',
                  fontSize:       16,
                  fontWeight:     800,
                  letterSpacing: '0.03em',
                  lineHeight:     1.25,
                  fontFamily:    "'Barlow Condensed', sans-serif",
                }}
              >
                {formatInline(rest)}
              </span>
            </div>
          );
        }

        return (
          <div
            key={idx}
            style={{
              display:    'flex',
              alignItems: 'center',
              gap:         8,
              background:  s.bg,
              border:     `1px solid ${s.border}`,
              borderRadius: 10,
              padding:    '7px 12px',
              marginTop:   idx === 0 ? 0 : 14,
              marginBottom: 8,
            }}
          >
            <span style={{ fontSize: 15 }}>{icon}</span>
            <span
              style={{
                color:         s.color,
                fontSize:       12,
                fontWeight:     700,
                letterSpacing: '0.07em',
                textTransform: 'uppercase',
                fontFamily:    "'Barlow Condensed', sans-serif",
              }}
            >
              {formatInline(rest)}
            </span>
          </div>
        );
      }

      // ── Numbered section card ─────────────────────────────────────────────────
      case 'numbered-section': {
        const icon = ITEM_EMOJIS[(block.n - 1) % ITEM_EMOJIS.length];
        return (
          <div
            key={idx}
            style={{
              background:   'rgba(255,255,255,0.03)',
              border:       '1px solid rgba(255,255,255,0.07)',
              borderLeft:   '3px solid rgba(0,255,135,0.4)',
              borderRadius: 10,
              padding:      '9px 12px',
              marginBottom:  8,
              display:      'flex',
              gap:           10,
              alignItems:   'flex-start',
            }}
          >
            {/* Number badge */}
            <div
              style={{
                width:          22,
                height:         22,
                borderRadius:  '50%',
                background:    'rgba(0,255,135,0.12)',
                border:        '1px solid rgba(0,255,135,0.25)',
                display:       'flex',
                alignItems:    'center',
                justifyContent:'center',
                flexShrink:     0,
                marginTop:      1,
              }}
            >
              <span
                style={{
                  color:      '#00FF87',
                  fontSize:    10,
                  fontWeight:  700,
                  fontFamily: "'Barlow Condensed', sans-serif",
                  lineHeight:  1,
                }}
              >
                {block.n}
              </span>
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              {/* Title row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                <span style={{ fontSize: 13 }}>{icon}</span>
                <span
                  style={{
                    color:      'white',
                    fontSize:    13,
                    fontWeight:  700,
                    fontFamily: "'Barlow', sans-serif",
                    lineHeight:  1.3,
                  }}
                >
                  {formatInline(block.title)}
                </span>
              </div>

              {/* Body text */}
              {block.body && (
                <p
                  style={{
                    color:      'rgba(255,255,255,0.7)',
                    fontSize:    12,
                    fontFamily: "'Barlow', sans-serif",
                    lineHeight:  1.6,
                    margin:      0,
                  }}
                >
                  {formatInline(block.body)}
                </p>
              )}
            </div>
          </div>
        );
      }

      // ── Bullet ───────────────────────────────────────────────────────────────
      case 'bullet': {
        const indent = Math.min(block.indent, 2);
        return (
          <div
            key={idx}
            style={{
              display:     'flex',
              gap:          8,
              alignItems:  'flex-start',
              paddingLeft:  indent * 14,
              marginBottom: 5,
            }}
          >
            <span
              style={{
                color:     '#00FF87',
                fontSize:   10,
                marginTop:  4,
                flexShrink: 0,
                opacity:    0.7,
              }}
            >
              ▸
            </span>
            <span
              style={{
                color:      'rgba(255,255,255,0.82)',
                fontSize:    13,
                fontFamily: "'Barlow', sans-serif",
                lineHeight:  1.55,
              }}
            >
              {formatInline(block.text)}
            </span>
          </div>
        );
      }

      // ── Table ────────────────────────────────────────────────────────────────
      case 'table':
        return (
          <div key={idx} className="chat-table-wrap">
            <table className="chat-table">
              <thead>
                <tr>
                  {block.headers.map((h, c) => (
                    <th key={c} style={{ textAlign: block.numeric[c] ? 'right' : 'left' }}>
                      {formatInline(h)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, c) => (
                      <td
                        key={c}
                        style={{
                          textAlign: block.numeric[c] ? 'right' : 'left',
                          // Tabular figures keep the decimal points in a column
                          // of xPts values lined up under each other.
                          fontVariantNumeric: block.numeric[c] ? 'tabular-nums' : 'normal',
                          whiteSpace: c === 0 || block.numeric[c] ? 'nowrap' : 'normal',
                        }}
                      >
                        {formatInline(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );

      // ── Divider ──────────────────────────────────────────────────────────────
      case 'divider':
        return (
          <div
            key={idx}
            style={{
              height:     1,
              background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.07), transparent)',
              margin:     '10px 0',
            }}
          />
        );

      // ── Plain text ───────────────────────────────────────────────────────────
      case 'text':
        return (
          <p
            key={idx}
            style={{
              color:      'rgba(255,255,255,0.82)',
              fontSize:    13,
              fontFamily: "'Barlow', sans-serif",
              lineHeight:  1.65,
              margin:     '0 0 8px',
            }}
          >
            {formatInline(block.text)}
            {isStreaming && isLast && (
              <span
                style={{
                  display:        'inline-block',
                  width:           2,
                  height:          13,
                  background:     '#00FF87',
                  marginLeft:      3,
                  borderRadius:    1,
                  verticalAlign: 'middle',
                  animation:     'chatPulse 0.8s ease-in-out infinite',
                }}
              />
            )}
          </p>
        );

      default:
        return null;
    }
  });
}

// ── Provenance badge ──────────────────────────────────────────────────────────
// The API tells us whether an answer was driven by the ML models or by the
// rule-based engine. Surfacing it lets the user see where the advice came from
// instead of taking every reply on the same trust.

const SOURCE_BADGE: Record<string, { label: string; emoji: string; color: string }> = {
  ML:              { label: 'ML-based',   emoji: '🤖', color: '#a78bfa' },
  ML_ONLY:         { label: 'ML-based',   emoji: '🤖', color: '#a78bfa' },
  HEURISTIC:       { label: 'Rule-based', emoji: '📐', color: '#60a5fa' },
  HEURISTIC_ONLY:  { label: 'Rule-based', emoji: '📐', color: '#60a5fa' },
};

function SourceBadge({ source, reason }: { source: string; reason?: string }) {
  const cfg = SOURCE_BADGE[source];
  if (!cfg) return null;
  return (
    <div
      title={reason}
      style={{
        display:      'inline-flex',
        alignItems:   'center',
        gap:           5,
        alignSelf:    'flex-start',
        background:   `${cfg.color}1a`,
        border:       `1px solid ${cfg.color}40`,
        borderRadius:  6,
        padding:      '2px 7px',
        marginBottom:  8,
      }}
    >
      <span style={{ fontSize: 10 }}>{cfg.emoji}</span>
      <span
        style={{
          color:          cfg.color,
          fontSize:        9,
          fontWeight:      700,
          letterSpacing:  '0.08em',
          textTransform:  'uppercase',
          fontFamily:     "'Barlow Condensed', sans-serif",
        }}
      >
        {cfg.label}
      </span>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function MessageBubble({ message, isStreaming }: Props) {
  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '3px 14px' }}>
        <div
          style={{
            maxWidth:     '80%',
            background:   'rgba(0,255,135,0.1)',
            border:       '1px solid rgba(0,255,135,0.2)',
            borderRadius: '14px 14px 4px 14px',
            padding:      '9px 13px',
          }}
        >
          <p
            style={{
              color:      'rgba(255,255,255,0.9)',
              fontSize:    13,
              fontFamily: "'Barlow', sans-serif",
              fontWeight:  400,
              lineHeight:  1.5,
              margin:      0,
            }}
          >
            {message.content}
          </p>
        </div>
      </div>
    );
  }

  const blocks = parseBlocks(message.content ?? '');

  return (
    <div
      style={{
        display:    'flex',
        alignItems: 'flex-start',
        gap:         8,
        padding:    '4px 14px',
      }}
    >
      {/* Bot avatar */}
      <div
        style={{
          width:         26,
          height:        26,
          borderRadius: '50%',
          background:   'linear-gradient(135deg, #00FF87, #00d4ff)',
          display:      'flex',
          alignItems:   'center',
          justifyContent:'center',
          fontSize:      12,
          flexShrink:    0,
          marginTop:     2,
          boxShadow:    '0 0 8px rgba(0,255,135,0.2)',
        }}
      >
        ⚽
      </div>

      {/* Long answers carry tables the panel is already tight for — the old
          85% cap gave that width away for no gain, since the avatar and the
          bubble padding are the visual inset. */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            background:   'rgba(255,255,255,0.03)',
            border:       '1px solid rgba(255,255,255,0.07)',
            borderRadius: '4px 14px 14px 14px',
            padding:      '11px 13px',
          }}
        >
          {message.content ? (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {message.primarySource && (
                <SourceBadge source={message.primarySource} reason={message.sourceReason} />
              )}
              {renderBlocks(blocks, isStreaming)}
              {/* Streaming cursor on very last block if not already on a text block */}
              {isStreaming && blocks.length > 0 && blocks[blocks.length - 1].type !== 'text' && (
                <span
                  style={{
                    display:        'inline-block',
                    width:           2,
                    height:          13,
                    background:     '#00FF87',
                    borderRadius:    1,
                    verticalAlign: 'middle',
                    animation:     'chatPulse 0.8s ease-in-out infinite',
                    marginTop:       4,
                  }}
                />
              )}
            </div>
          ) : message.statusText ? (
            /* Named status — a long-running step is in progress (e.g. the
               initial-squad ML optimizer), so say what's happening instead
               of leaving a plain spinner up for up to a minute. */
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '2px 0' }}>
              <div
                style={{
                  width:        12,
                  height:       12,
                  borderRadius:'50%',
                  border:       '2px solid rgba(0,255,135,0.2)',
                  borderTopColor: '#00FF87',
                  animation:    'spin 0.8s linear infinite',
                  flexShrink:   0,
                }}
              />
              <span
                style={{
                  color:      'rgba(255,255,255,0.65)',
                  fontSize:    12,
                  fontFamily: "'Barlow', sans-serif",
                  lineHeight:  1.5,
                }}
              >
                {message.statusText}
              </span>
            </div>
          ) : (
            /* Thinking dots */
            <div style={{ display: 'flex', gap: 4, alignItems: 'center', padding: '2px 0' }}>
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  style={{
                    width:        5,
                    height:       5,
                    borderRadius:'50%',
                    background:  'rgba(255,255,255,0.25)',
                    animation:   `chatBounce 1.2s ${i * 0.15}s ease-in-out infinite`,
                  }}
                />
              ))}
            </div>
          )}
        </div>

        <p
          style={{
            color:      'rgba(255,255,255,0.5)',
            fontSize:    10,
            fontFamily: "'Barlow', sans-serif",
            letterSpacing:'0.08em',
            margin:     '4px 0 0 4px',
          }}
        >
          {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
    </div>
  );
}
