import { getDB } from '../pglite';
import type { Project } from '../../core/types';

const now = () => Date.now();

export const ProjectsRepository = {
  async list(): Promise<Project[]> {
    const db = getDB();
    const { rows } = await db.query<Project>(
      'SELECT id, name, created_at as "createdAt", updated_at as "updatedAt" FROM projects ORDER BY updated_at DESC'
    );
    return rows;
  },

  async create(name: string): Promise<Project> {
    const db = getDB();
    const id = `proj_${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
    const ts = now();
    await db.query(
      'INSERT INTO projects(id, name, created_at, updated_at) VALUES($1, $2, $3, $4)',
      [id, name, ts, ts]
    );
    return { id, name, createdAt: ts, updatedAt: ts };
  },

  async rename(id: string, name: string): Promise<void> {
    const db = getDB();
    await db.query('UPDATE projects SET name=$2, updated_at=$3 WHERE id=$1', [id, name, now()]);
  },
};

