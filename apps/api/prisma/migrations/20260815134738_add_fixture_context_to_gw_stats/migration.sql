-- AlterTable
ALTER TABLE "player_gameweek_stats" ADD COLUMN     "fixtureCount" INTEGER,
ADD COLUMN     "opponentTeamId" INTEGER,
ADD COLUMN     "teamId" INTEGER,
ADD COLUMN     "wasHome" BOOLEAN;
