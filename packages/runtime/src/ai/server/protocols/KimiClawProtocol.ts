/**
 * KimiClaw Protocol
 *
 * HTTP+SSE transport for KimiClawSwarm (KCS) — local Flask server at 127.0.0.1:9643.
 * Uses node-fetch + tough-cookie (not Electron net.request).
 */

import {
  AgentProtocol,
  ProtocolSession,
  SessionOptions,
  ProtocolMessage,
  ProtocolEvent,
} from './ProtocolInterface';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface KimiClawSwarmOptions {
  persona_mode?: boolean;
  max_agents?: number;
  max_steps?: number;
  max_parallel?: number;
  mcp_servers?: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>;
}

export interface KimiClawSessionData {
  endpoint: string;
  authMode: 'cookie' | 'bearer';
  username?: string;
  password?: string;
  bearerToken?: string;
  swarmDefaults: KimiClawSwarmOptions;
}

// ---------------------------------------------------------------------------
// Transport interface
// ---------------------------------------------------------------------------

export interface KimiClawTransport {
  open(options: SessionOptions): Promise<void>;
  close(): Promise<void>;
  dispatchSwarm(task: string, swarmOpts: KimiClawSwarmOptions): Promise<{ swarmId: string }>;
  streamEvents(swarmId: string, signal: AbortSignal): AsyncIterable<RawKimiClawEvent>;
  cancelSwarm(swarmId: string, reason: string): Promise<void>;
  getSnapshot(swarmId: string): Promise<Record<string, unknown>>;
  getAgents(swarmId: string): Promise<Record<string, unknown>>;
  getArtifact(swarmId: string, name: string): Promise<Buffer>;
  healthCheck(): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Raw event types
// ---------------------------------------------------------------------------

export interface RawKimiClawEvent {
  type: string;
  data: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// HTTP transport implementation (node-fetch + tough-cookie)
// ---------------------------------------------------------------------------

// Lazy-load node-fetch and tough-cookie so the runtime doesn't crash
// if they're missing (they're devDependencies in the runtime package).
let _fetch: typeof import('node-fetch').default | null = null;
let _CookieJar: typeof import('tough-cookie').CookieJar | null = null;

async function getFetch() {
  if (!_fetch) {
    const nf = await import('node-fetch');
    _fetch = nf.default as any;
  }
  return _fetch!;
}

async function getCookieJar() {
  if (!_CookieJar) {
    const tc = await import('tough-cookie');
    _CookieJar = tc.CookieJar;
  }
  return _CookieJar!;
}

export class KimiClawHttpTransport implements KimiClawTransport {
  private cookieJar: import('tough-cookie').CookieJar | null = null;
  private loggedIn: boolean = false;

  constructor(
    private endpoint: string,
    private auth: {
      mode: 'cookie' | 'bearer';
      username?: string;
      password?: string;
      bearerToken?: string;
    },
  ) {}

  async open(_options: SessionOptions): Promise<void> {
    if (this.auth.mode === 'cookie') {
      const CookieJar = await getCookieJar();
      this.cookieJar = new CookieJar();
      await this.login();
    }
  }

  async close(): Promise<void> {
    this.cookieJar = null;
    this.loggedIn = false;
  }

  private async login(): Promise<void> {
    const fetch = await getFetch();
    const r = await fetch(`${this.endpoint}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: this.auth.username || 'admin',
        password: this.auth.password || 'admin',
      }),
    });
    if (!r.ok) throw new KimiClawError(`login failed: ${r.status} ${await r.text()}`);
    const setCookie = r.headers.get('set-cookie');
    if (setCookie && this.cookieJar) {
      await this.cookieJar.setCookie(setCookie, this.endpoint);
    }
    this.loggedIn = true;
  }

  async dispatchSwarm(task: string, swarmOpts: KimiClawSwarmOptions): Promise<{ swarmId: string }> {
    const fetch = await getFetch();
    const headers = await this.buildHeaders();
    const r = await fetch(`${this.endpoint}/api/v2/swarm`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ task, options: swarmOpts }),
    });
    if (!r.ok) throw new KimiClawError(`dispatch failed: ${r.status} ${await r.text()}`);
    const body = await r.json() as Record<string, unknown>;
    return { swarmId: body.swarm_id as string };
  }

  async *streamEvents(swarmId: string, signal: AbortSignal): AsyncIterable<RawKimiClawEvent> {
    const fetch = await getFetch();
    const headers = await this.buildHeaders();
    const r = await fetch(`${this.endpoint}/api/v2/swarm/${swarmId}/events`, { signal });
    if (!r.ok) throw new KimiClawError(`events failed: ${r.status}`);
    if (!r.body) return;

    const reader = (r.body as any).getReader();
    const decoder = new TextDecoder();
    let buf = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (signal.aborted) break;

        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          if (frame.startsWith(':')) continue; // keepalive

          const lines = frame.split('\n');
          const evType = lines.find(l => l.startsWith('event: '))?.slice(7);
          const dataLine = lines.find(l => l.startsWith('data: '))?.slice(6);
          if (!evType || !dataLine) continue;

          try {
            yield { type: evType, data: JSON.parse(dataLine) };
          } catch {
            // skip malformed
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async cancelSwarm(swarmId: string, reason: string): Promise<void> {
    const fetch = await getFetch();
    const headers = await this.buildHeaders();
    const r = await fetch(`${this.endpoint}/api/v2/swarm/${swarmId}/cancel`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    if (!r.ok) throw new KimiClawError(`cancel failed: ${r.status}`);
  }

  async getSnapshot(swarmId: string): Promise<Record<string, unknown>> {
    const fetch = await getFetch();
    const headers = await this.buildHeaders();
    const r = await fetch(`${this.endpoint}/api/v2/swarm/${swarmId}`, { headers });
    if (!r.ok) throw new KimiClawError(`snapshot failed: ${r.status}`);
    return r.json() as Promise<Record<string, unknown>>;
  }

  async getAgents(swarmId: string): Promise<Record<string, unknown>> {
    const fetch = await getFetch();
    const headers = await this.buildHeaders();
    const r = await fetch(`${this.endpoint}/api/v2/swarm/${swarmId}/agents`, { headers });
    if (!r.ok) throw new KimiClawError(`agents failed: ${r.status}`);
    return r.json() as Promise<Record<string, unknown>>;
  }

  async getArtifact(swarmId: string, name: string): Promise<Buffer> {
    const fetch = await getFetch();
    const headers = await this.buildHeaders();
    const r = await fetch(`${this.endpoint}/api/v2/swarm/${swarmId}/artifact/${name}`, { headers });
    if (!r.ok) throw new KimiClawError(`artifact failed: ${r.status}`);
    const buf = await r.buffer();
    return buf;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const fetch = await getFetch();
      const r = await fetch(`${this.endpoint}/api/auth-check`);
      return r.status === 200 || r.status === 401; // 401 means engine alive, not authenticated
    } catch {
      return false;
    }
  }

  private async buildHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {};
    if (this.auth.mode === 'bearer' && this.auth.bearerToken) {
      headers['Authorization'] = `Bearer ${this.auth.bearerToken}`;
    } else if (this.auth.mode === 'cookie' && this.cookieJar) {
      const cookies = await this.cookieJar.getCookieString(this.endpoint);
      if (cookies) headers['Cookie'] = cookies;
    }
    return headers;
  }
}

// ---------------------------------------------------------------------------
// SSE event -> canonical ProtocolEvent helper
// ---------------------------------------------------------------------------

function parseSwarmEvent(raw: RawKimiClawEvent): ProtocolEvent[] {
  const events: ProtocolEvent[] = [];
  const d = raw.data;

  switch (raw.type) {
    case 'agent.started':
      events.push({
        type: 'text',
        content: `[Agent ${d.name || (d.agent_id as string)?.slice(0, 8)}] Starting...`,
        metadata: { kind: 'agent_status' },
      });
      break;

    case 'agent.phase_changed':
      events.push({
        type: 'text',
        content: `[Agent ${d.name || (d.agent_id as string)?.slice(0, 8)}] ${d.phase}...`,
        metadata: { kind: 'agent_status' },
      });
      break;

    case 'agent.activity_changed':
      events.push({
        type: 'text',
        content: `[Agent ${(d.agent_id as string)?.slice(0, 8)}] ${d.activity}`,
        metadata: { kind: 'agent_status' },
      });
      break;

    case 'agent.completed': {
      const output = typeof d.output === 'string' ? d.output : JSON.stringify(d.output);
      const synthetic = d.synthetic_output_used === true;
      events.push({
        type: 'text',
        content: output + (synthetic ? '\n\n**[SYNTH -- tier 5 fallback]**' : ''),
        metadata: { kind: 'agent_output', agentId: d.agent_id },
      });
      break;
    }

    case 'agent.failed':
      events.push({
        type: 'text',
        content: `Agent ${(d.agent_id as string)?.slice(0, 8)} failed: ${d.error}`,
        metadata: { kind: 'agent_error' },
      });
      break;

    case 'agent.degraded':
      events.push({
        type: 'text',
        content: `Agent ${(d.agent_id as string)?.slice(0, 8)} degraded (tier ${d.tier}): ${d.reason}`,
        metadata: { kind: 'agent_status' },
      });
      break;

    case 'brain.tier':
      events.push({
        type: 'text',
        content: `Agent ${(d.agent_id as string)?.slice(0, 8)} using tier ${d.tier}`,
        metadata: { kind: 'agent_status' },
      });
      break;

    case 'wave.started':
      events.push({
        type: 'text',
        content: `Wave ${d.wave_number} started`,
        metadata: { kind: 'wave_status' },
      });
      break;

    case 'wave.completed':
      events.push({
        type: 'text',
        content: `Wave ${d.wave_number} completed`,
        metadata: { kind: 'wave_status' },
      });
      break;

    case 'orchestrator.plan_summary':
      events.push({
        type: 'text',
        content: typeof d.summary === 'string' ? d.summary : JSON.stringify(d.summary),
        metadata: { kind: 'plan_summary' },
      });
      break;

    case 'orchestrator.deliverable':
      events.push({
        type: 'text',
        content: typeof d.deliverable === 'string' ? d.deliverable : JSON.stringify(d.deliverable),
        metadata: { kind: 'deliverable' },
      });
      break;

    case 'budget.update':
      events.push({
        type: 'text',
        content: `Steps: ${d.consumed}/${d.total}`,
        metadata: { kind: 'budget' },
      });
      break;

    case 'budget.exhausted':
      events.push({
        type: 'text',
        content: `Budget exhausted: ${d.reason}`,
        metadata: { kind: 'budget_error' },
      });
      break;

    default:
      break;
  }

  return events;
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class KimiClawError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KimiClawError';
  }
}

// ---------------------------------------------------------------------------
// Protocol
// ---------------------------------------------------------------------------

export class KimiClawProtocol implements AgentProtocol {
  readonly platform = 'kimiclaw';
  private transport: KimiClawTransport;
  // Fix A: conversational continuity
  private sessionDeliverables = new Map<string, string>();

  constructor(transport?: KimiClawTransport) {
    this.transport = transport || new KimiClawHttpTransport('http://127.0.0.1:9643', { mode: 'cookie' });
  }

  async createSession(options: SessionOptions): Promise<ProtocolSession> {
    await this.transport.open(options);
    return { id: crypto.randomUUID(), platform: this.platform, raw: { options } };
  }

  async resumeSession(sessionId: string, options: SessionOptions): Promise<ProtocolSession> {
    await this.transport.open(options);
    return { id: crypto.randomUUID(), platform: this.platform, raw: { options, resumedFrom: sessionId } };
  }

  async forkSession(sessionId: string, options: SessionOptions): Promise<ProtocolSession> {
    return this.createSession(options);
  }

  /**
   * Stub — filled in Slice 3 with SSE parser + canonical event mapping.
   */
  async *sendMessage(
    session: ProtocolSession,
    message: ProtocolMessage,
  ): AsyncIterable<ProtocolEvent> {
    const sessionData = session.raw?.options as KimiClawSessionData | undefined;
    const swarmOpts: KimiClawSwarmOptions = sessionData?.swarmDefaults || {};

    // Fix A: conversational continuity — auto-stitch prior deliverable
    const priorDeliverable = this.sessionDeliverables.get(session.id);
    let taskWithContext = message.content;
    if (priorDeliverable) {
      taskWithContext = `[Prior context from previous swarm]:\n\n${priorDeliverable}\n\n---\n\nNew task: ${message.content}`;
      yield { type: 'text', content: '[Continuing from prior deliverable]', metadata: { kind: 'context_stitch' } };
    }

    // Fix D: MCP passthrough
    const mcpServers = sessionData?.mcpServers;
    if (mcpServers && Object.keys(mcpServers).length > 0) {
      swarmOpts.mcp_servers = mcpServers;
    }

    const { swarmId } = await this.transport.dispatchSwarm(taskWithContext, swarmOpts);
    yield { type: 'text', content: `Swarm ${swarmId} dispatched`, metadata: { providerSessionId: swarmId } };

    // Cancel UX gate
    let cancelled = false;

    const ac = new AbortController();
    try {
      for await (const raw of this.transport.streamEvents(swarmId, ac.signal)) {
        if (cancelled) continue;

        if (raw.type === 'coordinate.cancelled') {
          cancelled = true;
          yield { type: 'text', content: '[Swarm cancelled by user]', metadata: { kind: 'cancel' } };
          break;
        }

        if (raw.type === 'coordinate.completed' || raw.type === 'coordinate.error') {
          break;
        }

        // Slice 3: SSE event -> canonical ProtocolEvent mapping
        const evs = parseSwarmEvent(raw);
        for (const ev of evs) {
          yield ev;
        }
        // Always emit raw_event for transcript / downstream debugging
        yield { type: 'raw_event', metadata: { rawEvent: raw } };
      }

      // Post-stream deliverable
      try {
        const snap = await this.transport.getSnapshot(swarmId);
        const deliverable = snap.deliverable || snap.result;
        if (deliverable) {
          const text = typeof deliverable === 'string' ? deliverable : JSON.stringify(deliverable);
          yield { type: 'text', content: text, metadata: { final: true } };
          this.sessionDeliverables.set(session.id, text);
        }
      } catch {
        // snapshot unavailable
      }

      yield { type: 'complete', metadata: { swarmId } };
    } finally {
      ac.abort();
    }
  }

  abortSession(_session: ProtocolSession): void {
    // no-op — cancel handled by sendMessage AbortController
  }

  cleanupSession(_session: ProtocolSession): void {
    // no-op — HTTP-only, nothing to clean up
  }
}
