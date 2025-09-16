import { getDB } from '../pglite';
import type { DocumentRecord } from '../../core/types';

const now = () => Date.now();

export const DocumentsRepository = {
  async list(projectId: string): Promise<DocumentRecord[]> {
    const db = getDB();
    const { rows } = await db.query<DocumentRecord>(
      'SELECT id, project_id as "projectId", title, content, created_at as "createdAt", updated_at as "updatedAt" FROM documents WHERE project_id=$1 ORDER BY updated_at DESC',
      [projectId]
    );
    return rows;
  },

  async get(id: string): Promise<DocumentRecord | null> {
    const db = getDB();
    const { rows } = await db.query<DocumentRecord>(
      'SELECT id, project_id as "projectId", title, content, created_at as "createdAt", updated_at as "updatedAt" FROM documents WHERE id=$1 LIMIT 1',
      [id]
    );
    return rows[0] || null;
  },

  async create(projectId: string, title = 'Untitled'): Promise<DocumentRecord> {
    const db = getDB();
    const id = `doc_${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
    const ts = now();
    await db.query(
      'INSERT INTO documents(id, project_id, title, content, created_at, updated_at) VALUES($1, $2, $3, $4, $5, $6)',
      [id, projectId, title, '', ts, ts]
    );
    return { id, projectId, title, content: '', createdAt: ts, updatedAt: ts };
  },

  async save(doc: Pick<DocumentRecord, 'id' | 'title' | 'content'>): Promise<void> {
    const db = getDB();
    await db.query(
      'UPDATE documents SET title=$2, content=$3, updated_at=$4 WHERE id=$1',
      [doc.id, doc.title, doc.content, now()]
    );
  },

  async remove(id: string): Promise<void> {
    const db = getDB();
    await db.query('DELETE FROM documents WHERE id=$1', [id]);
  },
};

