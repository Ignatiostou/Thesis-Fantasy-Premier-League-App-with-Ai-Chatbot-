// ─────────────────────────────────────────────────────────────────────────────
// Bridge between the Node API and the Python ML pipeline in apps/ai.
//
// Resolves the Python interpreter (apps/ai/.venv if present), spawns the
// pipeline scripts as child processes and streams their logs to the API
// console with an [ML] prefix.
// ─────────────────────────────────────────────────────────────────────────────

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// src/jobs → src → api → apps → apps/ai (same depth from dist/jobs after build)
const AI_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../ai');

const PIPELINE_TIMEOUT_MS = 45 * 60 * 1000; // hard cap: 45 minutes per run

export function resolvePython(): string {
  if (process.env.ML_PYTHON) return process.env.ML_PYTHON;

  const venvPython = path.join(AI_DIR, '.venv', 'Scripts', 'python.exe');
  if (existsSync(venvPython)) return venvPython;

  const venvPythonUnix = path.join(AI_DIR, '.venv', 'bin', 'python');
  if (existsSync(venvPythonUnix)) return venvPythonUnix;

  return 'python';
}

export function mlModelExists(): boolean {
  return existsSync(path.join(AI_DIR, 'artifacts', 'models', 'points_model.joblib'));
}

function runPython(scriptArgs: string[], label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const python = resolvePython();
    console.log(`[ML] ${label}: ${python} ${scriptArgs.join(' ')} (cwd: ${AI_DIR})`);

    const child = spawn(python, scriptArgs, {
      cwd: AI_DIR,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timeout = setTimeout(() => {
      console.error(`[ML] ${label} exceeded ${PIPELINE_TIMEOUT_MS / 60000} min — killing`);
      child.kill();
    }, PIPELINE_TIMEOUT_MS);

    const forward = (data: Buffer) => {
      for (const line of data.toString().split(/\r?\n/)) {
        if (line.trim()) console.log(`[ML] ${line}`);
      }
    };
    child.stdout.on('data', forward);
    child.stderr.on('data', forward);

    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`[ML] Failed to start Python (${python}): ${err.message}`));
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        console.log(`[ML] ${label} finished successfully`);
        resolve();
      } else {
        reject(new Error(`[ML] ${label} exited with code ${code}`));
      }
    });
  });
}

/** Full pipeline for a just-completed gameweek: retrain + predict GW+1 + store. */
export function runMlPipeline(completedGameweek: number): Promise<void> {
  return runPython(
    ['pipeline.py', '--completed-gameweek', String(completedGameweek)],
    `pipeline (GW${completedGameweek} completed)`,
  );
}

/** One-time historical backfill: download season history, train, predict. */
export function runMlBackfill(): Promise<void> {
  return runPython(['scripts/backfill_season.py'], 'historical backfill');
}
