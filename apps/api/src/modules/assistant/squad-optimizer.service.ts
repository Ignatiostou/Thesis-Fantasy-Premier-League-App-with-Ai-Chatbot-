import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const PYTHON_BIN = process.env.PYTHON_BIN ?? 'python3';
const SCRIPT_PATH =
  process.env.SQUAD_OPTIMIZER_SCRIPT ??
  resolve(process.cwd(), '../../ai/inference/optimize_initial_squad.py');

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
  reason?:          string;
}

export interface OptimizeOptions {
  userId?:     string;
  budget?:     number;          // in tenths; default 1000 (= £100.0m)
  forceIn?:    number[];
  forceOut?:   number[];
}

// ── Spawn wrapper ────────────────────────────────────────────────────────────

export async function optimizeInitialSquad(
  opts: OptimizeOptions = {},
): Promise<OptimizedSquadResult> {
  const args: string[] = [SCRIPT_PATH, '--json-out'];
  if (opts.userId)   args.push('--user-id', opts.userId);
  if (opts.budget)   args.push('--budget', String(opts.budget));
  if (opts.forceIn?.length)
    args.push('--force-in',  ...opts.forceIn.map(String));
  if (opts.forceOut?.length)
    args.push('--force-out', ...opts.forceOut.map(String));

  return new Promise((resolveP) => {
    const proc = spawn(PYTHON_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
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
  lines.push('For each DEF/GK, explicitly mention whether their value comes mainly from');
  lines.push('their team\'s defence (clean sheets) or from playing in an attacking team');
  lines.push('(goal/assist threat) — use the "value_source" hint shown next to each player above.');
  lines.push('For each MID/FWD, where a "value_source" hint is present, mention whether it\'s because');
  lines.push('their team has been in good attacking form recently, or has a strong season-long attacking record.');
  lines.push('Frame it as a STARTING POINT — the user should adjust based on personal preferences.');

  return lines.join('\n');
}
