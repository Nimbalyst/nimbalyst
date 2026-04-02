import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionStateManager } from '../SessionStateManager';
import type { SessionStateEvent } from '../types/SessionState';

class FakeDatabaseWorker {
  public queries: Array<{ sql: string; params?: any[] }> = [];
  private workspaceIds = new Map<string, string>();

  setWorkspace(sessionId: string, workspaceId: string): void {
    this.workspaceIds.set(sessionId, workspaceId);
  }

  async query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[] }> {
    this.queries.push({ sql, params });

    if (sql.includes('SELECT workspace_id')) {
      const sessionId = params?.[0];
      const workspaceId = typeof sessionId === 'string' ? this.workspaceIds.get(sessionId) ?? null : null;
      return { rows: workspaceId ? [{ workspace_id: workspaceId } as T] : [] };
    }

    return { rows: [] };
  }
}

describe('SessionStateManager', () => {
  let manager: SessionStateManager;
  let database: FakeDatabaseWorker;

  beforeEach(() => {
    manager = new SessionStateManager();
    database = new FakeDatabaseWorker();
    manager.setDatabase(database);
  });

  it('emits session:completed when ending an active session', async () => {
    const listener = vi.fn<(event: SessionStateEvent) => void>();
    manager.subscribe(listener);

    await manager.startSession({
      sessionId: 'session-active',
      workspacePath: '/workspace/project',
    });

    listener.mockClear();

    await manager.endSession('session-active');

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      type: 'session:completed',
      sessionId: 'session-active',
      workspacePath: '/workspace/project',
    }));
  });

  it('emits session:completed for sessions missing from active state', async () => {
    const listener = vi.fn<(event: SessionStateEvent) => void>();
    manager.subscribe(listener);
    database.setWorkspace('session-missing', '/workspace/project');

    await manager.endSession('session-missing');

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      type: 'session:completed',
      sessionId: 'session-missing',
      workspacePath: '/workspace/project',
    }));
    expect(database.queries.some(({ sql }) => sql.includes('SELECT workspace_id'))).toBe(true);
    expect(database.queries.some(({ sql, params }) =>
      sql.includes('UPDATE ai_sessions SET status = $1') && params?.[0] === 'idle' && params?.[1] === 'session-missing'
    )).toBe(true);
  });
});
