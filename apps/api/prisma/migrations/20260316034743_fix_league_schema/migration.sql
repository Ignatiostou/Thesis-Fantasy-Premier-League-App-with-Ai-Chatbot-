-- Step 1: Rename adminId to adminUserId in leagues table
-- Drop the old foreign key constraint
ALTER TABLE "leagues" DROP CONSTRAINT "leagues_adminId_fkey";

-- Drop the old index
DROP INDEX "leagues_adminId_idx";

-- Rename the column
ALTER TABLE "leagues" RENAME COLUMN "adminId" TO "adminUserId";

-- Recreate the index with new name
CREATE INDEX "leagues_adminUserId_idx" ON "leagues"("adminUserId");

-- Recreate the foreign key constraint
ALTER TABLE "leagues" ADD CONSTRAINT "leagues_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Step 2: Add userTeamId to league_members
-- First, add the column as nullable
ALTER TABLE "league_members" ADD COLUMN "userTeamId" TEXT;

-- Populate userTeamId by looking up the user's team
UPDATE "league_members" 
SET "userTeamId" = (
  SELECT "id" 
  FROM "user_teams" 
  WHERE "user_teams"."userId" = "league_members"."userId"
  LIMIT 1
);

-- Make the column NOT NULL after populating
ALTER TABLE "league_members" ALTER COLUMN "userTeamId" SET NOT NULL;

-- Add index for userTeamId
CREATE INDEX "league_members_userTeamId_idx" ON "league_members"("userTeamId");

-- Add unique constraint for leagueId and userTeamId
CREATE UNIQUE INDEX "league_members_leagueId_userTeamId_key" ON "league_members"("leagueId", "userTeamId");

-- Add foreign key constraint
ALTER TABLE "league_members" ADD CONSTRAINT "league_members_userTeamId_fkey" FOREIGN KEY ("userTeamId") REFERENCES "user_teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
