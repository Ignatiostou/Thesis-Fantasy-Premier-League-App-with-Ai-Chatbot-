/*
  Warnings:

  - You are about to drop the column `budgetBeforeChip` on the `user_gameweek_scores` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "user_gameweek_scores" DROP COLUMN "budgetBeforeChip";

-- AlterTable
ALTER TABLE "user_gw_states" ADD COLUMN     "budgetBeforeChip" INTEGER;
