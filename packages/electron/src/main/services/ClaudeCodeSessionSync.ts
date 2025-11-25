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
 * Convert Claude Code JSONL entry to Nimbalyst message format
 *
 * IMPORTANT: This must produce the SAME format as ClaudeCodeProvider.logAgentMessage()
 * so that SessionManager.transformAgentMessagesToUI() can parse it correctly.
 *
 * Live session format examples:
 * - Input: { prompt: "...", options: {...} }
 * - Output (text): { type: "text", content: "..." }
 * - Output (assistant): { type: "assistant", message: { content: [...], ... } }
 * - Output (user/tool result): { type: "user", message: { role: "user", content: [...] }, ... }
 */
function entryToMessage(entry: ClaudeCodeEntry): { direction: 'input' | 'output'; content: string; metadata: any; timestamp: string } | null {
  // Skip queue-operation entries (these are internal SDK bookkeeping)
  if ((entry as any).type === 'queue-operation') {
    return null;
  }

  // Skip meta messages (command outputs, caveats, etc.) - these clutter the transcript
  if ((entry as any).isMeta) {
    return null;
  }

  // Skip system/summary/snapshot entries - only process user and assistant messages
  if (entry.type !== 'user' && entry.type !== 'assistant') {
    return null;
  }

  // Check if this is a user message that's actually input (first message without parentUuid)
  // vs a tool result response (has parentUuid or contains tool_result)
  const isFirstUserMessage = entry.type === 'user' &&
    !entry.parentUuid &&
    entry.message?.content &&
    (typeof entry.message.content === 'string' ||
     (Array.isArray(entry.message.content) &&
      entry.message.content.some((p: any) => p.type === 'text') &&
      !entry.message.content.some((p: any) => p.type === 'tool_result')));

  if (isFirstUserMessage) {
    // This is a user INPUT message - format like ClaudeCodeProvider does for input
    // Extract the prompt text
    let promptText = '';
    if (typeof entry.message?.content === 'string') {
      promptText = entry.message.content;
    } else if (Array.isArray(entry.message?.content)) {
      const textParts = entry.message.content
        .filter((part: any) => part.type === 'text')
        .map((part: any) => part.text);
      promptText = textParts.join('\n');
    }

    // Skip empty messages
    if (!promptText.trim()) {
      return null;
    }

    // Format as ClaudeCodeProvider does: { prompt: "...", options: {...} }
    return {
      direction: 'input',
      content: JSON.stringify({
        prompt: promptText,
        options: {
          cwd: entry.cwd,
        }
      }),
      timestamp: entry.timestamp,
      metadata: null,
    };
  }

  if (entry.type === 'user') {
    // This is a user message in an OUTPUT context (tool result or system message)
    // Format like ClaudeCodeProvider does: { type: "user", message: {...}, ... }

    // Check if this is a tool result message
    const hasToolResults = Array.isArray(entry.message?.content) &&
      entry.message.content.some((p: any) => p.type === 'tool_result');

    if (hasToolResults) {
      // Tool result - store in the format transformAgentMessagesToUI expects
      return {
        direction: 'output',
        content: JSON.stringify({
          type: 'user',
          message: entry.message,
          session_id: entry.sessionId,
          uuid: entry.uuid,
          tool_use_result: (entry as any).toolUseResult,
        }),
        timestamp: entry.timestamp,
        metadata: null,
      };
    }

    // Other user message in output context (e.g., local command stdout)
    return {
      direction: 'output',
      content: JSON.stringify({
        type: 'user',
        message: entry.message,
        session_id: entry.sessionId,
        uuid: entry.uuid,
      }),
      timestamp: entry.timestamp,
      metadata: null,
    };
  }

  if (entry.type === 'assistant') {
    // Assistant message - store in the format transformAgentMessagesToUI expects
    // Format: { type: "assistant", message: {...}, session_id: "...", uuid: "..." }

    // Skip if no message content
    if (!entry.message) {
      return null;
    }

    return {
      direction: 'output',
      content: JSON.stringify({
        type: 'assistant',
        message: entry.message,
        parent_tool_use_id: (entry as any).parentToolUseId || null,
        session_id: entry.sessionId,
        uuid: entry.uuid,
      }),
      timestamp: entry.timestamp,
      metadata: null,
    };
  }

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
        metadata: {
          tokenUsage: metadata.tokenUsage,
        },
        createdAt: metadata.createdAt,
        updatedAt: metadata.updatedAt,
      });
      log.info(`Created new session ${metadata.sessionId} with token usage: ${metadata.tokenUsage.totalTokens} total`);
    } else {
      // Merge token usage into existing metadata
      const existingMetadata = existingSession.metadata || {};
      await sessionStore.updateMetadata(metadata.sessionId, {
        title: metadata.title || existingSession.title,
        metadata: {
          ...existingMetadata,
          tokenUsage: metadata.tokenUsage,
        },
      });
      log.info(`Updated session ${metadata.sessionId} with token usage: ${metadata.tokenUsage.totalTokens} total`);
    }

    // Convert entries to messages and sort by timestamp
    const allMessages = entries
      .map(entryToMessage)
      .filter((msg): msg is NonNullable<typeof msg> => msg !== null)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    // Import messages (skip already imported ones)
    let messagesAdded = 0;
    const messagesToImport = allMessages.slice(skipCount);

    for (const message of messagesToImport) {
      await messagesStore.create({
        sessionId: metadata.sessionId,
        source: 'claude-code-import',
        direction: message.direction,
        content: message.content,
        metadata: message.metadata,
        createdAt: message.timestamp,
      });
      messagesAdded++;
    }

    log.info(`Synced session ${metadata.sessionId}: ${messagesAdded} messages added (${allMessages.length} total after filtering)`);

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
