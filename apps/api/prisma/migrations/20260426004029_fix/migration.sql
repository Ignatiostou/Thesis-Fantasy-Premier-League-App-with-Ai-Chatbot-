/*
  Warnings:

  - The primary key for the `player_predictions` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `id` column on the `player_predictions` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "player_predictions" DROP CONSTRAINT "player_predictions_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" SERIAL NOT NULL,
ADD CONSTRAINT "player_predictions_pkey" PRIMARY KEY ("id");
