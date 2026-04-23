-- AlterTable
ALTER TABLE "fpl_players" ADD COLUMN     "assists" INTEGER,
ADD COLUMN     "bonus" INTEGER,
ADD COLUMN     "cleanSheets" INTEGER,
ADD COLUMN     "form" DOUBLE PRECISION,
ADD COLUMN     "goalsScored" INTEGER,
ADD COLUMN     "selectedByPercent" DOUBLE PRECISION;
