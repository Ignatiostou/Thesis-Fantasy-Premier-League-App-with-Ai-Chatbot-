-- CreateTable
CREATE TABLE "gameweek_scoring_status" (
    "gameweek" INTEGER NOT NULL,
    "isFinal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gameweek_scoring_status_pkey" PRIMARY KEY ("gameweek")
);
