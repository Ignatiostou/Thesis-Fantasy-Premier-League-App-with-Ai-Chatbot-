-- AlterTable
ALTER TABLE "AssistantSession" ADD COLUMN     "conversationSummary" TEXT,
ADD COLUMN     "summarisedMessageCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "summaryLastUpdatedAt" TIMESTAMP(3);
