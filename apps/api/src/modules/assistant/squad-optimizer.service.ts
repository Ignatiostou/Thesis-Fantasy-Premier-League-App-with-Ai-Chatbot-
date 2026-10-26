import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePython } from '../../jobs/ml-pipeline.service.js';

// Was process.cwd()-relative + hardcoded 'python3' — fragile (breaks depending
// on where the Node process happens to be started from) and wrong on Windows
// dev setups (no 'python3' on PATH, and it wouldn't pick up apps/ai/.venv
// where pulp/pandas/etc. are actually installed). Anchored to this file's own
// location instead, same pattern as ml-pipeline.service.ts. (fileURLToPath,
// not new URL().pathname — the latter yields "/C:/..." on Windows, which
// path.resolve does NOT treat as the same thing as "C:\...".)
const AI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../ai');
const SCRIPT_PATH =
  process.env.SQUAD_OPTIMIZER_SCRIPT ??
  resolve(AI_DIR, 'inference/optimize_initial_squad.py');

const TIMEOUT_MS = 60_000;



export interface OptimizedSquadPlayer {
  player_id:            number;
  web_name:             string;
  position:             'GK' | 'DEF' | 'MID' | 'FWD';
  team:                 string;
  cost:                 number;
  predicted_pts_gw1:    number;
  predicted_pts_gw5:    number;
  prob_playing:         number;
  confidence:           'HIGH' | 'MEDIUM' | 'LOW';
  ownership_percent:    number;
  objective_value:      number;
  value_source:         'DEFENCE-DRIVEN' | 'ATTACK-DRIVEN' | 'BALANCED' | 'TEAM-IN-FORM' | 'TEAM-ATTACK-STRONG' | null;
}

export interface OptimizedSquadResult {
  status:           'OPTIMAL' | 'INFEASIBLE' | 'TIMEOUT' | 'ERROR';
  objective_value?: number;
  squad?:           OptimizedSquadPlayer[];
  budget_used?:     number;
  budget_left?:     number;
  weights?:         Record<string, number>;
  candidate_count?: number;
  /** Ranked shortlist beyond the 15-man squad — position-balanced, not
   *  budget/club constrained. Lets the user ask to see more or fewer
   *  candidates than the one ILP-optimal squad. */
  pool?:            OptimizedSquadPlayer[];
  pool_size?:       number;
  reason?:          string;
}

export interface OptimizeOptions {
  userId?:     string;
  budget?:     number;          // in tenths; default 1000 (= £100.0m)
  forceIn?:    number[];
  forceOut?:   number[];
  /** Size of the ranked candidate shortlist to return. Default 30. */
  poolSize?:   number;
}

// ── Spawn wrapper ────────────────────────────────────────────────────────────

export async function optimizeInitialSquad(
  opts: OptimizeOptions = {},
): Promise<OptimizedSquadResult> {
  const args: string[] = [SCRIPT_PATH, '--json-out'];
  if (opts.userId)   args.push('--user-id', opts.userId);
  if (opts.budget)   args.push('--budget', String(opts.budget));
  if (opts.poolSize) args.push('--pool-size', String(opts.poolSize));
  if (opts.forceIn?.length)
    args.push('--force-in',  ...opts.forceIn.map(String));
  if (opts.forceOut?.length)
    args.push('--force-out', ...opts.forceOut.map(String));

  return new Promise((resolveP) => {
    const proc = spawn(resolvePython(), args, {
      cwd:   AI_DIR,
      env:   { ...process.env, PYTHONIOENCODING: 'utf-8' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      resolveP({ status: 'TIMEOUT', reason: `Optimiser exceeded ${TIMEOUT_MS}ms` });
    }, TIMEOUT_MS);

    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        resolveP({
          status: 'ERROR',
          reason: `Optimiser exited with code ${code}: ${stderr.slice(-500)}`,
        });
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        resolveP(parsed as OptimizedSquadResult);
      } catch {
        resolveP({
          status: 'ERROR',
          reason: `Could not parse optimiser stdout: ${stdout.slice(0, 200)}`,
        });
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolveP({ status: 'ERROR', reason: err.message });
    });
  });
}

// ── Format for the prompt ────────────────────────────────────────────────────

function valueSourceNarration(p: OptimizedSquadPlayer): string {
 
  switch (p.value_source) {
    case 'DEFENCE-DRIVEN':
      return ' — value driven mainly by a strong defence (clean-sheet potential)';
    case 'ATTACK-DRIVEN':
      return ' — value driven mainly by playing in an attacking side (goal/assist threat)';
    case 'BALANCED':
      return ' — balanced value from both defence and attacking threat';
    case 'TEAM-IN-FORM':
      return ' — team has been scoring more than usual over its last 5 matches';
    case 'TEAM-ATTACK-STRONG':
      return ' — plays for one of the league\'s strongest attacking teams this season';
    default:
      return '';
  }
}

export function formatOptimisedSquadForPrompt(result: OptimizedSquadResult): string {
  if (result.status !== 'OPTIMAL' || !result.squad) {
    return [
      `ILP optimiser returned status: ${result.status}.`,
      result.reason ?? '',
      'Provide guidance to the user about building a squad manually.',
    ].join('\n');
  }

  const byPos: Record<string, OptimizedSquadPlayer[]> = { GK: [], DEF: [], MID: [], FWD: [] };
  for (const p of result.squad) byPos[p.position].push(p);

  const lines: string[] = [
    `=== ILP-OPTIMISED INITIAL SQUAD ===`,
    `Budget used: £${result.budget_used?.toFixed(1)}m / £100.0m  (£${result.budget_left?.toFixed(1)}m left in bank)`,
    `Objective value: ${result.objective_value?.toFixed(2)}`,
    `Candidates evaluated: ${result.candidate_count}`,
    '',
  ];

  for (const pos of ['GK', 'DEF', 'MID', 'FWD'] as const) {
    lines.push(`${pos} (${byPos[pos].length}):`);
    for (const p of byPos[pos]) {
      lines.push(
        `  ${p.web_name} (${p.team}) · £${p.cost.toFixed(1)}m · ` +
        `xPts GW1 ${p.predicted_pts_gw1.toFixed(2)} · ` +
        `xPts 5GW total ${p.predicted_pts_gw5.toFixed(2)} · ` +
        `${Math.round(p.prob_playing * 100)}% playing · ${p.confidence} conf · ` +
        `${p.ownership_percent.toFixed(1)}% owned` +
        valueSourceNarration(p),
      );
    }
    lines.push('');
  }

  if (result.pool?.length) {
    const squadIds = new Set((result.squad ?? []).map((p) => p.player_id));
    const extras = result.pool.filter((p) => !squadIds.has(p.player_id));
    const byPosExtra: Record<string, OptimizedSquadPlayer[]> = { GK: [], DEF: [], MID: [], FWD: [] };
    for (const p of extras) byPosExtra[p.position].push(p);

    lines.push(`=== EXTENDED CANDIDATE POOL (${result.pool.length} ranked total, ${extras.length} beyond the squad above) ===`);
    for (const pos of ['GK', 'DEF', 'MID', 'FWD'] as const) {
      if (!byPosExtra[pos].length) continue;
      lines.push(`${pos}:`);
      for (const p of byPosExtra[pos]) {
        lines.push(
          `  ${p.web_name} (${p.team}) · £${p.cost.toFixed(1)}m · ` +
          `xPts 5GW total ${p.predicted_pts_gw5.toFixed(2)} · ${p.ownership_percent.toFixed(1)}% owned`,
        );
      }
    }
    lines.push('');
    lines.push(
      'INSTRUCTION: The 15-man squad above is the one ILP-optimal, budget-valid ' +
      'squad. The extended pool is a ranked shortlist of further good candidates ' +
      '— NOT a second valid squad (no budget/club-limit check was applied to it). ' +
      'By default just present the 15-man squad. If the user explicitly asked to ' +
      'see more players than 15, or asked for a specific number, or asked for ' +
      '"more"/"fewer" options, draw additional picks from this pool (by position, ' +
      'highest ranked first) to match what they asked for — do not invent players ' +
      'outside the squad + pool data given here.',
    );
    lines.push('');
  }

  lines.push(`Profile-derived weights used:`);
  if (result.weights) {
    for (const [k, v] of Object.entries(result.weights)) {
      lines.push(`  ${k}: ${typeof v === 'number' ? v.toFixed(2) : v}`);
    }
  }
  lines.push('');
  lines.push('INSTRUCTION: Present this squad clearly grouped by position.');
  lines.push('Mention budget usage, the captaincy candidate (highest xPts forward/mid),');
  lines.push('and explain WHY each premium-priced pick fits the user\'s profile.');

  // Only ask for the value-source narration when the optimiser actually emitted
  // one. It tags a player only when a component clearly dominates, so on many
  // squads the field is null for everyone — and an unconditional "explicitly
  // mention whether their value comes from X or Y" instruction then leaves the
  // model a labelled slot with nothing to put in it, which it fills by
  // inventing plausible-sounding sources. Ask only for what exists.
  const hasValueSource = result.squad.some((p) => p.value_source !== null);
  if (hasValueSource) {
    lines.push('Some players above carry a "value driven by…" note. Where such a note is');
    lines.push('present, mention what is driving that pick (team defence and clean-sheet');
    lines.push('potential, attacking threat, recent team form, or season-long attacking');
    lines.push('strength). Do NOT invent or guess a value source for any player that has');
    lines.push('no such note — simply omit it for those players.');
  } else {
    lines.push('No per-player "value driven by…" notes were produced for this squad, so do');
    lines.push('NOT attribute a value source to any player. Justify picks only from the');
    lines.push('figures shown above (xPts, price, playing probability, confidence, ownership).');
  }

  lines.push('Frame it as a STARTING POINT — the user should adjust based on personal preferences.');

  return lines.join('\n');
}
