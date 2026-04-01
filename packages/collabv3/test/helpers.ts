/**
 * Test helpers for collabv3 integration tests.
 *
 * Manages wrangler dev lifecycle and provides WebSocket utilities.
 */

import { spawn, type ChildProcess } from 'child_process';
import { webcrypto } from 'crypto';

const DEFAULT_PORT = 8791;
const READY_TIMEOUT = 15_000;

let wranglerProcess: ChildProcess | null = null;

/**
 * Start wrangler dev --local on the given port.
 * Resolves when the server prints "Ready on" to stderr.
 */
export async function startWrangler(port = DEFAULT_PORT): Promise<void> {
  if (wranglerProcess) return;

  return new Promise<void>((resolve, reject) => {
    const proc = spawn(
      'npx',
      ['wrangler', 'dev', '--local', '--port', String(port)],
      {
        cwd: new URL('..', import.meta.url).pathname,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, NO_COLOR: '1' },
      }
    );

    wranglerProcess = proc;

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
        // Give it a moment to finish initialization
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
function killProcessGroup(p: ChildProcess, signal: NodeJS.Signals) {
  if (p.pid) {
    try { process.kill(-p.pid, signal); return; } catch { /* already gone */ }
  }
  try { p.kill(signal); } catch { /* already dead */ }
}

export async function stopWrangler(): Promise<void> {
  if (!wranglerProcess) return;

  const proc = wranglerProcess;
  wranglerProcess = null;

  return new Promise<void>((resolve) => {
    proc.on('exit', () => resolve());
    killProcessGroup(proc, 'SIGTERM');
    // Force kill after 3s
    setTimeout(() => {
      killProcessGroup(proc, 'SIGKILL');
      resolve();
    }, 3000);
  });
}

/**
 * Open a WebSocket to a document room with test auth bypass.
 */
export function connectDocWS(
  port: number,
  documentId: string,
  userId: string,
  orgId: string
): WebSocket {
  const roomId = `org:${orgId}:doc:${documentId}`;
  const url = `ws://localhost:${port}/sync/${roomId}?test_user_id=${userId}&test_org_id=${orgId}`;
  return new WebSocket(url);
}

/**
 * Open a WebSocket to a tracker room with test auth bypass.
 */
export function connectTrackerWS(
  port: number,
  projectId: string,
  userId: string,
  orgId: string
): WebSocket {
  const roomId = `org:${orgId}:tracker:${projectId}`;
  const url = `ws://localhost:${port}/sync/${roomId}?test_user_id=${userId}&test_org_id=${orgId}`;
  return new WebSocket(url);
}

/**
 * Open a WebSocket to a team room with test auth bypass.
 */
export function connectTeamRoomWS(
  port: number,
  userId: string,
  orgId: string
): WebSocket {
  const roomId = `org:${orgId}:team`;
  const url = `ws://localhost:${port}/sync/${roomId}?test_user_id=${userId}&test_org_id=${orgId}`;
  return new WebSocket(url);
}

/**
 * Make an internal HTTP POST request to a TeamRoom DO endpoint via the sync path.
 * Uses the Worker's internal forwarding pattern.
 */
export async function teamRoomInternalPost(
  port: number,
  orgId: string,
  userId: string,
  internalPath: string,
  body: Record<string, unknown>
): Promise<Response> {
  const roomId = `org:${orgId}:team`;
  const url = `http://localhost:${port}/sync/${roomId}/internal/${internalPath}?test_user_id=${userId}&test_org_id=${orgId}`;
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * Wait for a WebSocket to open.
 */
export function waitForOpen(ws: WebSocket, timeout = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) {
      resolve();
      return;
    }
    const timer = setTimeout(() => reject(new Error('WebSocket open timeout')), timeout);
    ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    ws.addEventListener('error', (e) => { clearTimeout(timer); reject(e); }, { once: true });
  });
}

/**
 * Send a message and wait for a response of the expected type.
 */
export function sendAndWait<T extends { type: string }>(
  ws: WebSocket,
  message: Record<string, unknown>,
  expectedType: string,
  timeout = 5000
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timeout waiting for ${expectedType}`)),
      timeout
    );

    const handler = (event: MessageEvent) => {
      const data = JSON.parse(String(event.data));
      if (data.type === expectedType) {
        clearTimeout(timer);
        ws.removeEventListener('message', handler);
        resolve(data as T);
      }
    };

    ws.addEventListener('message', handler);
    ws.send(JSON.stringify(message));
  });
}

/**
 * Wait for a specific message type (without sending anything).
 */
export function waitForMessage<T extends { type: string }>(
  ws: WebSocket,
  expectedType: string,
  timeout = 5000
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timeout waiting for ${expectedType}`)),
      timeout
    );

    const handler = (event: MessageEvent) => {
      const data = JSON.parse(String(event.data));
      if (data.type === expectedType) {
        clearTimeout(timer);
        ws.removeEventListener('message', handler);
        resolve(data as T);
      }
    };

    ws.addEventListener('message', handler);
  });
}

/**
 * Close a WebSocket and wait for it to fully close.
 */
export function closeWS(ws: WebSocket, timeout = 3000): Promise<void> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, timeout);
    ws.addEventListener('close', () => { clearTimeout(timer); resolve(); }, { once: true });
    ws.close();
  });
}

/**
 * Make an authenticated HTTP request to the wrangler dev server with test auth bypass.
 */
export async function fetchWithTestAuth(
  port: number,
  path: string,
  userId: string,
  orgId: string,
  options: RequestInit = {}
): Promise<Response> {
  const separator = path.includes('?') ? '&' : '?';
  const url = `http://localhost:${port}${path}${separator}test_user_id=${userId}&test_org_id=${orgId}`;
  return fetch(url, options);
}

/**
 * Generate a test AES-256-GCM key for encryption.
 */
export async function generateTestKey(): Promise<CryptoKey> {
  return webcrypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  ) as Promise<CryptoKey>;
}

/**
 * Wait for a condition to become true, polling at `interval` ms.
 */
export async function waitFor(
  predicate: () => boolean,
  timeout = 5000,
  interval = 50
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error('waitFor timed out');
    }
    await new Promise(r => setTimeout(r, interval));
  }
}
