/**
 * KimiClaw Session Scanner
 *
 * Scans KCS for past swarm sessions that can be imported into Nimbalyst.
 * GET /api/v2/swarms with pagination.
 */

import fetch from 'node-fetch';

export interface KimiClawSwarmRecord {
  swarm_id: string;
  status: string;
  created_at: string;
  task: string;
  deliverable?: string;
  agents_total: number;
  agents_completed: number;
  agents_failed: number;
}

export interface KimiClawScanResult {
  swarms: KimiClawSwarmRecord[];
  total: number;
}

/**
 * Scan KCS for importable swarms.
 *
 * @param endpoint  KCS endpoint URL (e.g. 'http://127.0.0.1:9643')
 * @param auth      Auth config for KCS
 * @param limit     Max swarms to return
 * @param offset    Pagination offset
 */
export async function scanKimiClawSessions(
  endpoint: string,
  auth: { mode: 'cookie' | 'bearer'; username?: string; password?: string; bearerToken?: string },
  limit: number = 50,
  offset: number = 0,
): Promise<KimiClawScanResult> {
  try {
    let cookieHeader = '';

    // Cookie auth: login first to obtain session cookie
    if (auth.mode === 'cookie' && auth.username && auth.password) {
      const loginRes = await fetch(`${endpoint}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: auth.username, password: auth.password }),
      });
      if (loginRes.ok) {
        const setCookie = loginRes.headers.get('set-cookie');
        if (setCookie) {
          cookieHeader = setCookie.split(',').map((c: string) => c.split(';')[0].trim()).join('; ');
        }
      } else {
        console.error('[KIMICLAW-SCANNER] Login failed:', loginRes.status);
      }
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (auth.mode === 'bearer' && auth.bearerToken) {
      headers['Authorization'] = `Bearer ${auth.bearerToken}`;
    } else if (cookieHeader) {
      headers['Cookie'] = cookieHeader;
    }

    const url = `${endpoint}/api/v2/swarms?limit=${limit}&offset=${offset}`;
    const r = await fetch(url, { headers });
    if (!r.ok) {
      console.error('[KIMICLAW-SCANNER] HTTP error:', r.status, await r.text());
      return { swarms: [], total: 0 };
    }
    const body = (await r.json()) as Record<string, unknown>;
    const swarms = Array.isArray(body.swarms) ? (body.swarms as KimiClawSwarmRecord[]) : [];
    const total = typeof body.total === 'number' ? body.total : swarms.length;
    return { swarms, total };
  } catch (error) {
    console.error('[KIMICLAW-SCANNER] Failed to scan sessions:', error);
    return { swarms: [], total: 0 };
  }
}
