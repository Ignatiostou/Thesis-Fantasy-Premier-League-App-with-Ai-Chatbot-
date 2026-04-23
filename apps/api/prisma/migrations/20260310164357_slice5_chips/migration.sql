-- CreateEnum
CREATE TYPE "ChipType" AS ENUM ('WILDCARD', 'BENCH_BOOST', 'TRIPLE_CAPTAIN', 'FREE_HIT');

-- CreateTable
CREATE TABLE "user_chips" (
    "id" TEXT NOT NULL,
    "userTeamId" TEXT NOT NULL,
    "chip" "ChipType" NOT NULL,
    "gameweek" INTEGER NOT NULL,
    "playedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_chips_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_chips_userTeamId_idx" ON "user_chips"("userTeamId");

-- CreateIndex
CREATE UNIQUE INDEX "user_chips_userTeamId_chip_key" ON "user_chips"("userTeamId", "chip");

-- AddForeignKey
ALTER TABLE "user_chips" ADD CONSTRAINT "user_chips_userTeamId_fkey" FOREIGN KEY ("userTeamId") REFERENCES "user_teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
