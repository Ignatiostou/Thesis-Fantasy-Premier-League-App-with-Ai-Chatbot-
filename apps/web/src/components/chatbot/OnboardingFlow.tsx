

'use client';

import { useEffect, useState } from 'react';
import type { CompleteOnboardingInput } from '@fpl/types';
import { useOnboarding } from '@/lib/hooks/useOnboarding';

interface Props {
  onComplete: () => void;
}

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
            width: 28,
            height: 28,
            border: '2px solid rgba(0,255,135,0.2)',
            borderTop: '2px solid #00FF87',
            borderRadius: '50%',
            animation: 'spin 0.7s linear infinite',
          }}
        />
        <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, letterSpacing: '0.1em' }}>
          Loading profile setup…
        </p>
      </div>
    );
  }

  const q       = questions[currentStep];
  const total   = questions.length;
  const isLast  = currentStep === total - 1;
  const pct     = Math.round(((currentStep + 1) / total) * 100);

  async function handleAnswer(value: number) {
    if (animating || saving || selected !== null) return;
    setSelected(value);
    const newAnswers = { 
      ...answers, 
      [q.id]: value as 1 | 2 | 3
    } as Partial<CompleteOnboardingInput>;
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
      {/* Progress */}
      <div style={{ padding: '14px 18px 12px', flexShrink: 0 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 8,
          }}
        >
          <span
            style={{
              color: '#00FF87',
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              fontFamily: "'Barlow', sans-serif",
            }}
          >
            Coach Profile
          </span>
          <span
            style={{
              color: 'rgba(255,255,255,0.3)',
              fontSize: 10,
              fontFamily: "'Barlow', sans-serif",
              letterSpacing: '0.1em',
            }}
          >
            {String(currentStep + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}
          </span>
        </div>

        {/* Progress bar — matches your pill stat bars */}
        <div
          style={{
            height: 3,
            borderRadius: 99,
            background: 'rgba(255,255,255,0.08)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              borderRadius: 99,
              background: 'linear-gradient(90deg, #00FF87, #00d4ff)',
              width: `${pct}%`,
              transition: 'width 0.4s ease',
            }}
          />
        </div>
      </div>

      {/* Question */}
      <div
        style={{
          flex: 1,
          padding: '4px 18px 18px',
          overflow: 'hidden',
          opacity: animating ? 0 : 1,
          transform: animating ? 'translateY(8px)' : 'translateY(0)',
          transition: 'opacity 0.2s ease, transform 0.2s ease',
        }}
      >
        {/* Bot message bubble */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'flex-start' }}>
          <div
            style={{
              width: 30,
              height: 30,
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
              padding: '10px 14px',
              flex: 1,
            }}
          >
            <p
              style={{
                color: 'white',
                fontSize: 14,
                fontWeight: 700,
                letterSpacing: '0.02em',
                margin: 0,
                lineHeight: 1.35,
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
                  margin: '6px 0 0',
                  lineHeight: 1.5,
                }}
              >
                {q.subtext}
              </p>
            )}
          </div>
        </div>

        {/* Options */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 40 }}>
          {q.options.map((opt) => {
            const isChosen = selected === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => handleAnswer(opt.value)}
                disabled={selected !== null}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '10px 14px',
                  borderRadius: 12,
                  border: isChosen
                    ? '1px solid #00FF87'
                    : '1px solid rgba(255,255,255,0.08)',
                  background: isChosen
                    ? 'rgba(0,255,135,0.1)'
                    : 'rgba(255,255,255,0.03)',
                  color: isChosen
                    ? '#00FF87'
                    : selected !== null
                    ? 'rgba(255,255,255,0.2)'
                    : 'rgba(255,255,255,0.8)',
                  fontSize: 13,
                  fontWeight: 600,
                  letterSpacing: '0.03em',
                  fontFamily: "'Barlow Condensed', sans-serif",
                  cursor: selected !== null ? 'not-allowed' : 'pointer',
                  transition: 'all 0.15s ease',
                  transform: isChosen ? 'scale(0.98)' : 'scale(1)',
                }}
                onMouseEnter={(e) => {
                  if (selected !== null) return;
                  (e.currentTarget as HTMLButtonElement).style.background = 'rgba(0,255,135,0.06)';
                  (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(0,255,135,0.3)';
                  (e.currentTarget as HTMLButtonElement).style.color = 'white';
                }}
                onMouseLeave={(e) => {
                  if (selected !== null || isChosen) return;
                  (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.03)';
                  (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.08)';
                  (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.8)';
                }}
              >
                {opt.label}
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
            {error}
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
              width: 14,
              height: 14,
              border: '2px solid rgba(0,255,135,0.2)',
              borderTop: '2px solid #00FF87',
              borderRadius: '50%',
              animation: 'spin 0.7s linear infinite',
            }}
          />
          <span
            style={{
              color: 'rgba(255,255,255,0.4)',
              fontSize: 11,
              fontFamily: "'Barlow', sans-serif",
              letterSpacing: '0.1em',
            }}
          >
            Saving your profile…
          </span>
        </div>
      )}
    </div>
  );
}
