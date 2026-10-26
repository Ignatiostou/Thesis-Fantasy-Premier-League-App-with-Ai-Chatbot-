"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";

type ActiveTransferChip = "wildcard" | null;

type TransferPair = {
  outPlayerId: number;
  inPlayerId: number;
};

type TeamOption = {
  id: number;
  name: string;
  shortName: string;
};

type TransferStateResponse = {
  gameweek: number;
  team: {
    id: string;
    name: string;
    budgetLeft: number;
    season: string;
    picks: Array<{
      id: string;
      playerId: number;
      webName: string;
      position: number;
      nowCost: number;
      buyPrice: number;
      status: string;
      teamId: number;
      teamShortName: string;
      isCaptain: boolean;
      isViceCaptain: boolean;
      isOnBench: boolean;
      benchOrder: number | null;
      slotPosition: number;
    }>;
  } | null;
  gwState: {
    freeTransfers: number;
    transfersMade: number;
    pointsHit: number;
    activeChip: ActiveTransferChip;
    wildcardAvailable: boolean;
  } | null;
  rules: {
    maxPerClub: number;
    budgetStart: number;
    positionLimits: Record<number, number>;
    hitCostPerExtraTransfer: number;
    transferSamePositionOnly: true;
    wildcardEnabled: true;
  };
};

type TransferPreviewResponse = {
  ok: boolean;
  errors?: string[];
  summary?: {
    budgetLeftBefore: number;
    budgetLeftAfter: number;
    freeTransfersTotal: number;
    freeTransfersRemainingBefore: number;
    freeTransfersRemainingAfter: number;
    transfersMadeBefore: number;
    transfersMadeAfter: number;
    hitCostAdded: number;
    hitCostTotalAfter: number;
    activeChip: ActiveTransferChip;
    wildcardAvailable: boolean;
  };
  cart?: Array<{
    outPlayerId: number;
    outWebName: string;
    outSellPrice: number;
    inPlayerId: number;
    inWebName: string;
    inBuyPrice: number;
    isHit: boolean;
  }>;
};

type TransferHistoryResponse = {
  items: Array<{
    id: string;
    gameweek: number;
    playerOutId: number;
    playerOutWebName: string;
    playerOutCost: number;
    playerInId: number;
    playerInWebName: string;
    playerInCost: number;
    isHit: boolean;
    createdAt: string;
  }>;
};

type MarketPlayersResponse = {
  items: Array<{
    id: number;
    webName: string;
    position: 1 | 2 | 3 | 4;
    nowCost: number;
    status: string;
    totalPoints: number | null;
    chanceOfPlayingNextRound: number | null;
    team: { id: number; name: string; shortName: string };
  }>;
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
};

export function useTransfersState() {
  const [state, setState] = useState<TransferStateResponse | null>(null);
  const [history, setHistory] = useState<TransferHistoryResponse["items"]>([]);
  const [teams, setTeams] = useState<TeamOption[]>([]);

  const [selectedOutId, setSelectedOutId] = useState<number | null>(null);
  const [cart, setCart] = useState<TransferPair[]>([]);
  const [activeChip, setActiveChip] = useState<ActiveTransferChip>(null);
  const [preview, setPreview] = useState<TransferPreviewResponse | null>(null);

  const [loading, setLoading] = useState(true);
  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);

  const [market, setMarket] = useState<MarketPlayersResponse | null>(null);
  const [marketLoading, setMarketLoading] = useState(false);

  const [search, setSearch] = useState("");
  const [teamFilter, setTeamFilter] = useState(0);
  const [page, setPage] = useState(1);

  const loadState = useCallback(async () => {
    const [s, h, teamOptions] = await Promise.all([
      apiFetch<TransferStateResponse>("/transfers/state"),
      apiFetch<TransferHistoryResponse>("/transfers/history"),
      apiFetch<TeamOption[]>("/fpl/teams").catch(() => []),
    ]);

    setState(s);
    setHistory(h.items);
    setTeams(teamOptions);
    setActiveChip(s.gwState?.activeChip ?? null);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        await loadState();
      } finally {
        setLoading(false);
      }
    })();
  }, [loadState]);

  const picks = state?.team?.picks ?? [];

  const selectedOutPick = useMemo(() => {
    if (!selectedOutId) return null;
    return picks.find((p) => p.playerId === selectedOutId) ?? null;
  }, [picks, selectedOutId]);

  const teamPlayerIds = useMemo(
    () => new Set(picks.map((p) => p.playerId)),
    [picks],
  );

  const cartInIds = useMemo(
    () => new Set(cart.map((t) => t.inPlayerId)),
    [cart],
  );

  const loadMarket = useCallback(async () => {
    if (!state?.team || !selectedOutPick) {
      setMarket(null);
      return;
    }

    const params = new URLSearchParams({
      page: String(page),
      limit: "20",
      position: String(selectedOutPick.position),
      sortBy: "points",
    });

    if (search.trim()) params.set("q", search.trim());
    if (teamFilter) params.set("teamId", String(teamFilter));

    setMarketLoading(true);
    try {
      const res = await apiFetch<MarketPlayersResponse>(
        `/fpl/players?${params.toString()}`,
      );
      setMarket(res);
    } finally {
      setMarketLoading(false);
    }
  }, [page, search, teamFilter, selectedOutPick, state?.team]);

  useEffect(() => {
    if (!state?.team || !selectedOutPick) {
      setMarket(null);
      return;
    }

    const id = setTimeout(() => {
      loadMarket().catch(() => {});
    }, 250);

    return () => clearTimeout(id);
  }, [state?.team, selectedOutPick, loadMarket]);

  useEffect(() => {
    setPage(1);
  }, [search, teamFilter, selectedOutId]);

  const runPreview = useCallback(
    async (nextCart: TransferPair[], nextChip: ActiveTransferChip) => {
      if (!nextCart.length) {
        setPreview(null);
        return;
      }

      setPreviewing(true);
      try {
        const res = await apiFetch<TransferPreviewResponse>(
          "/transfers/preview",
          {
            method: "POST",
            body: JSON.stringify({ transfers: nextCart, activeChip: nextChip }),
          },
        );
        setPreview(res);
      } catch (e: any) {
        let errorResponse: TransferPreviewResponse = {
          ok: false,
          errors: [e?.message ?? "Preview failed"],
        };

        if (e?.body?.errors) {
          errorResponse = e.body;
        }

        setPreview(errorResponse);
      } finally {
        setPreviewing(false);
      }
    },
    [],
  );

  const selectOut = useCallback((playerId: number) => {
    setSelectedOutId(playerId);
    setSearch("");
    setTeamFilter(0);
    setPage(1);
  }, []);

  const addTransfer = useCallback(
    async (inPlayerId: number) => {
      if (!selectedOutId) return;

      const withoutSameOut = cart.filter((t) => t.outPlayerId !== selectedOutId);
      const nextCart = [
        ...withoutSameOut,
        { outPlayerId: selectedOutId, inPlayerId },
      ];

      setCart(nextCart);
      setSelectedOutId(null);
      setSearch("");
      setTeamFilter(0);
      setPage(1);

      await runPreview(nextCart, activeChip);
    },
    [activeChip, cart, runPreview, selectedOutId],
  );

  const removeTransfer = useCallback(
    async (outPlayerId: number) => {
      const nextCart = cart.filter((t) => t.outPlayerId !== outPlayerId);
      setCart(nextCart);
      await runPreview(nextCart, activeChip);
    },
    [activeChip, cart, runPreview],
  );

  const clearCart = useCallback(() => {
    setCart([]);
    setSelectedOutId(null);
    setPreview(null);
    setSearch("");
    setTeamFilter(0);
    setPage(1);
  }, []);

  const toggleWildcard = useCallback(async () => {
    const nextChip: ActiveTransferChip =
      activeChip === "wildcard" ? null : "wildcard";
    setActiveChip(nextChip);
    await runPreview(cart, nextChip);
  }, [activeChip, cart, runPreview]);

  const commit = useCallback(async () => {
    if (!preview?.ok || !cart.length) return;

    setCommitting(true);
    try {
      await apiFetch<TransferStateResponse>("/transfers/commit", {
        method: "POST",
        body: JSON.stringify({
          transfers: cart,
          activeChip,
        }),
      });

      await loadState();
      setCart([]);
      setSelectedOutId(null);
      setPreview(null);
      setSearch("");
      setTeamFilter(0);
      setPage(1);
    } catch (e: unknown) {
      // Without this the rejection was swallowed and the button simply went
      // back to idle — the transfer looked like it had been ignored. Reuse the
      // preview error slot so the reason lands in the panel the user is
      // already looking at, with the cart left intact to retry.
      const body = (e as { body?: TransferPreviewResponse })?.body;
      setPreview(
        body?.errors
          ? body
          : {
              ok: false,
              errors: [
                e instanceof Error ? e.message : "Transfer failed",
              ],
            },
      );
    } finally {
      setCommitting(false);
    }
  }, [activeChip, cart, loadState, preview?.ok]);

  const availableMarketItems = useMemo(() => {
    const outIds = new Set(cart.map((t) => t.outPlayerId));
    const tempTeamIds = new Set(
      [...teamPlayerIds].filter((id) => !outIds.has(id)),
    );

    return (market?.items ?? []).filter(
      (p) => !tempTeamIds.has(p.id) && !cartInIds.has(p.id),
    );
  }, [cart, cartInIds, market?.items, teamPlayerIds]);

  return {
    loading,
    state,
    history,
    teams,

    selectedOutId,
    selectedOutPick,
    selectOut,

    cart,
    addTransfer,
    removeTransfer,
    clearCart,

    activeChip,
    toggleWildcard,

    preview,
    previewing,
    committing,
    commit,

    market,
    marketItems: availableMarketItems,
    marketLoading,

    search,
    setSearch,
    teamFilter,
    setTeamFilter,
    page,
    setPage,
  };
}