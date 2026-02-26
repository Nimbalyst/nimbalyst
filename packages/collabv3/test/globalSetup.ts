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
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, NO_COLOR: '1' },
      }
    );

    let output = '';
    const timeout = setTimeout(() => {
      proc?.kill();
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

export async function teardown() {
  if (!proc) return;
  const p = proc;
  proc = null;

  await new Promise<void>((resolve) => {
    p.on('exit', () => resolve());
    p.kill('SIGTERM');
    setTimeout(() => {
      p.kill('SIGKILL');
      resolve();
    }, 3000);
  });
}
