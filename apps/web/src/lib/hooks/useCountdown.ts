"use client";
import { useEffect, useState } from "react";

export interface CountdownResult {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  expired: boolean;
  urgent: boolean; // < 1 hour remaining
  totalMs: number;
}

export function useCountdown(iso: string | null): CountdownResult {
  const [ms, setMs] = useState(0);

  useEffect(() => {
    if (!iso) return;
    const tick = () => setMs(new Date(iso).getTime() - Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [iso]);

  const total = Math.max(0, ms);
  return {
    days:    Math.floor(total / 86_400_000),
    hours:   Math.floor((total % 86_400_000) / 3_600_000),
    minutes: Math.floor((total % 3_600_000)  / 60_000),
    seconds: Math.floor((total % 60_000)     / 1_000),
    expired: ms <= 0,
    urgent:  ms > 0 && ms < 3_600_000,
    totalMs: total,
  };
}