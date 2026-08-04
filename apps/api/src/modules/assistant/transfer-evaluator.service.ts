import { prisma }                from '../../db/prisma.js';
import { getEditableGameweekId } from '../../utils/gameweek.js';
import { findMentionedPlayersDetailed } from './player-search.service.js';
import { checkEligibility, buildEligibilitySnapshots } from './player-eligibility.service.js';
import type { TransferEvaluationResult } from './recommendation.types.js';

function getSellPriceFplProfitHalf(buyPrice: number, nowCost: number) {
  if (nowCost <= buyPrice) return nowCost;
  return buyPrice + Math.floor((nowCost - buyPrice) / 2);
}

const POSITION_LABEL: Record<number, string> = {
  1: 'GK',
  2: 'DEF',
  3: 'MID',
  4: 'FWD',
};

export async function evaluateMentionedTransfer(
  userId: string,
  message: string,
): Promise<TransferEvaluationResult> {
  const gameweek = await getEditableGameweekId();

  const team = await prisma.userTeam.findUnique({
    where: { userId },
    include: {
      picks: {
        where: { gameweek },
        include: {
          player: { include: { team: true } },
        },
      },
    },
  });

  if (!team) {
    return {
      detected: false,
      outgoingPlayer: null,
      incomingPlayer: null,
      recommendation: 'No team found yet, so transfer evaluation is not available.',
    };
  }

  
  const { players: mentioned, excluded } = await findMentionedPlayersDetailed(message, 8, {
    eligibilityMode: 'PERMISSIVE',
  });

  if (!mentioned.length) {
    if (excluded.length > 0) {
      return {
        detected: false,
        outgoingPlayer: null,
        incomingPlayer: null,
        recommendation:
          `I found a name match for ${excluded[0].webName}, but they don't appear to be active in the ` +
          `Premier League right now (${excluded[0].reasons.join('; ')}), so I can't evaluate this transfer.`,
      };
    }
    return {
      detected: false,
      outgoingPlayer: null,
      incomingPlayer: null,
      recommendation: 'I could not confidently detect the players involved in the transfer.',
    };
  }

  const squadPlayerIds = new Set(team.picks.map((p) => p.playerId));

  const outgoingMention = mentioned.find((p) => squadPlayerIds.has(p.id)) ?? null;
  const incomingMention = mentioned.find((p) => !squadPlayerIds.has(p.id)) ?? null;

  if (!outgoingMention || !incomingMention) {
    return {
      detected: false,
      outgoingPlayer: null,
      incomingPlayer: null,
      recommendation:
        'I could not clearly determine which player is going out and which one is coming in.',
    };
  }

  // IMPROVEMENT #11: STRICT re-check on the INCOMING player specifically —
  // this is the one we'd actually be recommending the manager spend on.
  const incomingSnapshot = await buildEligibilitySnapshots([incomingMention.id]);
  const incomingEligibility = checkEligibility(incomingSnapshot.get(incomingMention.id), 'STRICT');
  if (!incomingEligibility.eligible) {
    return {
      detected: false,
      outgoingPlayer: null,
      incomingPlayer: null,
      recommendation:
        `${incomingMention.webName} doesn't pass the bar for a recommended transfer target right now ` +
        `(${incomingEligibility.reasons.join('; ')}). I won't suggest spending budget on them — ` +
        `let me know if you'd like an alternative.`,
    };
  }

  const outgoingPick = team.picks.find((p) => p.playerId === outgoingMention.id)!;

  const sellPrice = getSellPriceFplProfitHalf(
    outgoingPick.buyPrice,
    outgoingMention.nowCost,
  );

  const bankBefore = team.budget;
  const bankAfter = bankBefore + sellPrice - incomingMention.nowCost;

  const samePosition = outgoingMention.position === incomingMention.position;

  const nextClubCounts = new Map<number, number>();
  for (const pick of team.picks) {
    const nextTeamId =
      pick.playerId === outgoingMention.id
        ? incomingMention.teamId
        : pick.player.teamId;

    nextClubCounts.set(nextTeamId, (nextClubCounts.get(nextTeamId) ?? 0) + 1);
  }

  const maxPerClubLikelyOk = [...nextClubCounts.values()].every((count) => count <= 3);

  const risks: string[] = [];
  if (bankAfter < 0) risks.push('not affordable with current bank');
  if (!samePosition) risks.push('position mismatch');
  if (!maxPerClubLikelyOk) risks.push('likely breaks max 3 players per club');
  if ((incomingMention.chanceOfPlayingNextRound ?? 100) < 75) {
    risks.push('incoming player has availability/minutes risk');
  }
  if (incomingMention.status !== 'a') {
    risks.push(`incoming player has status flag: ${incomingMention.status}`);
  }

  const recommendation =
    bankAfter >= 0 && samePosition && maxPerClubLikelyOk
      ? `This move looks technically valid and affordable. The main question is whether ${incomingMention.webName}'s upside is strong enough to justify giving up ${outgoingMention.webName}.`
      : `This move has structural issues, so I would be cautious unless there is a strong strategic reason.`

  return {
    detected: true,
    outgoingPlayer: {
      playerId:  outgoingMention.id,
      webName:   outgoingMention.webName,
      club:      outgoingMention.team.shortName,
      position:  POSITION_LABEL[outgoingMention.position] ?? 'UNK',
      sellPrice,
    },
    incomingPlayer: {
      playerId:                incomingMention.id,
      webName:                 incomingMention.webName,
      club:                    incomingMention.team.shortName,
      position:                POSITION_LABEL[incomingMention.position] ?? 'UNK',
      buyPrice:                incomingMention.nowCost,
      totalPoints:             incomingMention.totalPoints ?? 0,
      form:                    typeof incomingMention.form === 'number' ? incomingMention.form : Number(incomingMention.form ?? 0),
      status:                  incomingMention.status,
      chanceOfPlayingNextRound:incomingMention.chanceOfPlayingNextRound ?? null,
    },
    budgetImpact: {
      bankBefore,
      bankAfter,
      affordable: bankAfter >= 0,
    },
    ruleCheck: {
      samePosition,
      maxPerClubLikelyOk,
    },
    recommendation,
    risks,
  };
}
