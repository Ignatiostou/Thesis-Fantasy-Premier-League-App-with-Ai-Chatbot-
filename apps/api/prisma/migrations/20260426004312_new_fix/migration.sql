/*
  Warnings:

  - Added the required column `predicted_minutes` to the `player_predictions` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "player_predictions" ADD COLUMN     "predicted_minutes" DOUBLE PRECISION NOT NULL;
