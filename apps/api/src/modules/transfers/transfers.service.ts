import { prisma } from '../../db/prisma.js';
import {
  ensureSquadExistsForGameweek,
  getEditableGameweekId,
} from '../../utils/gameweek.js';
import type {
  ActiveTransferChip,
  TransferPair,
  TransfersHistoryResponse,
  TransfersPreviewResponse,
  TransfersStateResponse,
} from './transfers.dto.js';

const BUDGET_START = 1000;
const MAX_PER_CLUB = 3;
const HIT_COST_PER_EXTRA_TRANSFER = 4;
const POSITION_LIMITS: Record<number, number> = { 1: 2, 2: 5, 3: 5, 4: 3 };

function countByNumber(values: number[]) {
  return values.reduce<Record<number, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

function getSellPriceFplProfitHalf(buyPrice: number, nowCost: number) {
  if (nowCost <= buyPrice) return nowCost;
  return buyPrice + Math.floor((nowCost - buyPrice) / 2);
}

function normalizeTransferChip(value: string | null | undefined): ActiveTransferChip {
  if (!value) return null;
  if (value === 'wildcard' || value === 'WILDCARD') return 'wildcard';
  return null;
}

async function ensureCurrentGwState(userTeamId: string, gameweek: number) {
  const existing = await prisma.userGameweekState.findUnique({
    where: {
      userTeamId_gameweek: {
        userTeamId,
        gameweek,
      },
    },
  });

  if (existing) return existing;

  const previous = await prisma.userGameweekState.findFirst({
    where: {
      userTeamId,
      gameweek: { lt: gameweek },
    },
    orderBy: { gameweek: 'desc' },
  });

  const freeTransfers = previous
    ? Math.min(Math.max(previous.freeTransfers - previous.transfersMade, 0) + 1, 2)
    : 1;

  return prisma.userGameweekState.create({
    data: {
      userTeamId,
      gameweek,
      freeTransfers,
      transfersMade: 0,
      pointsHit: 0,
      activeChip: null,
    },
  });
}

async function canUseWildcard(userTeamId: string, gameweek: number) {
  const firstHalf = gameweek <= 19;

  const existingWildcardChip = await prisma.userChip.findFirst({
    where: {
      userTeamId,
      chip: 'WILDCARD',
      ...(firstHalf
        ? { gameweek: { lte: 19 } }
        : { gameweek: { gte: 20 } }),
    },
  });

  return !existingWildcardChip;
}

async function getTransferContext(userId: string) {
  const gameweek = await getEditableGameweekId();

  const teamRef = await prisma.userTeam.findUnique({
    where: { userId },
    select: { id: true },
  });

  if (!teamRef) {
    return {
      gameweek,
      team: null,
      gwState: null,
      wildcardAvailable: false,
    };
  }

  await ensureSquadExistsForGameweek(teamRef.id, gameweek);

  const team = await prisma.userTeam.findUnique({
    where: { userId },
    include: {
      picks: {
        where: { gameweek },
        orderBy: { position: 'asc' },
        include: {
          player: {
            include: { team: true },
          },
        },
      },
    },
  });

  if (!team) {
    return {
      gameweek,
      team: null,
      gwState: null,
      wildcardAvailable: false,
    };
  }

  const gwState = await ensureCurrentGwState(team.id, gameweek);
  const wildcardAvailable = await canUseWildcard(team.id, gameweek);

  return {
    gameweek,
    team,
    gwState,
    wildcardAvailable,
  };
}

function buildStateResponse(
  input: Awaited<ReturnType<typeof getTransferContext>>,
): TransfersStateResponse {
  if (!input.team || !input.gwState) {
    return {
      gameweek: input.gameweek,
      team: null,
      gwState: null,
      rules: {
        maxPerClub: MAX_PER_CLUB,
        budgetStart: BUDGET_START,
        positionLimits: POSITION_LIMITS,
        hitCostPerExtraTransfer: HIT_COST_PER_EXTRA_TRANSFER,
        transferSamePositionOnly: true,
        wildcardEnabled: true,
      },
    };
  }

  return {
    gameweek: input.gameweek,
    team: {
      id: input.team.id,
      name: input.team.name,
      budgetLeft: input.team.budget,
      season: input.team.season,
      picks: input.team.picks.map((pick) => ({
        id: pick.id,
        playerId: pick.playerId,
        webName: pick.player.webName,
        position: pick.player.position,
        nowCost: pick.player.nowCost,
        buyPrice: pick.buyPrice,
        status: pick.player.status,
        teamId: pick.player.teamId,
        teamShortName: pick.player.team.shortName,
        isCaptain: pick.isCaptain,
        isViceCaptain: pick.isViceCaptain,
        isOnBench: pick.isOnBench,
        benchOrder: pick.benchOrder,
        slotPosition: pick.position,
      })),
    },
    gwState: {
      freeTransfers: input.gwState.freeTransfers,
      transfersMade: input.gwState.transfersMade,
      pointsHit: input.gwState.pointsHit,
      activeChip: normalizeTransferChip(input.gwState.activeChip),
      wildcardAvailable: input.wildcardAvailable,
    },
    rules: {
      maxPerClub: MAX_PER_CLUB,
      budgetStart: BUDGET_START,
      positionLimits: POSITION_LIMITS,
      hitCostPerExtraTransfer: HIT_COST_PER_EXTRA_TRANSFER,
      transferSamePositionOnly: true,
      wildcardEnabled: true,
    },
  };
}

export async function getTransfersState(
  userId: string,
): Promise<TransfersStateResponse> {
  const ctx = await getTransferContext(userId);
  return buildStateResponse(ctx);
}

export async function previewTransfers(
  userId: string,
  transfers: TransferPair[],
  activeChip: ActiveTransferChip = null,
): Promise<TransfersPreviewResponse> {
  const errors: string[] = [];

  const ctx = await getTransferContext(userId);
  if (!ctx.team || !ctx.gwState) return { ok: false, errors: ['NO_TEAM'] };

  if (!Array.isArray(transfers) || transfers.length === 0) {
    return { ok: false, errors: ['NO_TRANSFERS_SELECTED'] };
  }

  const uniqueOuts = new Set(transfers.map((t) => t.outPlayerId));
  const uniqueIns = new Set(transfers.map((t) => t.inPlayerId));

  if (uniqueOuts.size !== transfers.length) errors.push('DUPLICATE_OUT_PLAYER');
  if (uniqueIns.size !== transfers.length) errors.push('DUPLICATE_IN_PLAYER');

  const currentPicks = ctx.team.picks;
  const currentPlayerIds = new Set(currentPicks.map((p) => p.playerId));
  const pickByPlayerId = new Map(currentPicks.map((p) => [p.playerId, p]));

  for (const t of transfers) {
    if (!currentPlayerIds.has(t.outPlayerId)) {
      errors.push(`OUT_PLAYER_NOT_IN_TEAM:${t.outPlayerId}`);
    }
    if (currentPlayerIds.has(t.inPlayerId)) {
      errors.push(`IN_PLAYER_ALREADY_IN_TEAM:${t.inPlayerId}`);
    }
  }

  const involvedIds = Array.from(
    new Set(transfers.flatMap((t) => [t.outPlayerId, t.inPlayerId])),
  );

  const involvedPlayers = await prisma.fplPlayer.findMany({
    where: { id: { in: involvedIds } },
    include: { team: true },
  });

  const playerById = new Map(involvedPlayers.map((p) => [p.id, p]));

  for (const t of transfers) {
    const outPick = pickByPlayerId.get(t.outPlayerId);
    const inPlayer = playerById.get(t.inPlayerId);

    if (!outPick) continue;

    if (!inPlayer) {
      errors.push(`IN_PLAYER_NOT_FOUND:${t.inPlayerId}`);
      continue;
    }

    if (outPick.player.position !== inPlayer.position) {
      errors.push(`POSITION_MISMATCH:${t.outPlayerId}->${t.inPlayerId}`);
    }
  }

    if (errors.length > 0) {
      return { ok: false, errors };
    }

  const nextPicks = currentPicks.map((pick) => {
    const replacement = transfers.find((t) => t.outPlayerId === pick.playerId);

    if (!replacement) {
      return {
        pickId: pick.id,
        playerId: pick.playerId,
        webName: pick.player.webName,
        position: pick.player.position,
        teamId: pick.player.teamId,
        teamShortName: pick.player.team.shortName,
        nowCost: pick.player.nowCost,
        buyPrice: pick.buyPrice,
        isCaptain: pick.isCaptain,
        isViceCaptain: pick.isViceCaptain,
        isOnBench: pick.isOnBench,
        benchOrder: pick.benchOrder,
        slotPosition: pick.position,
      };
    }

    const inPlayer = playerById.get(replacement.inPlayerId);
    if (!inPlayer) {
      return {
        pickId: pick.id,
        playerId: pick.playerId,
        webName: pick.player.webName,
        position: pick.player.position,
        teamId: pick.player.teamId,
        teamShortName: pick.player.team.shortName,
        nowCost: pick.player.nowCost,
        buyPrice: pick.buyPrice,
        isCaptain: pick.isCaptain,
        isViceCaptain: pick.isViceCaptain,
        isOnBench: pick.isOnBench,
        benchOrder: pick.benchOrder,
        slotPosition: pick.position,
      };
    }

    return {
      pickId: pick.id,
      playerId: inPlayer.id,
      webName: inPlayer.webName,
      position: inPlayer.position,
      teamId: inPlayer.teamId,
      teamShortName: inPlayer.team.shortName,
      nowCost: inPlayer.nowCost,
      buyPrice: inPlayer.nowCost,
      isCaptain: pick.isCaptain,
      isViceCaptain: pick.isViceCaptain,
      isOnBench: pick.isOnBench,
      benchOrder: pick.benchOrder,
      slotPosition: pick.position,
    };
  });

  const posCounts = countByNumber(nextPicks.map((p) => p.position));
  for (const pos of Object.keys(POSITION_LIMITS).map(Number)) {
    if ((posCounts[pos] ?? 0) !== POSITION_LIMITS[pos]) {
      errors.push(`INVALID_POSITION_COUNT:${pos}`);
    }
  }

  const clubCounts = countByNumber(nextPicks.map((p) => p.teamId));
  for (const [clubIdRaw, count] of Object.entries(clubCounts)) {
    if (count > MAX_PER_CLUB) {
      errors.push(`MAX_3_PER_CLUB:${clubIdRaw}`);
    }
  }

  const budgetLeftBefore = ctx.team.budget;

  let totalSell = 0;
  let totalBuy = 0;

  const cart = transfers.map((t) => {
    const outPick = pickByPlayerId.get(t.outPlayerId)!;
    const outNow = playerById.get(t.outPlayerId) ?? outPick.player;
    const inPlayer = playerById.get(t.inPlayerId)!;

    const outSellPrice = getSellPriceFplProfitHalf(outPick.buyPrice, outNow.nowCost);
    const inBuyPrice = inPlayer.nowCost;

    totalSell += outSellPrice;
    totalBuy += inBuyPrice;

    return {
      outPlayerId: t.outPlayerId,
      outWebName: outNow.webName,
      outSellPrice,
      inPlayerId: t.inPlayerId,
      inWebName: inPlayer.webName,
      inBuyPrice,
      isHit: false,
    };
  });

  const budgetLeftAfter = budgetLeftBefore + totalSell - totalBuy;
  if (budgetLeftAfter < 0) {
    errors.push('BUDGET_EXCEEDED');
  }

  const wildcardRequested = activeChip === 'wildcard';
  if (wildcardRequested && !ctx.wildcardAvailable) {
    errors.push('WILDCARD_NOT_AVAILABLE');
  }

  const freeTransfersRemainingBefore = Math.max(
    0,
    ctx.gwState.freeTransfers - ctx.gwState.transfersMade,
  );

  const hitTransfersCount = wildcardRequested
    ? 0
    : Math.max(0, transfers.length - freeTransfersRemainingBefore);

  const hitCostAdded = hitTransfersCount * HIT_COST_PER_EXTRA_TRANSFER;
  const hitCostTotalAfter = ctx.gwState.pointsHit + hitCostAdded;

  const freeTransfersRemainingAfter = wildcardRequested
    ? freeTransfersRemainingBefore
    : Math.max(0, freeTransfersRemainingBefore - transfers.length);

  cart.forEach((item, index) => {
    item.isHit = wildcardRequested ? false : index >= freeTransfersRemainingBefore;
  });

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    summary: {
      budgetLeftBefore,
      budgetLeftAfter,
      freeTransfersTotal: ctx.gwState.freeTransfers,
      freeTransfersRemainingBefore,
      freeTransfersRemainingAfter,
      transfersMadeBefore: ctx.gwState.transfersMade,
      transfersMadeAfter: ctx.gwState.transfersMade + transfers.length,
      hitCostAdded,
      hitCostTotalAfter,
      activeChip: wildcardRequested ? 'wildcard' : null,
      wildcardAvailable: ctx.wildcardAvailable,
    },
    cart,
    nextTeam: {
      picks: nextPicks,
      counts: {
        byPosition: posCounts,
        byClub: clubCounts,
      },
    },
  };
}

export async function commitTransfers(
  userId: string,
  transfers: TransferPair[],
  activeChip: ActiveTransferChip = null,
): Promise<TransfersPreviewResponse | TransfersStateResponse> {
  const preview = await previewTransfers(userId, transfers, activeChip);
  if (!preview.ok) return preview;
  if (!preview.summary || !preview.cart) return preview;

  const ctx = await getTransferContext(userId);
  if (!ctx.team || !ctx.gwState) return { ok: false, errors: ['NO_TEAM'] };

  const pickByPlayerId = new Map(ctx.team.picks.map((p) => [p.playerId, p]));
  const freeTransfersRemainingBefore = Math.max(
    0,
    ctx.gwState.freeTransfers - ctx.gwState.transfersMade,
  );
  const wildcardRequested = activeChip === 'wildcard';
  const summary = preview.summary;

  await prisma.$transaction(async (tx) => {
    for (let i = 0; i < transfers.length; i++) {
      const transfer = transfers[i];
      const currentPick = pickByPlayerId.get(transfer.outPlayerId);
      if (!currentPick) throw new Error(`OUT_PLAYER_NOT_IN_TEAM:${transfer.outPlayerId}`);

      const inPlayer = await tx.fplPlayer.findUnique({
        where: { id: transfer.inPlayerId },
      });
      if (!inPlayer) throw new Error(`IN_PLAYER_NOT_FOUND:${transfer.inPlayerId}`);

      const outPlayer = await tx.fplPlayer.findUnique({
        where: { id: transfer.outPlayerId },
      });
      if (!outPlayer) throw new Error(`OUT_PLAYER_NOT_FOUND:${transfer.outPlayerId}`);

      const sellPrice = getSellPriceFplProfitHalf(currentPick.buyPrice, outPlayer.nowCost);
      const inPrice = inPlayer.nowCost;

      await tx.userTransfer.create({
        data: {
          userTeamId: ctx.team.id,
          gameweek: ctx.gameweek,
          playerInId: transfer.inPlayerId,
          playerOutId: transfer.outPlayerId,
          playerInCost: inPrice,
          playerOutCost: sellPrice,
          isHit: wildcardRequested ? false : i >= freeTransfersRemainingBefore,
        },
      });

      await tx.userPick.update({
        where: { id: currentPick.id },
        data: {
          playerId: inPlayer.id,
          teamId: inPlayer.teamId,
          buyPrice: inPlayer.nowCost,
        },
      });
    }

    await tx.userTeam.update({
      where: { id: ctx.team.id },
      data: {
        budget: summary.budgetLeftAfter,
      },
    });

    const gwStateUpdateData: {
      transfersMade: number;
      pointsHit: number;
      activeChip?: string | null;
    } = {
      transfersMade: ctx.gwState.transfersMade + transfers.length,
      pointsHit: summary.hitCostTotalAfter,
    };

    if (wildcardRequested) {
      gwStateUpdateData.activeChip = 'wildcard';

      await tx.userChip.create({
        data: {
          userTeamId: ctx.team.id,
          chip: 'WILDCARD',
          gameweek: ctx.gameweek,
        },
      });
    }

    await tx.userGameweekState.update({
      where: {
        userTeamId_gameweek: {
          userTeamId: ctx.team.id,
          gameweek: ctx.gameweek,
        },
      },
      data: gwStateUpdateData,
    });
  });

  return getTransfersState(userId);
}

export async function getTransfersHistory(
  userId: string,
  gameweek?: number,
): Promise<TransfersHistoryResponse> {
  const team = await prisma.userTeam.findUnique({
    where: { userId },
    select: { id: true },
  });

  if (!team) return { items: [] };

  const items = await prisma.userTransfer.findMany({
    where: {
      userTeamId: team.id,
      ...(typeof gameweek === 'number' ? { gameweek } : {}),
    },
    orderBy: { createdAt: 'desc' },
    include: {
      playerIn: true,
      playerOut: true,
    },
  });

  return {
    items: items.map((t) => ({
      id: t.id,
      gameweek: t.gameweek,
      playerOutId: t.playerOutId,
      playerOutWebName: t.playerOut.webName,
      playerOutCost: t.playerOutCost,
      playerInId: t.playerInId,
      playerInWebName: t.playerIn.webName,
      playerInCost: t.playerInCost,
      isHit: t.isHit,
      createdAt: t.createdAt.toISOString(),
    })),
  };
}