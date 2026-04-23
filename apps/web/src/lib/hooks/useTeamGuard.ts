"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";

type Mode = "mustHaveTeam" | "mustNotHaveTeam";

export function useTeamGuard(mode: Mode) {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const { team } = await apiFetch<{ team: any | null }>("/team/me");

        if (mode === "mustHaveTeam" && !team) {
          router.replace("/app/squad-builder");
          return;
        }

        if (mode === "mustNotHaveTeam" && team) {
          router.replace("/app/team");
          return;
        }
      } catch {
        router.replace("/auth");
        return;
      }

      setChecking(false);
    })();
  }, [mode, router]);

  return { checking };
}