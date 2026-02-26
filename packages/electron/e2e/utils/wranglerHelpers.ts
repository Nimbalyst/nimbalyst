/**
 * Wrangler dev lifecycle helpers for E2E tests.
 *
 * Starts a local collabv3 Cloudflare Worker with TEST_AUTH_BYPASS enabled,
 * allowing E2E tests to test full WebSocket sync without real authentication.
 *
 * Based on packages/collabv3/test/helpers.ts but adapted for Playwright E2E.
 */

import { spawn, execSync, type ChildProcess } from 'child_process';
import * as path from 'path';

const READY_TIMEOUT = 20_000;

let wranglerProcess: ChildProcess | null = null;
let activePort: number | null = null;

/**
 * Start wrangler dev --local on the given port.
 * Applies D1 migrations first, then starts the dev server.
 * Resolves when the server prints "Ready on" to stderr.
 */
export async function startWrangler(port: number): Promise<void> {
  if (wranglerProcess) return;

  // Resolve collabv3 package dir: e2e/utils -> e2e -> electron -> packages -> collabv3
  const collabDir = path.resolve(__dirname, '..', '..', '..', 'collabv3');

  // Apply D1 migrations before starting the dev server
  execSync('npx wrangler d1 migrations apply nimbalyst-collabv3 --local', {
    cwd: collabDir,
    stdio: 'pipe',
  });

  return new Promise<void>((resolve, reject) => {
    const proc = spawn(
      'npx',
      ['wrangler', 'dev', '--local', '--port', String(port), '--inspector-port', '0'],
      {
        cwd: collabDir,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    wranglerProcess = proc;
    activePort = port;

    let output = '';
    const timeout = setTimeout(() => {
      proc.kill();
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

/**
 * Stop the wrangler dev process.
 */
export async function stopWrangler(): Promise<void> {
  if (!wranglerProcess) return;

  const proc = wranglerProcess;
  wranglerProcess = null;
  activePort = null;

  return new Promise<void>((resolve) => {
    proc.on('exit', () => resolve());
    proc.kill('SIGTERM');
    setTimeout(() => {
      proc.kill('SIGKILL');
      resolve();
    }, 3000);
  });
}

/**
 * Build a test auth bypass WebSocket URL for a TrackerRoom.
 * Uses test_user_id/test_org_id query params which are accepted when
 * TEST_AUTH_BYPASS=true and ENVIRONMENT=development in wrangler.toml.
 */
export function buildTrackerTestUrl(
  port: number,
  projectId: string,
  userId: string,
  orgId: string,
): string {
  const roomId = `org:${orgId}:tracker:${projectId}`;
  return `ws://localhost:${port}/sync/${roomId}?test_user_id=${userId}&test_org_id=${orgId}`;
}

/**
 * Get the active wrangler port (null if not running).
 */
export function getWranglerPort(): number | null {
  return activePort;
}
