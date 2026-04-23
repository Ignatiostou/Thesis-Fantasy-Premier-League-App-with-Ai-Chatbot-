-- CreateEnum
CREATE TYPE "AssistantSessionStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AssistantMessageRole" AS ENUM ('SYSTEM', 'USER', 'ASSISTANT');

-- CreateEnum
CREATE TYPE "AssistantIntent" AS ENUM ('GENERAL_HELP', 'ONBOARDING', 'INITIAL_SQUAD', 'TRANSFER_ADVICE', 'TRANSFER_EVALUATION', 'CAPTAINCY', 'BENCH_ORDER', 'FORMATION_ADVICE', 'CHIP_ADVICE', 'PLAYER_COMPARISON');

-- CreateTable
CREATE TABLE "UserAssistantProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "riskTolerance" INTEGER NOT NULL DEFAULT 2,
    "budgetStyle" INTEGER NOT NULL DEFAULT 2,
    "preferredFocus" INTEGER NOT NULL DEFAULT 2,
    "differentialPreference" INTEGER NOT NULL DEFAULT 2,
    "planningHorizon" INTEGER NOT NULL DEFAULT 2,
    "explanationDepth" INTEGER NOT NULL DEFAULT 2,
    "onboardingCompleted" BOOLEAN NOT NULL DEFAULT false,
    "onboardingStep" INTEGER NOT NULL DEFAULT 0,
    "onboardingVersion" INTEGER NOT NULL DEFAULT 1,
    "favoriteTeams" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserAssistantProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssistantSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "status" "AssistantSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssistantSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssistantMessage" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" "AssistantMessageRole" NOT NULL,
    "intent" "AssistantIntent",
    "content" TEXT NOT NULL,
    "structuredData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssistantMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecommendationLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT,
    "intent" "AssistantIntent",
    "recommendationType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "wasAccepted" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecommendationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserAssistantProfile_userId_key" ON "UserAssistantProfile"("userId");

-- CreateIndex
CREATE INDEX "AssistantSession_userId_createdAt_idx" ON "AssistantSession"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AssistantMessage_sessionId_createdAt_idx" ON "AssistantMessage"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "RecommendationLog_userId_createdAt_idx" ON "RecommendationLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "RecommendationLog_sessionId_idx" ON "RecommendationLog"("sessionId");

-- AddForeignKey
ALTER TABLE "UserAssistantProfile" ADD CONSTRAINT "UserAssistantProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantSession" ADD CONSTRAINT "AssistantSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantMessage" ADD CONSTRAINT "AssistantMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AssistantSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecommendationLog" ADD CONSTRAINT "RecommendationLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecommendationLog" ADD CONSTRAINT "RecommendationLog_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AssistantSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
