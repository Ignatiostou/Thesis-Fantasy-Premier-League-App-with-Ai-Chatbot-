-- CreateTable
CREATE TABLE "user_picks" (
    "id" TEXT NOT NULL,
    "userTeamId" TEXT NOT NULL,
    "playerId" INTEGER NOT NULL,
    "teamId" INTEGER NOT NULL,
    "gameweek" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "isCaptain" BOOLEAN NOT NULL DEFAULT false,
    "isViceCaptain" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_picks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_picks_userTeamId_gameweek_idx" ON "user_picks"("userTeamId", "gameweek");

-- CreateIndex
CREATE INDEX "user_picks_playerId_idx" ON "user_picks"("playerId");

-- CreateIndex
CREATE UNIQUE INDEX "user_picks_userTeamId_playerId_gameweek_key" ON "user_picks"("userTeamId", "playerId", "gameweek");

-- AddForeignKey
ALTER TABLE "user_picks" ADD CONSTRAINT "user_picks_userTeamId_fkey" FOREIGN KEY ("userTeamId") REFERENCES "user_teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_picks" ADD CONSTRAINT "user_picks_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "fpl_players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_picks" ADD CONSTRAINT "user_picks_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "fpl_teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_picks" ADD CONSTRAINT "user_picks_gameweek_fkey" FOREIGN KEY ("gameweek") REFERENCES "fpl_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
