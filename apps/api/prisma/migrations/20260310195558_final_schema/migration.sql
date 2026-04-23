-- CreateEnum
CREATE TYPE "LeagueType" AS ENUM ('CLASSIC', 'HEAD_TO_HEAD');

-- CreateTable
CREATE TABLE "user_gameweek_scores" (
    "id" TEXT NOT NULL,
    "userTeamId" TEXT NOT NULL,
    "gameweek" INTEGER NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,
    "totalPoints" INTEGER NOT NULL DEFAULT 0,
    "transferHits" INTEGER NOT NULL DEFAULT 0,
    "benchPoints" INTEGER NOT NULL DEFAULT 0,
    "rank" INTEGER,
    "chipPlayed" "ChipType",

    CONSTRAINT "user_gameweek_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_gameweek_stats" (
    "id" TEXT NOT NULL,
    "playerId" INTEGER NOT NULL,
    "gameweek" INTEGER NOT NULL,
    "minutes" INTEGER NOT NULL DEFAULT 0,
    "goals" INTEGER NOT NULL DEFAULT 0,
    "assists" INTEGER NOT NULL DEFAULT 0,
    "cleanSheet" BOOLEAN NOT NULL DEFAULT false,
    "goalsConceded" INTEGER NOT NULL DEFAULT 0,
    "ownGoals" INTEGER NOT NULL DEFAULT 0,
    "penaltiesSaved" INTEGER NOT NULL DEFAULT 0,
    "penaltiesMissed" INTEGER NOT NULL DEFAULT 0,
    "yellowCards" INTEGER NOT NULL DEFAULT 0,
    "redCards" INTEGER NOT NULL DEFAULT 0,
    "saves" INTEGER NOT NULL DEFAULT 0,
    "bonus" INTEGER NOT NULL DEFAULT 0,
    "bps" INTEGER NOT NULL DEFAULT 0,
    "totalPoints" INTEGER NOT NULL DEFAULT 0,
    "inDreamteam" BOOLEAN NOT NULL DEFAULT false,
    "raw" JSONB,

    CONSTRAINT "player_gameweek_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leagues" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "LeagueType" NOT NULL DEFAULT 'CLASSIC',
    "adminId" TEXT NOT NULL,
    "maxMembers" INTEGER NOT NULL DEFAULT 20,
    "season" TEXT NOT NULL DEFAULT '2025-26',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leagues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "league_members" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "league_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "h2h_matches" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "gameweek" INTEGER NOT NULL,
    "homeUserId" TEXT NOT NULL,
    "awayUserId" TEXT NOT NULL,
    "homePts" INTEGER NOT NULL DEFAULT 0,
    "awayPts" INTEGER NOT NULL DEFAULT 0,
    "winnerId" TEXT,

    CONSTRAINT "h2h_matches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_gameweek_scores_gameweek_idx" ON "user_gameweek_scores"("gameweek");

-- CreateIndex
CREATE UNIQUE INDEX "user_gameweek_scores_userTeamId_gameweek_key" ON "user_gameweek_scores"("userTeamId", "gameweek");

-- CreateIndex
CREATE INDEX "player_gameweek_stats_gameweek_idx" ON "player_gameweek_stats"("gameweek");

-- CreateIndex
CREATE INDEX "player_gameweek_stats_playerId_idx" ON "player_gameweek_stats"("playerId");

-- CreateIndex
CREATE UNIQUE INDEX "player_gameweek_stats_playerId_gameweek_key" ON "player_gameweek_stats"("playerId", "gameweek");

-- CreateIndex
CREATE UNIQUE INDEX "leagues_code_key" ON "leagues"("code");

-- CreateIndex
CREATE INDEX "leagues_adminId_idx" ON "leagues"("adminId");

-- CreateIndex
CREATE INDEX "league_members_leagueId_idx" ON "league_members"("leagueId");

-- CreateIndex
CREATE INDEX "league_members_userId_idx" ON "league_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "league_members_leagueId_userId_key" ON "league_members"("leagueId", "userId");

-- CreateIndex
CREATE INDEX "h2h_matches_leagueId_gameweek_idx" ON "h2h_matches"("leagueId", "gameweek");

-- CreateIndex
CREATE UNIQUE INDEX "h2h_matches_leagueId_gameweek_homeUserId_awayUserId_key" ON "h2h_matches"("leagueId", "gameweek", "homeUserId", "awayUserId");

-- AddForeignKey
ALTER TABLE "user_gameweek_scores" ADD CONSTRAINT "user_gameweek_scores_userTeamId_fkey" FOREIGN KEY ("userTeamId") REFERENCES "user_teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_gameweek_scores" ADD CONSTRAINT "user_gameweek_scores_gameweek_fkey" FOREIGN KEY ("gameweek") REFERENCES "fpl_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_gameweek_stats" ADD CONSTRAINT "player_gameweek_stats_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "fpl_players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_gameweek_stats" ADD CONSTRAINT "player_gameweek_stats_gameweek_fkey" FOREIGN KEY ("gameweek") REFERENCES "fpl_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leagues" ADD CONSTRAINT "leagues_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "league_members" ADD CONSTRAINT "league_members_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "league_members" ADD CONSTRAINT "league_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "h2h_matches" ADD CONSTRAINT "h2h_matches_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "h2h_matches" ADD CONSTRAINT "h2h_matches_gameweek_fkey" FOREIGN KEY ("gameweek") REFERENCES "fpl_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
