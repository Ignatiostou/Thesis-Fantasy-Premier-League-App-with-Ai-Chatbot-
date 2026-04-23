/*
  Warnings:

  - You are about to drop the column `cleanSheet` on the `player_gameweek_stats` table. All the data in the column will be lost.
  - You are about to drop the column `goals` on the `player_gameweek_stats` table. All the data in the column will be lost.
  - You are about to drop the column `inDreamteam` on the `player_gameweek_stats` table. All the data in the column will be lost.
  - You are about to drop the column `raw` on the `player_gameweek_stats` table. All the data in the column will be lost.
  - You are about to drop the column `points` on the `user_gameweek_scores` table. All the data in the column will be lost.
  - You are about to drop the column `totalPoints` on the `user_gameweek_scores` table. All the data in the column will be lost.
  - Added the required column `updatedAt` to the `player_gameweek_stats` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `user_gameweek_scores` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "player_gameweek_stats" DROP CONSTRAINT "player_gameweek_stats_gameweek_fkey";

-- DropForeignKey
ALTER TABLE "player_gameweek_stats" DROP CONSTRAINT "player_gameweek_stats_playerId_fkey";

-- DropForeignKey
ALTER TABLE "user_gameweek_scores" DROP CONSTRAINT "user_gameweek_scores_gameweek_fkey";

-- DropIndex
DROP INDEX "user_gameweek_scores_gameweek_idx";

-- AlterTable
ALTER TABLE "player_gameweek_stats" DROP COLUMN "cleanSheet",
DROP COLUMN "goals",
DROP COLUMN "inDreamteam",
DROP COLUMN "raw",
ADD COLUMN     "cleanSheets" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "creativity" TEXT,
ADD COLUMN     "goalsScored" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "ictIndex" TEXT,
ADD COLUMN     "influence" TEXT,
ADD COLUMN     "threat" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "user_gameweek_scores" DROP COLUMN "points",
DROP COLUMN "totalPoints",
ADD COLUMN     "activeChip" TEXT,
ADD COLUMN     "autoSubsApplied" JSONB,
ADD COLUMN     "breakdown" JSONB,
ADD COLUMN     "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "captainPlayerId" INTEGER,
ADD COLUMN     "finalPoints" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pointsBeforeHits" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pointsHit" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "viceCaptainPlayerId" INTEGER;

-- CreateIndex
CREATE INDEX "user_gameweek_scores_userTeamId_gameweek_idx" ON "user_gameweek_scores"("userTeamId", "gameweek");

-- AddForeignKey
ALTER TABLE "user_gameweek_scores" ADD CONSTRAINT "user_gameweek_scores_gameweek_fkey" FOREIGN KEY ("gameweek") REFERENCES "fpl_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_gameweek_stats" ADD CONSTRAINT "player_gameweek_stats_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "fpl_players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_gameweek_stats" ADD CONSTRAINT "player_gameweek_stats_gameweek_fkey" FOREIGN KEY ("gameweek") REFERENCES "fpl_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
