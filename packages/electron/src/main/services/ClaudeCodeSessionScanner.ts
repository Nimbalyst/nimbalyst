/**
 * Service to scan and import Claude Code sessions from ~/.claude/projects/
 *
 * This service discovers sessions created by the Claude Code CLI or other tools
 * and synchronizes them with Nimbalyst's database.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { homedir } from 'os';
import { logger } from '../utils/logger';
import type { TokenUsageCategory } from '@nimbalyst/runtime/ai/server/types';

const log = logger.aiSession;

export interface SessionMetadata {
  sessionId: string;
  workspacePath: string;
  title: string | null;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    categories?: TokenUsageCategory[];
  };
  firstMessage: string | null;
  hasErrors: boolean;
}

export interface ClaudeCodeEntry {
  uuid: string;
  parentUuid?: string;
  sessionId: string;
  timestamp: string;
  type: 'user' | 'assistant' | 'summary' | 'system' | 'file-history-snapshot';
  message?: {
    role?: string;
    content?: any;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
  cwd?: string;
  gitBranch?: string;
  version?: string;
  [key: string]: any;
}

/**
 * Normalize escaped workspace path to absolute path
 * Example: -Users-user-sources-project → /Users/user/sources/project
 */
export function normalizeWorkspacePath(escapedPath: string): string {
  // Remove leading dash and replace dashes with slashes
  const normalized = escapedPath.startsWith('-')
    ? escapedPath.slice(1).replace(/-/g, '/')
    : escapedPath.replace(/-/g, '/');

  // Add leading slash for absolute path
  return `/${normalized}`;
}

/**
 * Get the ~/.claude/projects directory path
 */
function getClaudeProjectsDir(): string {
  return path.join(homedir(), '.claude', 'projects');
}

/**
 * Check if ~/.claude/projects directory exists
 */
export async function claudeProjectsDirExists(): Promise<boolean> {
  try {
    const projectsDir = getClaudeProjectsDir();
    const stats = await fs.stat(projectsDir);
    return stats.isDirectory();
  } catch (error) {
    return false;
  }
}

/**
 * Scan ~/.claude/projects/ and return list of workspace directories
 */
export async function scanWorkspaceDirectories(): Promise<string[]> {
  const projectsDir = getClaudeProjectsDir();

  try {
    const entries = await fs.readdir(projectsDir, { withFileTypes: true });
    return entries
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name);
  } catch (error) {
    log.error('Failed to scan workspace directories:', error);
    return [];
  }
}

/**
 * Get all session JSONL files in a workspace directory
 */
async function getSessionFiles(workspaceDir: string): Promise<string[]> {
  const projectsDir = getClaudeProjectsDir();
  const fullPath = path.join(projectsDir, workspaceDir);

  try {
    const entries = await fs.readdir(fullPath, { withFileTypes: true });
    return entries
      .filter(entry =>
        entry.isFile() &&
        entry.name.endsWith('.jsonl') &&
        !entry.name.startsWith('agent-') // Skip sidechain agent files
      )
      .map(entry => path.join(fullPath, entry.name));
  } catch (error) {
    log.error(`Failed to read session files in ${workspaceDir}:`, error);
    return [];
  }
}

/**
 * Parse a single line of JSONL
 */
function parseJSONLLine(line: string): ClaudeCodeEntry | null {
  try {
    return JSON.parse(line);
  } catch (error) {
    return null;
  }
}

/**
 * Extract session metadata from a JSONL file without loading entire file
 */
export async function extractSessionMetadata(filePath: string): Promise<SessionMetadata | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.trim().split('\n').filter(line => line.trim());

    if (lines.length === 0) {
      log.warn(`Empty session file: ${filePath}`);
      return null;
    }

    let sessionId: string | null = null;
    let title: string | null = null;
    let firstTimestamp: number | null = null;
    let lastTimestamp: number | null = null;
    let firstMessage: string | null = null;
    let inputTokens = 0;
    let outputTokens = 0;
    let hasErrors = false;
    let workspacePath: string | null = null;

    // Track unique message IDs to avoid counting streaming chunks multiple times
    const seenMessageIds = new Set<string>();

    // Parse entries
    for (const line of lines) {
      const entry = parseJSONLLine(line);
      if (!entry) {
        hasErrors = true;
        continue;
      }

      // Extract session ID
      if (!sessionId && entry.sessionId) {
        sessionId = entry.sessionId;
      }

      // Extract workspace path from cwd
      if (!workspacePath && entry.cwd) {
        workspacePath = entry.cwd;
      }

      // Extract timestamps
      if (entry.timestamp) {
        const timestamp = new Date(entry.timestamp).getTime();
        if (!isNaN(timestamp)) {
          if (firstTimestamp === null || timestamp < firstTimestamp) firstTimestamp = timestamp;
          if (lastTimestamp === null || timestamp > lastTimestamp) lastTimestamp = timestamp;
        }
      }

      // Extract title from summary entries
      if (entry.type === 'summary') {
        // Check for summary field directly (newer format)
        if ((entry as any).summary) {
          title = (entry as any).summary;
          log.debug(`Found summary title: ${title}`);
        }
        // Fallback to parsing from message.content (older format)
        else if (entry.message?.content) {
          const content = entry.message.content;
          if (typeof content === 'string' && content.includes('title:')) {
            const match = content.match(/title:\s*(.+?)(\n|$)/);
            if (match) {
              title = match[1].trim();
              log.debug(`Found title from content: ${title}`);
            }
          }
        }
      }

      // Extract first user message (skip system messages and caveats)
      if (!firstMessage && entry.type === 'user' && entry.message?.content) {
        const content = entry.message.content;
        let text = '';

        if (typeof content === 'string') {
          text = content;
        } else if (Array.isArray(content)) {
          // Handle multi-part content
          for (const part of content) {
            if (part.type === 'text' && part.text) {
              text = part.text;
              break;
            }
          }
        }

        // Skip system messages, caveats, slash commands, and command output
        const lowerText = text.toLowerCase();
        const trimmedText = text.trim();
        const isSystemMessage =
          lowerText.includes('caveat:') ||
          lowerText.includes('<nimbalyst_system_message>') ||
          lowerText.includes('<command-name>') ||
          lowerText.includes('<local-command-stdout>') ||
          lowerText.includes('<system-reminder>') ||
          lowerText.includes('the messages below were generated') ||
          trimmedText.startsWith('/');  // Skip slash commands like /clear, /context, etc.

        if (trimmedText && !isSystemMessage) {
          firstMessage = text.slice(0, 200);
        }
      }

      // Aggregate token usage - deduplicate by message ID to avoid counting streaming chunks
      // Each streamed response has multiple JSONL entries but the same message.id
      if (entry.type === 'assistant' && entry.message?.usage) {
        const messageId = entry.message.id || entry.uuid;

        // Only count tokens once per unique message
        if (!seenMessageIds.has(messageId)) {
          seenMessageIds.add(messageId);
          const usage = entry.message.usage;
          inputTokens += usage.input_tokens || 0;
          outputTokens += usage.output_tokens || 0;
        }
      }
    }

    // Derive session ID from filename if not found in entries
    if (!sessionId) {
      const filename = path.basename(filePath, '.jsonl');
      sessionId = filename;
    }

    // Generate title if not found
    if (!title) {
      title = firstMessage ? firstMessage.slice(0, 50) + '...' : 'Untitled Session';
      log.debug(`Using fallback title: ${title}`);
    } else {
      log.debug(`Using extracted title: ${title}`);
    }

    // Extract workspace path from file path if not found
    if (!workspacePath) {
      const projectsDir = getClaudeProjectsDir();
      const relativePath = path.relative(projectsDir, path.dirname(filePath));
      workspacePath = normalizeWorkspacePath(relativePath);
    }

    // Use current time as fallback only if no timestamps found
    const now = Date.now();
    const createdAt = firstTimestamp ?? now;
    const updatedAt = lastTimestamp ?? now;

    return {
      sessionId,
      workspacePath,
      title,
      createdAt,
      updatedAt,
      messageCount: lines.length,
      tokenUsage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
      firstMessage,
      hasErrors,
    };
  } catch (error) {
    log.error(`Failed to extract metadata from ${filePath}:`, error);
    return null;
  }
}

/**
 * Scan Claude Code sessions and return metadata
 * @param workspacePath - Optional workspace path to filter sessions. If provided, only scans that workspace.
 */
export async function scanAllSessions(workspacePath?: string): Promise<SessionMetadata[]> {
  let workspaceDirs: string[];

  if (workspacePath) {
    // Only scan the specified workspace
    // Convert absolute path to escaped directory name format
    // /Users/foo/bar -> -Users-foo-bar
    const escapedPath = workspacePath.replace(/\//g, '-');
    workspaceDirs = [escapedPath];
    log.info(`Scanning sessions for workspace: ${workspacePath} -> ${escapedPath}`);
  } else {
    // Scan all workspaces
    workspaceDirs = await scanWorkspaceDirectories();
    log.info(`Scanning sessions from all workspaces`);
  }

  const sessions: SessionMetadata[] = [];

  for (const workspaceDir of workspaceDirs) {
    const sessionFiles = await getSessionFiles(workspaceDir);

    for (const filePath of sessionFiles) {
      const metadata = await extractSessionMetadata(filePath);
      if (metadata) {
        sessions.push(metadata);
      }
    }
  }

  log.info(`Scanned ${sessions.length} sessions from ${workspaceDirs.length} workspace(s)`);
  return sessions;
}

/**
 * Dev mode flag check (for now, always allow in dev mode)
 */
export function isSessionImportEnabled(): boolean {
  // For now, enable in development mode only
  return process.env.NODE_ENV !== 'production';
}
