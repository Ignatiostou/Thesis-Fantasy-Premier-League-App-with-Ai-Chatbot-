// apps/web/src/lib/hooks/useOnboarding.ts

'use client';

import { useState, useCallback } from 'react';
import type {
  OnboardingQuestion,
  OnboardingStatusResponse,
  CompleteOnboardingInput,
} from '@fpl/types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export function useOnboarding() {
  const [status,    setStatus]    = useState<OnboardingStatusResponse | null>(null);
  const [questions, setQuestions] = useState<OnboardingQuestion[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/ai/onboarding/status`, { credentials: 'include' });
      if (!res.ok) return;
      const json = await res.json();
      setStatus(json.data as OnboardingStatusResponse);
    } catch { /* silently fail */ }
  }, []);

  const loadQuestions = useCallback(async () => {
    if (questions.length > 0) return;
    try {
      const res = await fetch(`${API_BASE}/ai/onboarding/questions`);
      if (!res.ok) return;
      const json = await res.json();
      setQuestions(json.data?.questions ?? []);
    } catch { /* ignore */ }
  }, [questions.length]);

  const saveStep = useCallback(async (step: number, questionId: string, value: 1 | 2 | 3) => {
    try {
      await fetch(`${API_BASE}/ai/onboarding/step`, {
        method:      'POST',
        headers:     { 'Content-Type': 'application/json' },
        credentials: 'include',
        body:        JSON.stringify({ step, questionId, value }),
      });
    } catch { /* non-critical */ }
  }, []);

  const complete = useCallback(async (answers: CompleteOnboardingInput): Promise<boolean> => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/ai/onboarding/complete`, {
        method:      'POST',
        headers:     { 'Content-Type': 'application/json' },
        credentials: 'include',
        body:        JSON.stringify(answers),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? 'Failed to save profile');
      }
      setStatus({ completed: true, step: 10, hasProfile: true });
      return true;
    } catch (e: any) {
      setError(e.message ?? 'Failed to complete onboarding');
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    status,
    questions,
    loading,
    error,
    loadStatus,
    loadQuestions,
    saveStep,
    complete,
    isCompleted: status?.completed ?? false,
  };
}