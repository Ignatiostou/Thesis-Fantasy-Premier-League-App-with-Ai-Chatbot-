/*
  Warnings:

  - A unique constraint covering the columns `[player_id,gameweek,model_version]` on the table `player_predictions` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "player_predictions_player_id_gameweek_key";

-- CreateIndex
CREATE UNIQUE INDEX "player_predictions_player_id_gameweek_model_version_key" ON "player_predictions"("player_id", "gameweek", "model_version");
