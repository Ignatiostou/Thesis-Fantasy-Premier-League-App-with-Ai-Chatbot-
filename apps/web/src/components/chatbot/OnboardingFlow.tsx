// apps/web/src/components/chatbot/OnboardingFlow.tsx
'use client';

import { useEffect, useState } from 'react';
import type { CompleteOnboardingInput } from '@fpl/types';
import { useOnboarding } from '@/lib/hooks/useOnboarding';

interface Props {
  onComplete: () => void;
}

// Maps question IDs to a descriptive emoji + category label
const QUESTION_META: Record<string, { emoji: string; category: string }> = {
  riskTolerance:          { emoji: '🎲', category: 'Risk'         },
  budgetStyle:            { emoji: '💰', category: 'Budget'       },
  preferredFocus:         { emoji: '🎯', category: 'Focus'        },
  differentialPreference: { emoji: '🔀', category: 'Differentials'},
  planningHorizon:        { emoji: '📅', category: 'Horizon'      },
  explanationDepth:       { emoji: '📖', category: 'Detail'       },
  captaincyStyle:         { emoji: '👑', category: 'Captaincy'    },
  transferFrequency:      { emoji: '🔄', category: 'Transfers'    },
  fixtureAwareness:       { emoji: '🗓️', category: 'Fixtures'    },
  topSixAffinity:         { emoji: '⭐', category: 'Big Six'      },
};

export function OnboardingFlow({ onComplete }: Props) {
  const { questions, loading, error, loadQuestions, saveStep, complete } = useOnboarding();

  const [currentStep, setCurrentStep] = useState(0);
  const [answers,     setAnswers]     = useState<Partial<CompleteOnboardingInput>>({});
  const [selected,    setSelected]    = useState<number | null>(null);
  const [animating,   setAnimating]   = useState(false);
  const [saving,      setSaving]      = useState(false);

  useEffect(() => { loadQuestions(); }, [loadQuestions]);

  if (questions.length === 0) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          gap: 12,
          fontFamily: "'Barlow', sans-serif",
        }}
      >
        <div
          style={{
            width: 28, height: 28,
            border: '2px solid rgba(0,255,135,0.2)',
            borderTop: '2px solid #00FF87',
            borderRadius: '50%',
            animation: 'spin 0.7s linear infinite',
          }}
        />
        <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, letterSpacing: '0.1em', margin: 0 }}>
          Loading profile setup…
        </p>
      </div>
    );
  }

  const q      = questions[currentStep];
  const total  = questions.length;
  const isLast = currentStep === total - 1;
  const pct    = Math.round(((currentStep + 1) / total) * 100);
  const meta   = QUESTION_META[q.id] ?? { emoji: '❓', category: 'Profile' };

  async function handleAnswer(value: number) {
    if (animating || saving || selected !== null) return;
    setSelected(value);
    const newAnswers = { ...answers, [q.id]: value as 1 | 2 | 3 } as Partial<CompleteOnboardingInput>;
    setAnswers(newAnswers);
    saveStep(q.step, q.id, value as 1 | 2 | 3);
    setAnimating(true);

    setTimeout(async () => {
      if (isLast) {
        setSaving(true);
        const ok = await complete(newAnswers as CompleteOnboardingInput);
        setSaving(false);
        if (ok) onComplete();
      } else {
        setCurrentStep((s) => s + 1);
        setSelected(null);
        setAnimating(false);
      }
    }, 320);
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        fontFamily: "'Barlow Condensed', 'Impact', sans-serif",
      }}
    >
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .ob-option { transition: all 0.15s ease; }
        .ob-option:not(:disabled):hover {
          background: rgba(0,255,135,0.06) !important;
          border-color: rgba(0,255,135,0.3) !important;
          color: white !important;
          transform: translateX(3px);
        }
      `}</style>

      {/* Progress header */}
      <div style={{ padding: '12px 16px 10px', flexShrink: 0 }}>
        {/* Step dots */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
          {questions.map((_, i) => (
            <div
              key={i}
              style={{
                height: 3,
                flex: 1,
                borderRadius: 99,
                background: i < currentStep
                  ? '#00FF87'
                  : i === currentStep
                  ? 'linear-gradient(90deg, #00FF87, #00d4ff)'
                  : 'rgba(255,255,255,0.08)',
                transition: 'all 0.4s ease',
                boxShadow: i === currentStep ? '0 0 6px rgba(0,255,135,0.4)' : 'none',
              }}
            />
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {/* Category badge */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              background: 'rgba(0,255,135,0.08)',
              border: '1px solid rgba(0,255,135,0.18)',
              borderRadius: 6,
              padding: '3px 8px',
            }}
          >
            <span style={{ fontSize: 11 }}>{meta.emoji}</span>
            <span
              style={{
                color: '#00FF87',
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
                fontFamily: "'Barlow', sans-serif",
              }}
            >
              {meta.category}
            </span>
          </div>

          <span
            style={{
              color: 'rgba(255,255,255,0.25)',
              fontSize: 10,
              fontFamily: "'Barlow', sans-serif",
              letterSpacing: '0.1em',
            }}
          >
            {String(currentStep + 1).padStart(2, '0')}/{String(total).padStart(2, '0')}
          </span>
        </div>
      </div>

      {/* Question area */}
      <div
        style={{
          flex: 1,
          padding: '0 16px 16px',
          overflow: 'hidden',
          opacity:    animating ? 0 : 1,
          transform:  animating ? 'translateY(10px)' : 'translateY(0)',
          transition: 'opacity 0.22s ease, transform 0.22s ease',
        }}
      >
        {/* Bot bubble */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'flex-start' }}>
          <div
            style={{
              width: 30, height: 30,
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #00FF87, #00d4ff)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 14,
              flexShrink: 0,
              marginTop: 2,
              boxShadow: '0 0 12px rgba(0,255,135,0.25)',
            }}
          >
            ⚽
          </div>
          <div
            style={{
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '0 14px 14px 14px',
              padding: '10px 13px',
              flex: 1,
            }}
          >
            <p
              style={{
                color: 'white',
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: '0.02em',
                margin: 0,
                lineHeight: 1.4,
                fontFamily: "'Barlow', sans-serif",
              }}
            >
              {q.question}
            </p>
            {q.subtext && (
              <p
                style={{
                  color: 'rgba(255,255,255,0.38)',
                  fontSize: 11,
                  fontFamily: "'Barlow', sans-serif",
                  fontWeight: 400,
                  margin: '5px 0 0',
                  lineHeight: 1.5,
                }}
              >
                {q.subtext}
              </p>
            )}
          </div>
        </div>

        {/* Options */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, paddingLeft: 40 }}>
          {q.options.map((opt, idx) => {
            const isChosen = selected === opt.value;
            const dimmed   = selected !== null && !isChosen;

            // Value labels (1=low/safe, 2=balanced, 3=high/aggressive)
            const valueDots = ['●○○', '●●○', '●●●'][opt.value - 1];

            return (
              <button
                key={opt.value}
                className="ob-option"
                onClick={() => handleAnswer(opt.value)}
                disabled={selected !== null}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '9px 13px',
                  borderRadius: 11,
                  border: isChosen
                    ? '1px solid #00FF87'
                    : '1px solid rgba(255,255,255,0.08)',
                  background: isChosen
                    ? 'rgba(0,255,135,0.1)'
                    : 'rgba(255,255,255,0.03)',
                  cursor: selected !== null ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  transform: isChosen ? 'translateX(3px)' : 'none',
                }}
              >
                <span
                  style={{
                    color: isChosen ? '#00FF87' : dimmed ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.8)',
                    fontSize: 12,
                    fontWeight: 600,
                    letterSpacing: '0.02em',
                    fontFamily: "'Barlow', sans-serif",
                    lineHeight: 1.3,
                    transition: 'color 0.15s',
                  }}
                >
                  {opt.label}
                </span>

                {/* Visual intensity indicator */}
                <span
                  style={{
                    color: isChosen ? '#00FF87' : 'rgba(255,255,255,0.15)',
                    fontSize: 9,
                    letterSpacing: 2,
                    flexShrink: 0,
                    fontFamily: 'monospace',
                    transition: 'color 0.15s',
                  }}
                >
                  {valueDots}
                </span>
              </button>
            );
          })}
        </div>

        {error && (
          <p
            style={{
              marginTop: 10,
              paddingLeft: 40,
              color: '#fca5a5',
              fontSize: 11,
              fontFamily: "'Barlow', sans-serif",
            }}
          >
            ⚠️ {error}
          </p>
        )}
      </div>

      {/* Saving footer */}
      {saving && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            padding: '10px 0 14px',
            borderTop: '1px solid rgba(255,255,255,0.06)',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              width: 14, height: 14,
              border: '2px solid rgba(0,255,135,0.2)',
              borderTop: '2px solid #00FF87',
              borderRadius: '50%',
              animation: 'spin 0.7s linear infinite',
            }}
          />
          <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, fontFamily: "'Barlow', sans-serif", letterSpacing: '0.1em' }}>
            Saving your profile…
          </span>
        </div>
      )}
    </div>
  );
}
