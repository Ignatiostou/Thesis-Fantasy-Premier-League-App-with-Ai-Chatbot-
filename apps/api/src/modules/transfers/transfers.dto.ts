export type TransferPair = {
  outPlayerId: number;
  inPlayerId: number;
};

export type ActiveTransferChip = 'wildcard' | null;

export type TransfersPreviewBody = {
  transfers: TransferPair[];
  activeChip?: ActiveTransferChip;
};

export type TransfersPreviewResponse = {
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
  nextTeam?: {
    picks: Array<{
      pickId: string;
      playerId: number;
      webName: string;
      position: number;
      teamId: number;
      teamShortName: string;
      nowCost: number;
      buyPrice: number;
      isCaptain: boolean;
      isViceCaptain: boolean;
      isOnBench: boolean;
      benchOrder: number | null;
      slotPosition: number;
    }>;
    counts: {
      byPosition: Record<number, number>;
      byClub: Record<number, number>;
    };
  };
};

export type TransfersStateResponse = {
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

export type TransfersHistoryResponse = {
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