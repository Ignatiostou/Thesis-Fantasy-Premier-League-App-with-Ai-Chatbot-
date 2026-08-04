-- CreateTable
CREATE TABLE "player_predictions" (
    "id" TEXT NOT NULL,
    "player_id" INTEGER NOT NULL,
    "gameweek" INTEGER NOT NULL,
    "predicted_pts_gw1" DOUBLE PRECISION NOT NULL,
    "predicted_pts_gw3" DOUBLE PRECISION NOT NULL,
    "predicted_pts_gw5" DOUBLE PRECISION NOT NULL,
    "prob_playing" DOUBLE PRECISION NOT NULL,
    "prob_60_plus_mins" DOUBLE PRECISION NOT NULL,
    "model_version" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "player_predictions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "player_predictions_player_id_idx" ON "player_predictions"("player_id");

-- CreateIndex
CREATE INDEX "player_predictions_gameweek_idx" ON "player_predictions"("gameweek");

-- CreateIndex
CREATE UNIQUE INDEX "player_predictions_player_id_gameweek_key" ON "player_predictions"("player_id", "gameweek");

-- AddForeignKey
ALTER TABLE "player_predictions" ADD CONSTRAINT "player_predictions_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "fpl_players"("id") ON DELETE CASCADE ON UPDATE CASCADE;
