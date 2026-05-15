/**
 * KimiClaw Protocol
 *
 * HTTP+SSE transport for KimiClawSwarm (KCS) — local FastAPI server at 127.0.0.1:9643.
 * Uses node-fetch + tough-cookie (not Electron net.request).
 */

import {
  AgentProtocol,
  ProtocolSession,
  SessionOptions,
  ProtocolMessage,
  ProtocolEvent,
} from './ProtocolInterface';
import fetch from 'node-fetch';
import { CookieJar } from 'tough-cookie';

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
  mcpServers?: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>;
}

// ---------------------------------------------------------------------------
// Transport interface
// ---------------------------------------------------------------------------

export interface KimiClawTransport {
  open(options: SessionOptions): Promise<void>;
  close(): Promise<void>;
  dispatchSwarm(task: string, swarmOpts: KimiClawSwarmOptions): Promise<{ swarmId: string }>;
  streamEvents(swarmId: string, signal: AbortSignal, afterSeq?: number): AsyncIterable<RawKimiClawEvent>;
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

// Static imports only — dynamic imports in the Electron main process cause
// `__ELECTRON_LOG__` double-registration crashes (per CLAUDE.md).

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
      this.cookieJar = new CookieJar();
      await this.login();
    }
  }

  async close(): Promise<void> {
    this.cookieJar = null;
    this.loggedIn = false;
  }

  private async login(): Promise<void> {
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

  async *streamEvents(swarmId: string, signal: AbortSignal, afterSeq?: number): AsyncIterable<RawKimiClawEvent> {
    const headers = await this.buildHeaders();
    const url = afterSeq
      ? `${this.endpoint}/api/v2/swarm/${swarmId}/events?after_seq=${afterSeq}`
      : `${this.endpoint}/api/v2/swarm/${swarmId}/events`;
    const r = await fetch(url, { headers, signal });
    if (!r.ok) throw new KimiClawError(`events failed: ${r.status}`);
    if (!r.body) return;

    const decoder = new TextDecoder();
    let buf = '';
    const body = r.body as any;

    // Helper: yield chunks from the response body, handling both node-fetch v2
    // (Node.js Readable stream) and v3+ / native fetch (WHATWG ReadableStream).
    async function* readChunks(): AsyncIterable<Uint8Array> {
      if (typeof body.getReader === 'function') {
        // WHATWG ReadableStream path
        const reader = body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            yield value;
          }
        } finally {
          reader.releaseLock?.();
        }
      } else if (typeof body[Symbol.asyncIterator] === 'function') {
        // Node.js Readable async-iterable path (node-fetch v2)
        for await (const chunk of body) {
          yield chunk;
        }
      } else if (typeof body.on === 'function') {
        // Fallback for older Node.js streams without async iterator
        const stream = body as import('node:stream').Readable;
        const chunks: Uint8Array[] = [];
        let ended = false;
        let streamError: Error | null = null;
        let notify: (() => void) | null = null;

        stream.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
          if (notify) { notify(); notify = null; }
        });
        stream.on('end', () => { ended = true; if (notify) { notify(); notify = null; } });
        stream.on('error', (err: Error) => { streamError = err; if (notify) { notify(); notify = null; } });

        try {
          while (!ended || chunks.length > 0) {
            if (chunks.length > 0) {
              yield chunks.shift()!;
            } else if (streamError) {
              throw streamError;
            } else {
              await new Promise<void>(resolve => { notify = resolve; });
            }
          }
        } finally {
          stream.destroy();
        }
      }
    }

    for await (const chunk of readChunks()) {
      if (signal.aborted) break;

      buf += decoder.decode(chunk, { stream: true });
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
  }

  async cancelSwarm(swarmId: string, reason: string): Promise<void> {
    const headers = await this.buildHeaders();
    const r = await fetch(`${this.endpoint}/api/v2/swarm/${swarmId}/cancel`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    if (!r.ok) throw new KimiClawError(`cancel failed: ${r.status}`);
  }

  async getSnapshot(swarmId: string): Promise<Record<string, unknown>> {
    const headers = await this.buildHeaders();
    const r = await fetch(`${this.endpoint}/api/v2/swarm/${swarmId}`, { headers });
    if (!r.ok) throw new KimiClawError(`snapshot failed: ${r.status}`);
    return r.json() as Promise<Record<string, unknown>>;
  }

  async getAgents(swarmId: string): Promise<Record<string, unknown>> {
    const headers = await this.buildHeaders();
    const r = await fetch(`${this.endpoint}/api/v2/swarm/${swarmId}/agents`, { headers });
    if (!r.ok) throw new KimiClawError(`agents failed: ${r.status}`);
    return r.json() as Promise<Record<string, unknown>>;
  }

  async getArtifact(swarmId: string, name: string): Promise<Buffer> {
    const headers = await this.buildHeaders();
    const r = await fetch(`${this.endpoint}/api/v2/swarm/${swarmId}/artifact/${name}`, { headers });
    if (!r.ok) throw new KimiClawError(`artifact failed: ${r.status}`);
    const buf = await r.buffer();
    return buf;
  }

  async healthCheck(): Promise<boolean> {
    try {
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

/**
 * Extract human-readable text from a KCS result object.
 * Prefers `merged_output`, `content`, `text`, then `message` fields.
 * Rejects Python repr strings (e.g. SwarmResult(...)).
 * Returns null if nothing useful is found.
 */
function extractResultText(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    // Reject Python repr strings like SwarmResult(task_id='...', merged_output='')
    if (/^(SwarmResult|dict|list|tuple|set|ObjectId)\s*\(/.test(trimmed)) {
      return null;
    }
    return trimmed;
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    // Prefer merged_output (swarm consolidated text)
    if (typeof obj.merged_output === 'string') {
      const mo = obj.merged_output.trim();
      if (mo) return mo;
      // merged_output is explicitly empty — this agent produced no text.
      // Don't fall back to other fields; the object has no real content.
      return null;
    }
    // Fallback to common text fields
    for (const key of ['content', 'text', 'message', 'output']) {
      if (typeof obj[key] === 'string' && (obj[key] as string).trim()) {
        return (obj[key] as string).trim();
      }
    }
    // If outputs map exists with string values, concatenate them
    if (obj.outputs && typeof obj.outputs === 'object') {
      const outs = Object.values(obj.outputs as Record<string, unknown>)
        .filter((v): v is string => typeof v === 'string' && !!v.trim())
        .join('\n');
      if (outs) return outs;
    }
  }
  return null;
}

/**
 * Returns true for strings that shouldn't be shown as assistant text.
 * Covers single-word status, "Agent X completed execution", and
 * generic completion phrases.
 */
function isNoiseText(text: string): boolean {
  const t = text.trim();
  // Single-word status strings
  if (/^(completed|done|finished|executed|started|running|ok|success)$/i.test(t) && t.length < 40) {
    return true;
  }
  // "Agent 1 completed execution" and variants
  if (/Agent\s+\S+\s+completed\s+execution/i.test(t)) {
    return true;
  }
  // Generic "completed execution" without agent name
  if (/^completed\s+execution/i.test(t)) {
    return true;
  }
  return false;
}

function parseSwarmEvent(raw: RawKimiClawEvent): ProtocolEvent[] {
  const events: ProtocolEvent[] = [];
  // KCS wraps event fields in a nested `payload` object, but some legacy
  // endpoints may flatten them — normalise both shapes.
  const d = (raw.data.payload as Record<string, unknown>) || raw.data;

  switch (raw.type) {
    case 'swarm.created': {
      const cfg = d.config as Record<string, unknown> | undefined;
      const maxAgents = cfg?.max_agents ?? cfg?.maxAgents ?? '?';
      const maxSteps = cfg?.max_steps ?? cfg?.maxSteps ?? '?';
      events.push({
        type: 'text',
        content: `Swarm ${(d.swarm_id as string)?.slice(0, 12)} created — max ${maxAgents} agents, ${maxSteps} steps`,
        metadata: { kind: 'orchestrator_status' },
      });
      break;
    }

    case 'agent.started': {
      const name1 = (d.name as string | undefined)?.replace(/^Agent\s+/i, '') || (d.agent_id as string)?.slice(0, 8);
      events.push({
        type: 'text',
        content: `[Agent ${name1}] Starting...`,
        metadata: { kind: 'agent_status' },
      });
      break;
    }

    case 'agent.phase_changed': {
      const name2 = (d.name as string | undefined)?.replace(/^Agent\s+/i, '') || (d.agent_id as string)?.slice(0, 8);
      events.push({
        type: 'text',
        content: `[Agent ${name2}] ${d.to_phase || d.phase}...`,
        metadata: { kind: 'agent_status' },
      });
      break;
    }

    case 'agent.activity_changed':
      events.push({
        type: 'text',
        content: `[Agent ${(d.agent_id as string)?.slice(0, 8)}] ${d.activity}`,
        metadata: { kind: 'agent_status' },
      });
      break;

    case 'agent.completed': {
      const text = extractResultText(d.output);
      if (text && !isNoiseText(text)) {
        events.push({
          type: 'text',
          content: text,
          metadata: { kind: 'agent_output', agentId: d.agent_id },
        });
      }
      break;
    }

    case 'agent.failed':
      events.push({
        type: 'text',
        content: `Agent ${(d.agent_id as string)?.slice(0, 8)} failed: ${d.error}`,
        metadata: { kind: 'agent_error' },
      });
      break;

    case 'wave.started':
      events.push({
        type: 'text',
        content: `Wave ${d.wave_number || d.wave} started`,
        metadata: { kind: 'wave_status' },
      });
      break;

    case 'wave.completed':
      events.push({
        type: 'text',
        content: `Wave ${d.wave_number || d.wave} completed`,
        metadata: { kind: 'wave_status' },
      });
      break;

    case 'orchestrator.plan_summary': {
      const tasks = d.tasks as string[] | undefined;
      const agentCount = d.agent_count as number | undefined;
      if (tasks && Array.isArray(tasks) && tasks.length > 0) {
        const header = agentCount !== undefined ? `Plan (${agentCount} agents):` : 'Plan:';
        const body = tasks.map((t) => `• ${t}`).join('\n');
        events.push({
          type: 'text',
          content: `${header}\n${body}`,
          metadata: { kind: 'plan_summary' },
        });
      } else {
        const summaryText = extractResultText(d.summary);
        if (summaryText) {
          events.push({
            type: 'text',
            content: summaryText,
            metadata: { kind: 'plan_summary' },
          });
        }
      }
      break;
    }

    case 'orchestrator.deliverable': {
      // KCS deliverables are file artifacts, not inline text
      const fileName = d.file_name as string | undefined;
      const fileSize = d.file_size as number | undefined;
      if (fileName) {
        const sizeStr = typeof fileSize === 'number' ? ` (${fileSize} bytes)` : '';
        events.push({
          type: 'text',
          content: `📎 Artifact: ${fileName}${sizeStr}`,
          metadata: { kind: 'deliverable', fileName, fileSize, downloadUrl: d.download_url },
        });
      }
      break;
    }

    case 'budget.update': {
      const consumed = d.steps_consumed ?? d.consumed ?? '?';
      const total = d.steps_total ?? d.total ?? '?';
      const running = d.agents_running ?? '?';
      const completed = d.agents_completed ?? '?';
      events.push({
        type: 'text',
        content: `Steps: ${consumed}/${total} · Agents: ${running} running, ${completed} done`,
        metadata: { kind: 'budget' },
      });
      break;
    }

    case 'budget.exhausted': {
      const waveReached = d.wave_reached;
      const reason = d.reason;
      let msg = 'Budget exhausted';
      if (typeof waveReached === 'number') msg += ` at wave ${waveReached}`;
      else if (typeof reason === 'string') msg += `: ${reason}`;
      events.push({
        type: 'text',
        content: msg,
        metadata: { kind: 'budget_error' },
      });
      break;
    }

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

  async healthCheck(): Promise<boolean> {
    return this.transport.healthCheck();
  }

  async getSnapshot(swarmId: string): Promise<Record<string, unknown>> {
    return this.transport.getSnapshot(swarmId);
  }

  /**
   * Stub — filled in Slice 3 with SSE parser + canonical event mapping.
   */
  async *sendMessage(
    session: ProtocolSession,
    message: ProtocolMessage,
  ): AsyncIterable<ProtocolEvent> {
    // session.raw = { options: SessionOptions } where SessionOptions.raw holds KimiClawSessionData
    const nimbalystOpts = session.raw?.options as (SessionOptions & { raw?: KimiClawSessionData }) | undefined;
    const sessionData = nimbalystOpts?.raw;
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

    // Resume path: if session was resumed, stream existing swarm instead of dispatching new one
    const resumedSwarmId = (session.raw as Record<string, unknown> | undefined)?.resumedFrom as string | undefined;
    let swarmId: string;
    if (resumedSwarmId) {
      swarmId = resumedSwarmId;
      yield { type: 'text', content: `Reattached to swarm ${swarmId}`, metadata: { providerSessionId: swarmId, reattached: true } };
    } else {
      console.log(`[KIMICLAW PROTOCOL] Dispatching swarm with task length ${taskWithContext.length}, opts:`, JSON.stringify(swarmOpts));
      const result = await this.transport.dispatchSwarm(taskWithContext, swarmOpts);
      swarmId = result.swarmId;
      console.log(`[KIMICLAW PROTOCOL] Swarm dispatched: ${swarmId}`);
      yield { type: 'text', content: `Swarm ${swarmId} dispatched`, metadata: { providerSessionId: swarmId } };
    }

    // Cancel UX gate
    let cancelled = false;

    const ac = new AbortController();
    try {
      console.log(`[KIMICLAW PROTOCOL] Starting SSE stream for swarm ${swarmId}`);
      let eventCount = 0;
      let deliverableReceived = false;
      for await (const raw of this.transport.streamEvents(swarmId, ac.signal)) {
        eventCount++;
        if (eventCount === 1) {
          console.log(`[KIMICLAW PROTOCOL] First SSE event received: ${raw.type}`);
        }
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
          if (ev.type === 'text' && ev.metadata?.kind === 'deliverable') {
            deliverableReceived = true;
          }
          yield ev;
        }
        // Always emit raw_event for transcript / downstream debugging
        yield { type: 'raw_event', metadata: { rawEvent: raw } };
      }

      console.log(`[KIMICLAW PROTOCOL] SSE stream ended, ${eventCount} events received`);

      // Post-stream deliverable: only use snapshot if no deliverable was
      // already streamed (avoids duplicate JSON noise).
      if (!deliverableReceived) {
        try {
          const snap = await this.transport.getSnapshot(swarmId);
          const fallback = snap.deliverable || snap.result;
          const text = extractResultText(fallback);
          if (text) {
            yield { type: 'text', content: text, metadata: { final: true } };
            this.sessionDeliverables.set(session.id, text);
          }
        } catch {
          // snapshot unavailable
        }
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
