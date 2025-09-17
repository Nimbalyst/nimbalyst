export type Theme = 'light' | 'dark' | 'crystal-dark' | 'auto';

export interface Workspace {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface DocumentRecord {
  id: string;
  workspaceId: string;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

export interface AppSettings {
  id: 'default';
  theme: Theme;
  updatedAt: number;
}

