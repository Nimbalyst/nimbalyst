import { describe, expect, it, vi } from 'vitest';
import { createPGLiteQueuedPromptsStore } from '../PGLiteQueuedPromptsStore';

type DbStub = { query: <T = any>(sql: string, params?: any[]) => Promise<{ rows: T[] }> };

describe('PGLiteQueuedPromptsStore.rollbackExecuting', () => {
  it('resets executing rows for the given session back to pending', async () => {
    const query = vi.fn(async (sql: string, params?: any[]) => {
      expect(sql).toContain("SET status = 'pending'");
      expect(sql).toContain('claimed_at = NULL');
      expect(sql).toContain("status = 'executing'");
      expect(sql).toContain('WHERE session_id = $1');
      expect(params).toEqual(['session-abc']);
      return { rows: [{ id: 'prompt-1' }, { id: 'prompt-2' }] };
    });
    const db: DbStub = { query: query as any };

    const store = createPGLiteQueuedPromptsStore(db);
    const rolledBack = await store.rollbackExecuting('session-abc');

    expect(rolledBack).toBe(2);
    expect(query).toHaveBeenCalledOnce();
  });

  it('returns 0 when no rows are stuck in executing', async () => {
    const db: DbStub = { query: (async () => ({ rows: [] })) as any };

    const store = createPGLiteQueuedPromptsStore(db);
    const rolledBack = await store.rollbackExecuting('session-no-rows');

    expect(rolledBack).toBe(0);
  });

  it('is scoped to the given session id only', async () => {
    let capturedParams: any[] | undefined;
    const db: DbStub = {
      query: (async (_sql: string, params?: any[]) => {
        capturedParams = params;
        return { rows: [] };
      }) as any,
    };

    const store = createPGLiteQueuedPromptsStore(db);
    await store.rollbackExecuting('session-only-this-one');

    expect(capturedParams).toEqual(['session-only-this-one']);
  });
});

describe('PGLiteQueuedPromptsStore.rollbackAllExecuting', () => {
  it('resets every executing row across all sessions', async () => {
    const query = vi.fn(async (sql: string, params?: any[]) => {
      expect(sql).toContain("SET status = 'pending'");
      expect(sql).toContain('claimed_at = NULL');
      expect(sql).toContain("status = 'executing'");
      expect(sql).not.toContain('session_id');
      expect(params).toBeUndefined();
      return { rows: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] };
    });
    const db: DbStub = { query: query as any };

    const store = createPGLiteQueuedPromptsStore(db);
    const rolledBack = await store.rollbackAllExecuting();

    expect(rolledBack).toBe(3);
  });

  it('is idempotent when the table has no stuck rows', async () => {
    const db: DbStub = { query: (async () => ({ rows: [] })) as any };

    const store = createPGLiteQueuedPromptsStore(db);
    expect(await store.rollbackAllExecuting()).toBe(0);
    expect(await store.rollbackAllExecuting()).toBe(0);
  });
});

describe('PGLiteQueuedPromptsStore.sweepExecutingOnBoot', () => {
  it('marks delivered executing rows completed, rolls back undelivered ones', async () => {
    const calls: { sql: string; params?: any[] }[] = [];
    const db: DbStub = {
      query: (async (sql: string, params?: any[]) => {
        calls.push({ sql, params });
        // Pass 1: completed-update returns rows that were delivered
        if (sql.includes("SET status = 'completed'")) {
          return { rows: [{ id: 'delivered-1' }, { id: 'delivered-2' }] };
        }
        // Pass 2: rollback-update returns the remaining stuck rows
        if (sql.includes("SET status = 'pending'") && sql.includes('claimed_at = NULL')) {
          return { rows: [{ id: 'undelivered-1' }] };
        }
        throw new Error(`Unexpected query: ${sql}`);
      }) as any,
    };

    const store = createPGLiteQueuedPromptsStore(db);
    const result = await store.sweepExecutingOnBoot();

    expect(result).toEqual({ completed: 2, rolledBack: 1 });
    expect(calls).toHaveLength(2);

    // First pass: covers both executing-with-delivered-claim AND
    // pending-with-content-match (leftover corruption from old boot sweeps).
    expect(calls[0].sql).toContain("SET status = 'completed'");
    expect(calls[0].sql).toContain("status = 'executing'");
    expect(calls[0].sql).toContain("status = 'pending'");
    expect(calls[0].sql).toContain('claimed_at IS NOT NULL');
    expect(calls[0].sql).toContain('ai_agent_messages');
    expect(calls[0].sql).toContain("direction = 'input'");
    expect(calls[0].sql).toContain('m.created_at >= queued_prompts.claimed_at');
    expect(calls[0].sql).toContain('m.created_at >= queued_prompts.created_at');
    expect(calls[0].sql).toContain('POSITION(queued_prompts.prompt IN m.content)');

    // Second pass: rolls back anything still executing (i.e. undelivered)
    expect(calls[1].sql).toContain("SET status = 'pending'");
    expect(calls[1].sql).toContain('claimed_at = NULL');
    expect(calls[1].sql).toContain("status = 'executing'");
  });

  it('returns zeros when nothing was executing', async () => {
    const db: DbStub = { query: (async () => ({ rows: [] })) as any };

    const store = createPGLiteQueuedPromptsStore(db);
    expect(await store.sweepExecutingOnBoot()).toEqual({ completed: 0, rolledBack: 0 });
  });

  it('completes pending rows that match a delivered input message (leftover-corruption cleanup)', async () => {
    // Simulates the leftover state after a pre-fix build's
    // rollbackAllExecuting boot sweep set already-delivered rows back to
    // pending. The new sweep should catch them by matching prompt text
    // against ai_agent_messages content.
    let completedSql = '';
    const db: DbStub = {
      query: (async (sql: string) => {
        if (sql.includes("SET status = 'completed'")) {
          completedSql = sql;
          return { rows: [{ id: 'leftover-1' }, { id: 'leftover-2' }, { id: 'leftover-3' }] };
        }
        if (sql.includes("SET status = 'pending'")) {
          return { rows: [] };
        }
        throw new Error(`Unexpected query: ${sql}`);
      }) as any,
    };

    const store = createPGLiteQueuedPromptsStore(db);
    const result = await store.sweepExecutingOnBoot();

    expect(result).toEqual({ completed: 3, rolledBack: 0 });
    // The combined query must contain both branches so an existing
    // pending row whose prompt text already appears in the conversation
    // gets cleaned up alongside the executing-but-delivered case.
    expect(completedSql).toContain("status = 'pending'");
    expect(completedSql).toContain('POSITION(queued_prompts.prompt IN m.content)');
  });

  it('completes pending rows older than 24h regardless of content match (abandoned cleanup)', async () => {
    let completedSql = '';
    const db: DbStub = {
      query: (async (sql: string) => {
        if (sql.includes("SET status = 'completed'")) {
          completedSql = sql;
          return { rows: [{ id: 'abandoned-1' }, { id: 'abandoned-2' }] };
        }
        if (sql.includes("SET status = 'pending'")) {
          return { rows: [] };
        }
        throw new Error(`Unexpected query: ${sql}`);
      }) as any,
    };

    const store = createPGLiteQueuedPromptsStore(db);
    const result = await store.sweepExecutingOnBoot();

    expect(result).toEqual({ completed: 2, rolledBack: 0 });
    // Age branch: pending rows older than 24h are completed
    // unconditionally. Handles content-match false negatives caused by
    // JSON escaping (newlines / quotes / attachments) and genuinely
    // abandoned prompts.
    expect(completedSql).toContain("status = 'pending'");
    expect(completedSql).toContain("created_at < NOW() - INTERVAL '1 day'");
  });
});

describe('PGLiteQueuedPromptsStore.sweepExecutingForSession', () => {
  it('scopes both passes to the given session id', async () => {
    const calls: { sql: string; params?: any[] }[] = [];
    const db: DbStub = {
      query: (async (sql: string, params?: any[]) => {
        calls.push({ sql, params });
        if (sql.includes("SET status = 'completed'")) {
          return { rows: [{ id: 'delivered-1' }] };
        }
        if (sql.includes("SET status = 'pending'")) {
          return { rows: [{ id: 'undelivered-1' }, { id: 'undelivered-2' }] };
        }
        throw new Error(`Unexpected query: ${sql}`);
      }) as any,
    };

    const store = createPGLiteQueuedPromptsStore(db);
    const result = await store.sweepExecutingForSession('session-xyz');

    expect(result).toEqual({ completed: 1, rolledBack: 2 });
    expect(calls).toHaveLength(2);

    // Pass 1: delivery check filters by session_id and matches input messages
    expect(calls[0].sql).toContain("SET status = 'completed'");
    expect(calls[0].sql).toContain("session_id = $1");
    expect(calls[0].sql).toContain('claimed_at IS NOT NULL');
    expect(calls[0].sql).toContain('ai_agent_messages');
    expect(calls[0].sql).toContain("direction = 'input'");
    expect(calls[0].sql).toContain('m.created_at >= queued_prompts.claimed_at');
    expect(calls[0].params).toEqual(['session-xyz']);

    // Pass 2: roll back undelivered executing rows for the same session
    expect(calls[1].sql).toContain("SET status = 'pending'");
    expect(calls[1].sql).toContain('claimed_at = NULL');
    expect(calls[1].sql).toContain("status = 'executing'");
    expect(calls[1].sql).toContain('session_id = $1');
    expect(calls[1].params).toEqual(['session-xyz']);
  });

  it('returns zeros when the session has no executing rows', async () => {
    const db: DbStub = { query: (async () => ({ rows: [] })) as any };

    const store = createPGLiteQueuedPromptsStore(db);
    expect(await store.sweepExecutingForSession('session-clean')).toEqual({
      completed: 0,
      rolledBack: 0,
    });
  });
});
