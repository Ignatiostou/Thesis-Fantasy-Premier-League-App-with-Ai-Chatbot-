/*
  Warnings:

  - You are about to drop the `Session` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `User` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Session" DROP CONSTRAINT "Session_userId_fkey";

-- DropTable
DROP TABLE "Session";

-- DropTable
DROP TABLE "User";

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "userAgent" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fpl_teams" (
    "id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT NOT NULL,
    "code" INTEGER,

    CONSTRAINT "fpl_teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fpl_players" (
    "id" INTEGER NOT NULL,
    "webName" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "secondName" TEXT NOT NULL,
    "teamId" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "nowCost" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "chanceOfPlayingNextRound" INTEGER,
    "totalPoints" INTEGER,
    "minutes" INTEGER,
    "raw" JSONB,

    CONSTRAINT "fpl_players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fpl_events" (
    "id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "deadlineTime" TIMESTAMP(3),
    "finished" BOOLEAN,
    "isCurrent" BOOLEAN,
    "raw" JSONB,

    CONSTRAINT "fpl_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fpl_fixtures" (
    "id" INTEGER NOT NULL,
    "event" INTEGER,
    "kickoffTime" TIMESTAMP(3),
    "teamHId" INTEGER NOT NULL,
    "teamAId" INTEGER NOT NULL,
    "teamHScore" INTEGER,
    "teamAScore" INTEGER,
    "teamHDifficulty" INTEGER,
    "teamADifficulty" INTEGER,
    "finished" BOOLEAN,
    "started" BOOLEAN,
    "stats" JSONB,
    "raw" JSONB,

    CONSTRAINT "fpl_fixtures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_teams" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "budget" INTEGER NOT NULL DEFAULT 1000,
    "season" TEXT NOT NULL DEFAULT '2024-25',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_teams_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refreshToken_key" ON "sessions"("refreshToken");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "fpl_players_teamId_idx" ON "fpl_players"("teamId");

-- CreateIndex
CREATE INDEX "fpl_fixtures_event_idx" ON "fpl_fixtures"("event");

-- CreateIndex
CREATE INDEX "fpl_fixtures_teamHId_idx" ON "fpl_fixtures"("teamHId");

-- CreateIndex
CREATE INDEX "fpl_fixtures_teamAId_idx" ON "fpl_fixtures"("teamAId");

-- CreateIndex
CREATE UNIQUE INDEX "user_teams_userId_key" ON "user_teams"("userId");

-- CreateIndex
CREATE INDEX "user_teams_userId_idx" ON "user_teams"("userId");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fpl_players" ADD CONSTRAINT "fpl_players_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "fpl_teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fpl_fixtures" ADD CONSTRAINT "fpl_fixtures_teamHId_fkey" FOREIGN KEY ("teamHId") REFERENCES "fpl_teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fpl_fixtures" ADD CONSTRAINT "fpl_fixtures_teamAId_fkey" FOREIGN KEY ("teamAId") REFERENCES "fpl_teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_teams" ADD CONSTRAINT "user_teams_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
