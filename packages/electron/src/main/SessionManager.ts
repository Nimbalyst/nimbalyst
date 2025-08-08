import { app } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import * as zlib from 'zlib';
import { promisify } from 'util';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

export type SessionType = 'ai-diff' | 'compare' | 'review';
export type SessionStatus = 'active' | 'paused' | 'conflict' | 'applied';
export type ResolutionType = 'reload' | 'merge' | 'overwrite';

export interface SessionSource {
  type: 'ai' | 'manual' | 'file-compare';
  details?: any;
}

export interface SessionStats {
  totalDiffs?: number;
  appliedDiffs?: number;
  rejectedDiffs?: number;
}

export interface SessionMetadata {
  id: string;
  type: SessionType;
  filePath: string;
  created: string;
  lastModified: string;
  baseMarkdownHash: string;
  currentMarkdownHash?: string;
  status: SessionStatus;
  source?: SessionSource;
  stats?: SessionStats;
}

export interface Session {
  id: string;
  metadata: SessionMetadata;
  state?: string;
}

export interface ActiveSessionEntry {
  sessionId: string;
  type: SessionType;
  created: string;
  lastModified: string;
}

export interface ConflictStatus {
  hasConflict: boolean;
  reason?: 'file-changed' | 'base-mismatch';
  resolution?: ResolutionType;
}

export class SessionManager {
  private sessionsDir: string;
  private activeSessionsPath: string;
  private sessionExpiryDays = 7;

  constructor() {
    this.sessionsDir = path.join(app.getPath('userData'), 'sessions');
    this.activeSessionsPath = path.join(this.sessionsDir, 'active.json');
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.sessionsDir, { recursive: true });
    await this.cleanup();
  }

  private generateSessionId(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  private getSessionPaths(sessionId: string) {
    const sessionDir = path.join(this.sessionsDir, sessionId);
    return {
      dir: sessionDir,
      state: path.join(sessionDir, 'state.lexical.gz'),
      metadata: path.join(sessionDir, 'metadata.json'),
      checkpointsDir: path.join(sessionDir, 'checkpoints'),
    };
  }

  async createSession(
    filePath: string,
    type: SessionType,
    source?: SessionSource
  ): Promise<Session> {
    const sessionId = this.generateSessionId();
    const paths = this.getSessionPaths(sessionId);
    const now = new Date().toISOString();

    // Create session directory
    await fs.mkdir(paths.dir, { recursive: true });

    // Create metadata
    const metadata: SessionMetadata = {
      id: sessionId,
      type,
      filePath,
      created: now,
      lastModified: now,
      baseMarkdownHash: '',
      status: 'active',
      source,
      stats: {},
    };

    // Save metadata
    await fs.writeFile(paths.metadata, JSON.stringify(metadata, null, 2));

    // Set as active session for this file
    await this.setActiveSession(filePath, sessionId, type);

    return { id: sessionId, metadata };
  }

  async loadSession(sessionId: string): Promise<Session | null> {
    const paths = this.getSessionPaths(sessionId);

    try {
      // Load metadata
      const metaData = await fs.readFile(paths.metadata, 'utf-8');
      const metadata: SessionMetadata = JSON.parse(metaData);

      // Load state if it exists
      let state: string | undefined;
      try {
        const compressed = await fs.readFile(paths.state);
        const decompressed = await gunzip(compressed);
        state = decompressed.toString('utf-8');
      } catch {
        // State file doesn't exist yet
      }

      return { id: sessionId, metadata, state };
    } catch {
      return null;
    }
  }

  async saveSession(session: Session): Promise<void> {
    const paths = this.getSessionPaths(session.id);

    // Update metadata
    session.metadata.lastModified = new Date().toISOString();
    await fs.writeFile(paths.metadata, JSON.stringify(session.metadata, null, 2));

    // Save state if provided
    if (session.state) {
      const compressed = await gzip(Buffer.from(session.state, 'utf-8'));
      await fs.writeFile(paths.state, compressed);
    }

    // Update active sessions
    await this.updateActiveSessionTimestamp(session.metadata.filePath);
  }

  async deleteSession(sessionId: string): Promise<void> {
    const paths = this.getSessionPaths(sessionId);
    
    // Remove from active sessions first
    await this.removeActiveSession(sessionId);
    
    // Delete session directory
    await fs.rm(paths.dir, { recursive: true, force: true });
  }

  async getActiveSession(filePath: string): Promise<Session | null> {
    try {
      const data = await fs.readFile(this.activeSessionsPath, 'utf-8');
      const activeSessions: Record<string, ActiveSessionEntry> = JSON.parse(data);
      
      const entry = activeSessions[filePath];
      if (!entry) return null;
      
      return this.loadSession(entry.sessionId);
    } catch {
      return null;
    }
  }

  async setActiveSession(
    filePath: string,
    sessionId: string,
    type: SessionType
  ): Promise<void> {
    let activeSessions: Record<string, ActiveSessionEntry> = {};
    
    try {
      const data = await fs.readFile(this.activeSessionsPath, 'utf-8');
      activeSessions = JSON.parse(data);
    } catch {
      // File doesn't exist yet
    }

    const now = new Date().toISOString();
    activeSessions[filePath] = {
      sessionId,
      type,
      created: activeSessions[filePath]?.created || now,
      lastModified: now,
    };

    await fs.writeFile(this.activeSessionsPath, JSON.stringify(activeSessions, null, 2));
  }

  private async updateActiveSessionTimestamp(filePath: string): Promise<void> {
    try {
      const data = await fs.readFile(this.activeSessionsPath, 'utf-8');
      const activeSessions: Record<string, ActiveSessionEntry> = JSON.parse(data);
      
      if (activeSessions[filePath]) {
        activeSessions[filePath].lastModified = new Date().toISOString();
        await fs.writeFile(this.activeSessionsPath, JSON.stringify(activeSessions, null, 2));
      }
    } catch {
      // Ignore errors
    }
  }

  private async removeActiveSession(sessionId: string): Promise<void> {
    try {
      const data = await fs.readFile(this.activeSessionsPath, 'utf-8');
      const activeSessions: Record<string, ActiveSessionEntry> = JSON.parse(data);
      
      // Find and remove entry with this session ID
      for (const [filePath, entry] of Object.entries(activeSessions)) {
        if (entry.sessionId === sessionId) {
          delete activeSessions[filePath];
          break;
        }
      }
      
      await fs.writeFile(this.activeSessionsPath, JSON.stringify(activeSessions, null, 2));
    } catch {
      // Ignore errors
    }
  }

  async checkConflicts(session: Session, currentMarkdownHash: string): Promise<ConflictStatus> {
    if (session.metadata.baseMarkdownHash !== currentMarkdownHash) {
      return {
        hasConflict: true,
        reason: 'file-changed',
      };
    }

    return { hasConflict: false };
  }

  async resolveConflict(
    session: Session,
    resolution: ResolutionType,
    newBaseHash?: string
  ): Promise<void> {
    switch (resolution) {
      case 'reload':
        // Update base hash to current
        if (newBaseHash) {
          session.metadata.baseMarkdownHash = newBaseHash;
          session.metadata.currentMarkdownHash = newBaseHash;
        }
        session.metadata.status = 'active';
        break;
      
      case 'merge':
        // Mark as needing merge
        session.metadata.status = 'conflict';
        break;
      
      case 'overwrite':
        // Keep session as-is, will overwrite on apply
        session.metadata.status = 'active';
        break;
    }

    await this.saveSession(session);
  }

  async createCheckpoint(sessionId: string, state: string): Promise<void> {
    const paths = this.getSessionPaths(sessionId);
    const checkpointsDir = paths.checkpointsDir;
    
    await fs.mkdir(checkpointsDir, { recursive: true });
    
    const timestamp = new Date().toISOString();
    const compressed = await gzip(Buffer.from(state, 'utf-8'));
    const checkpointPath = path.join(checkpointsDir, `${timestamp}.lexical.gz`);
    
    await fs.writeFile(checkpointPath, compressed);
  }

  async cleanup(): Promise<void> {
    try {
      const dirs = await fs.readdir(this.sessionsDir);
      const now = Date.now();
      const maxAge = this.sessionExpiryDays * 24 * 60 * 60 * 1000;
      
      for (const dir of dirs) {
        if (dir === 'active.json') continue;
        
        const metadataPath = path.join(this.sessionsDir, dir, 'metadata.json');
        
        try {
          const data = await fs.readFile(metadataPath, 'utf-8');
          const metadata: SessionMetadata = JSON.parse(data);
          
          const age = now - new Date(metadata.lastModified).getTime();
          
          // Delete if expired and not active
          if (age > maxAge && metadata.status !== 'active') {
            await this.deleteSession(metadata.id);
          }
        } catch {
          // Skip invalid directories
        }
      }
    } catch {
      // Sessions directory doesn't exist yet
    }
  }
}