-- AlterTable
ALTER TABLE "fpl_players" ADD COLUMN     "eventPoints" INTEGER;

-- AlterTable
ALTER TABLE "user_picks" ADD COLUMN     "benchOrder" INTEGER,
ADD COLUMN     "buyPrice" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "isOnBench" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "user_teams" ALTER COLUMN "season" SET DEFAULT '2025-26';

-- CreateTable
CREATE TABLE "user_transfers" (
    "id" TEXT NOT NULL,
    "userTeamId" TEXT NOT NULL,
    "gameweek" INTEGER NOT NULL,
    "playerInId" INTEGER NOT NULL,
    "playerOutId" INTEGER NOT NULL,
    "playerInCost" INTEGER NOT NULL,
    "playerOutCost" INTEGER NOT NULL,
    "isHit" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_gw_states" (
    "id" TEXT NOT NULL,
    "userTeamId" TEXT NOT NULL,
    "gameweek" INTEGER NOT NULL,
    "freeTransfers" INTEGER NOT NULL DEFAULT 1,
    "transfersMade" INTEGER NOT NULL DEFAULT 0,
    "pointsHit" INTEGER NOT NULL DEFAULT 0,
    "activeChip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_gw_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_transfers_userTeamId_gameweek_idx" ON "user_transfers"("userTeamId", "gameweek");

-- CreateIndex
CREATE INDEX "user_gw_states_userTeamId_gameweek_idx" ON "user_gw_states"("userTeamId", "gameweek");

-- CreateIndex
CREATE UNIQUE INDEX "user_gw_states_userTeamId_gameweek_key" ON "user_gw_states"("userTeamId", "gameweek");

-- AddForeignKey
ALTER TABLE "user_transfers" ADD CONSTRAINT "user_transfers_userTeamId_fkey" FOREIGN KEY ("userTeamId") REFERENCES "user_teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_transfers" ADD CONSTRAINT "user_transfers_playerInId_fkey" FOREIGN KEY ("playerInId") REFERENCES "fpl_players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_transfers" ADD CONSTRAINT "user_transfers_playerOutId_fkey" FOREIGN KEY ("playerOutId") REFERENCES "fpl_players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_transfers" ADD CONSTRAINT "user_transfers_gameweek_fkey" FOREIGN KEY ("gameweek") REFERENCES "fpl_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_gw_states" ADD CONSTRAINT "user_gw_states_userTeamId_fkey" FOREIGN KEY ("userTeamId") REFERENCES "user_teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_gw_states" ADD CONSTRAINT "user_gw_states_gameweek_fkey" FOREIGN KEY ("gameweek") REFERENCES "fpl_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
