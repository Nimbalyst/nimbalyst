/**
 * Service to synchronize Claude Code sessions to Nimbalyst database
 *
 * This service handles the transformation and import of Claude Code JSONL sessions
 * into Nimbalyst's PGLite database format.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { homedir } from 'os';
import type { SessionStore } from '@nimbalyst/runtime';
import type { AgentMessagesStore } from '@nimbalyst/runtime/storage/repositories/AgentMessagesRepository';
import { logger } from '../utils/logger';
import { extractSessionMetadata, type ClaudeCodeEntry, type SessionMetadata } from './ClaudeCodeSessionScanner';

const log = logger.aiSession;

export interface SyncStatus {
  sessionId: string;
  status: 'new' | 'up-to-date' | 'needs-update';
  dbMessageCount: number;
  fileMessageCount: number;
}

export interface SyncResult {
  sessionId: string;
  success: boolean;
  error?: string;
  messagesAdded: number;
}

/**
 * Get the full path to a session JSONL file
 */
function getSessionFilePath(workspacePath: string, sessionId: string): string {
  // Escape workspace path for Claude Code directory format
  const escapedPath = workspacePath.replace(/\//g, '-');
  const projectsDir = path.join(homedir(), '.claude', 'projects');
  return path.join(projectsDir, escapedPath, `${sessionId}.jsonl`);
}

/**
 * Parse JSONL file and return all entries
 */
async function parseSessionFile(filePath: string): Promise<ClaudeCodeEntry[]> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.trim().split('\n').filter(line => line.trim());

    const entries: ClaudeCodeEntry[] = [];
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        entries.push(entry);
      } catch (error) {
        log.warn(`Failed to parse JSONL line: ${line.slice(0, 100)}...`);
      }
    }

    return entries;
  } catch (error) {
    log.error(`Failed to read session file ${filePath}:`, error);
    throw error;
  }
}

/**
 * Convert Claude Code entry to Nimbalyst message format
 */
function entryToMessage(entry: ClaudeCodeEntry): { direction: 'input' | 'output'; content: string; metadata: any } | null {
  if (entry.type === 'user') {
    // User message
    let content = '';
    if (typeof entry.message?.content === 'string') {
      content = entry.message.content;
    } else if (Array.isArray(entry.message?.content)) {
      // Multi-part content - extract text parts
      content = entry.message.content
        .filter((part: any) => part.type === 'text')
        .map((part: any) => part.text)
        .join('\n');
    }

    return {
      direction: 'input',
      content,
      metadata: {
        role: 'user',
        timestamp: entry.timestamp,
        cwd: entry.cwd,
        gitBranch: entry.gitBranch,
        entryType: entry.type,
      },
    };
  } else if (entry.type === 'assistant') {
    // Assistant message
    let content = '';
    if (typeof entry.message?.content === 'string') {
      content = entry.message.content;
    } else if (Array.isArray(entry.message?.content)) {
      // Multi-part content - extract text and tool use
      content = entry.message.content
        .filter((part: any) => part.type === 'text')
        .map((part: any) => part.text)
        .join('\n');
    }

    return {
      direction: 'output',
      content,
      metadata: {
        role: 'assistant',
        timestamp: entry.timestamp,
        usage: entry.usage,
        toolUse: entry.message?.content?.filter?.((part: any) => part.type === 'tool_use'),
        entryType: entry.type,
      },
    };
  }

  // Skip other entry types (summary, system, file-history-snapshot)
  return null;
}

/**
 * Check sync status for a session
 */
export async function checkSyncStatus(
  sessionStore: SessionStore,
  messagesStore: AgentMessagesStore,
  metadata: SessionMetadata
): Promise<SyncStatus> {
  try {
    // NOTE: Nimbalyst sessions store the Claude Code session ID in providerSessionId,
    // not in the main id field. We need to find the session by providerSessionId.
    // For now, we'll check by the main ID first (for imported sessions),
    // but we need a way to query by providerSessionId.

    // Try to find by main ID (works for already-imported sessions)
    let existingSession = await sessionStore.get(metadata.sessionId);

    // If not found, we need to check if a session exists with this as providerSessionId
    // Unfortunately, the SessionStore interface doesn't have a query-by-providerSessionId method
    // So for now, we'll have to list all sessions and check
    // TODO: Add a more efficient query method to SessionStore
    if (!existingSession) {
      // This is inefficient but necessary for now
      // We can't easily query by providerSessionId without modifying the store interface
      log.debug(`Session ${metadata.sessionId} not found by ID, may exist with providerSessionId`);
    }

    log.debug(`Checking sync status for session ${metadata.sessionId}: ${existingSession ? 'found in DB' : 'not in DB'}`);

    if (!existingSession) {
      return {
        sessionId: metadata.sessionId,
        status: 'new',
        dbMessageCount: 0,
        fileMessageCount: metadata.messageCount,
      };
    }

    // Get message count from database
    const messages = await messagesStore.list(existingSession.id);
    const dbMessageCount = messages.length;

    if (dbMessageCount === metadata.messageCount) {
      return {
        sessionId: metadata.sessionId,
        status: 'up-to-date',
        dbMessageCount,
        fileMessageCount: metadata.messageCount,
      };
    }

    return {
      sessionId: metadata.sessionId,
      status: 'needs-update',
      dbMessageCount,
      fileMessageCount: metadata.messageCount,
    };
  } catch (error) {
    log.error(`Failed to check sync status for ${metadata.sessionId}:`, error);
    throw error;
  }
}

/**
 * Synchronize a single session to the database
 */
export async function syncSession(
  sessionStore: SessionStore,
  messagesStore: AgentMessagesStore,
  metadata: SessionMetadata
): Promise<SyncResult> {
  try {
    log.info(`Syncing session ${metadata.sessionId}...`);

    // Get session file path
    const filePath = getSessionFilePath(metadata.workspacePath, metadata.sessionId);

    // Parse session file
    const entries = await parseSessionFile(filePath);

    // Check if session exists
    const existingSession = await sessionStore.get(metadata.sessionId);
    const existingMessages = existingSession ? await messagesStore.list(metadata.sessionId) : [];
    const skipCount = existingMessages.length;

    // Create or update session
    if (!existingSession) {
      await sessionStore.create({
        id: metadata.sessionId,
        workspaceId: metadata.workspacePath,
        provider: 'claude-code',
        title: metadata.title || 'Imported Session',
        sessionType: 'chat',
        providerSessionId: metadata.sessionId, // CRITICAL: Pass the Claude Code session ID so SDK can resume
        providerConfig: {
          imported: true,
          importedAt: Date.now(),
        },
        createdAt: metadata.createdAt,
        updatedAt: metadata.updatedAt,
      });
      log.info(`Created new session ${metadata.sessionId} with providerSessionId for resumption`);
    } else {
      await sessionStore.updateMetadata(metadata.sessionId, {
        title: metadata.title || existingSession.title,
      });
      log.info(`Updated existing session ${metadata.sessionId}`);
    }

    // Import messages (skip already imported ones)
    let messagesAdded = 0;
    const messagesToImport = entries.slice(skipCount);

    for (const entry of messagesToImport) {
      const message = entryToMessage(entry);
      if (message) {
        await messagesStore.create({
          sessionId: metadata.sessionId,
          source: 'claude-code-import',
          direction: message.direction,
          content: message.content,
          metadata: message.metadata,
        });
        messagesAdded++;
      }
    }

    log.info(`Synced session ${metadata.sessionId}: ${messagesAdded} messages added`);

    return {
      sessionId: metadata.sessionId,
      success: true,
      messagesAdded,
    };
  } catch (error) {
    log.error(`Failed to sync session ${metadata.sessionId}:`, error);
    return {
      sessionId: metadata.sessionId,
      success: false,
      error: error instanceof Error ? error.message : String(error),
      messagesAdded: 0,
    };
  }
}

/**
 * Batch sync multiple sessions
 */
export async function syncSessions(
  sessionStore: SessionStore,
  messagesStore: AgentMessagesStore,
  sessions: SessionMetadata[],
  progressCallback?: (current: number, total: number, sessionId: string) => void
): Promise<SyncResult[]> {
  const results: SyncResult[] = [];

  for (let i = 0; i < sessions.length; i++) {
    const session = sessions[i];

    if (progressCallback) {
      progressCallback(i + 1, sessions.length, session.sessionId);
    }

    const result = await syncSession(sessionStore, messagesStore, session);
    results.push(result);
  }

  return results;
}
