-- AlterTable
ALTER TABLE "fpl_players" ADD COLUMN     "isActiveInFpl" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "fpl_players_isActiveInFpl_idx" ON "fpl_players"("isActiveInFpl");
