// diagnostic.ts — run with: npx tsx diagnostic.ts
// Drop this in apps/api/ and run it to find the chat failure cause.

import { prisma } from './src/db/prisma.js';

async function diagnose() {
  console.log('\n========= CoachBot Diagnostic =========\n');

  // 1. DB connection
  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log('✅  DB connection: OK');
  } catch (e: any) {
    console.log('❌  DB connection FAILED:', e.message);
    process.exit(1);
  }

  // 2. Editable gameweek
  try {
    const gw = await prisma.fplEvent.findFirst({
      where: { isCurrent: true },
      select: { id: true, name: true },
    });
    if (gw) {
      console.log(`✅  Editable gameweek: GW${gw.id} (${gw.name})`);
    } else {
      console.log('❌  No editable gameweek found — this will crash buildRecommendationContext');
      console.log('    Fix: run your FPL sync, or manually set isEditable=true on a gameweek row');
    }
  } catch (e: any) {
    console.log('❌  Gameweek query failed:', e.message);
  }

  // 3. Anthropic API key
  const key = process.env.ANTHROPIC_API_KEY;
  if (key && key.startsWith('sk-ant-')) {
    console.log('✅  ANTHROPIC_API_KEY: present');
  } else if (key) {
    console.log('⚠️   ANTHROPIC_API_KEY: present but unexpected format');
  } else {
    console.log('❌  ANTHROPIC_API_KEY: missing from .env');
  }

  // 4. LLM provider
  const provider = process.env.LLM_PROVIDER ?? 'anthropic';
  console.log(`ℹ️   LLM_PROVIDER: ${provider}`);
  if (provider === 'openai') {
    const okey = process.env.OPENAI_API_KEY;
    console.log(okey ? '✅  OPENAI_API_KEY: present' : '❌  OPENAI_API_KEY: missing');
  }

  // 5. Any users exist
  try {
    const userCount = await prisma.user.count();
    console.log(`ℹ️   Users in DB: ${userCount}`);
  } catch (e: any) {
    console.log('❌  User table query failed:', e.message);
  }

  // 6. Any FPL players synced
  try {
    const playerCount = await prisma.fplPlayer.count();
    console.log(
      playerCount > 0
        ? `✅  FplPlayer rows: ${playerCount}`
        : '❌  No FPL players in DB — sync has not run',
    );
  } catch (e: any) {
    console.log('❌  FplPlayer query failed:', e.message);
  }

  // 7. PlayerPrediction table exists and has rows
  try {
    const predCount = await (prisma as any).playerPrediction.count();
    console.log(
      predCount > 0
        ? `✅  PlayerPrediction rows: ${predCount}`
        : '⚠️   PlayerPrediction table exists but is empty — ML will fall back to heuristic',
    );
  } catch (e: any) {
    if (e.message?.includes('does not exist')) {
      console.log('⚠️   PlayerPrediction table does not exist yet — run prisma db push first');
    } else {
      console.log('❌  PlayerPrediction query failed:', e.message);
    }
  }

  // 8. AssistantSession table
  try {
    const sessionCount = await prisma.assistantSession.count();
    console.log(`ℹ️   AssistantSessions in DB: ${sessionCount}`);
  } catch (e: any) {
    console.log('❌  AssistantSession table query failed:', e.message);
  }

  // 9. RecommendationLog table
  try {
    const logCount = await prisma.recommendationLog.count();
    console.log(`ℹ️   RecommendationLog rows: ${logCount}`);
  } catch (e: any) {
    console.log('❌  RecommendationLog table query failed:', e.message);
  }

  console.log('\n======================================\n');
  await prisma.$disconnect();
}

diagnose().catch(console.error);