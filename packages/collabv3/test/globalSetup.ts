/**
 * Vitest global setup: applies D1 migrations and starts a single
 * wrangler dev --local instance shared across all integration test files.
 */

import { spawn, execSync, type ChildProcess } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const PORT = 8791;
const READY_TIMEOUT = 15_000;

let proc: ChildProcess | null = null;

// Safety net: if the process exits without teardown (Ctrl+C, crash),
// kill the wrangler process group so workerd doesn't linger.
function emergencyCleanup() {
  if (proc?.pid) {
    try { process.kill(-proc.pid, 'SIGKILL'); } catch { /* already gone */ }
  }
}
process.on('exit', emergencyCleanup);
process.on('SIGINT', () => { emergencyCleanup(); process.exit(1); });
process.on('SIGTERM', () => { emergencyCleanup(); process.exit(1); });

export async function setup() {
  const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

  // Apply D1 migrations before starting the dev server
  execSync('npx wrangler d1 migrations apply nimbalyst-collabv3 --local', {
    cwd,
    stdio: 'pipe',
    env: { ...process.env, NO_COLOR: '1' },
  });

  await new Promise<void>((resolve, reject) => {
    proc = spawn(
      'npx',
      ['wrangler', 'dev', '--local', '--port', String(PORT), '--inspector-port', '0'],
      {
        cwd,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, NO_COLOR: '1' },
      }
    );

    let output = '';
    const timeout = setTimeout(() => {
      if (proc) killProcessGroup(proc, 'SIGKILL');
      reject(new Error(`Wrangler did not start within ${READY_TIMEOUT}ms.\nOutput: ${output}`));
    }, READY_TIMEOUT);

    const onData = (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      if (text.includes('Ready on')) {
        clearTimeout(timeout);
        setTimeout(resolve, 500);
      }
    };

    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData);

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    proc.on('exit', (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`Wrangler exited with code ${code}.\nOutput: ${output}`));
      }
    });
  });
}

function killProcessGroup(p: ChildProcess, signal: NodeJS.Signals) {
  // Kill the entire process group (negative PID) so workerd grandchildren die too.
  // Falls back to killing just the process if process.kill fails (e.g. already dead).
  if (p.pid) {
    try {
      process.kill(-p.pid, signal);
      return;
    } catch {
      // process group already gone
    }
  }
  try {
    p.kill(signal);
  } catch {
    // already dead
  }
}

export async function teardown() {
  if (!proc) return;
  const p = proc;
  proc = null;

  await new Promise<void>((resolve) => {
    p.on('exit', () => resolve());
    killProcessGroup(p, 'SIGTERM');
    setTimeout(() => {
      killProcessGroup(p, 'SIGKILL');
      resolve();
    }, 3000);
  });
}
