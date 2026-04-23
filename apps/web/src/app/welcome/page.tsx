"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";

export default function WelcomeGate() {
  const router = useRouter();

  useEffect(() => {
    (async () => {
      try {
        // Αν έχεις valid cookies θα απαντήσει.
        const { team } = await apiFetch<{ team: any | null }>("/team/me");

        // Αν έχει ήδη ομάδα -> πάει Team
        if (team) router.replace("/app/team");
        // Αν δεν έχει ομάδα -> πάει squad-builder
        else router.replace("/app/squad-builder");
      } catch {
        // Αν δεν είναι logged in / 401 -> πάει auth
        router.replace("/auth");
      }
    })();
  }, [router]);

  // Μικρό loading UI (δεν χρειάζεται slider εδώ)
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0a0e1a",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "rgba(255,255,255,.65)",
        fontFamily: "system-ui",
      }}
    >
      Redirecting…
    </div>
  );
}