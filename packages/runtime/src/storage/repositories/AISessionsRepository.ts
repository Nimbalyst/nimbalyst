import { getDB } from '../pglite';

export interface ChatMessage { role: 'user'|'assistant'; content: string; timestamp: number }

export const AISessionsRepository = {
  async create(id: string, provider: string, model: string): Promise<void> {
    const db = getDB();
    await db.query('INSERT INTO ai_sessions(id, provider, model, messages, updated_at) VALUES($1,$2,$3,$4,$5)', [
      id, provider, model, JSON.stringify([]), Date.now()
    ]);
  },
  async appendMessage(id: string, msg: ChatMessage): Promise<void> {
    const db = getDB();
    // Fetch existing messages (simple approach)
    const { rows } = await db.query<{ messages: any }>('SELECT messages FROM ai_sessions WHERE id=$1 LIMIT 1', [id]);
    const msgs: ChatMessage[] = rows[0]?.messages || [];
    msgs.push(msg);
    await db.query('UPDATE ai_sessions SET messages=$2, updated_at=$3 WHERE id=$1', [id, JSON.stringify(msgs), Date.now()]);
  },
  async get(id: string): Promise<{ provider: string; model: string; messages: ChatMessage[] } | null> {
    const db = getDB();
    const { rows } = await db.query<any>('SELECT provider, model, messages FROM ai_sessions WHERE id=$1 LIMIT 1', [id]);
    if (!rows[0]) return null;
    return { provider: rows[0].provider, model: rows[0].model, messages: rows[0].messages || [] };
  },
  async list(): Promise<{ id: string; provider: string; model: string; updatedAt: number }[]> {
    const db = getDB();
    const { rows } = await db.query<any>('SELECT id, provider, model, updated_at FROM ai_sessions ORDER BY updated_at DESC');
    return rows.map((r: any) => ({ id: r.id, provider: r.provider, model: r.model, updatedAt: r.updated_at }));
  }
};

