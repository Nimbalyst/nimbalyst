/**
 * ToolCallMatcher - Correlates file edits in session_files with tool calls in ai_agent_messages.
 *
 * Creates linkage records in ai_tool_call_file_edits so the UI can show
 * which tool call caused which file edit.
 *
 * Matching heuristics (scored):
 *   +100  toolUseId exact match (bypasses time cutoff)
 *   +40   filename appears in tool call arguments
 *   +30   filename appears in tool call output
 *
 * Time cutoff: file edit must occur within 10s before tool call start
 * or 10s after tool result end. Candidates outside this window are
 * excluded entirely (except toolUseId exact matches).
 *
 * Path matching uses filename only (basename), not full paths.
 */

import * as path from 'path';
import { database } from '../database/PGLiteDatabaseWorker';
import { logger } from '../utils/logger';
// Lazy-loaded parseBashForFileOps - the deep import path isn't in runtime's
// package.json exports map, so we load it lazily via require() which bypasses
// export validation. Falls back to a simple regex parser if unavailable.
let _parseBashForFileOps: ((command: string, cwd: string) => string[]) | undefined;

function parseBashPaths(command: string, cwd: string): string[] {
  if (!_parseBashForFileOps) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('@nimbalyst/runtime/ai/server/providers/bashUtils');
      _parseBashForFileOps = mod.parseBashForFileOps;
    } catch {
      // Fallback: simple regex extraction for common write patterns
      _parseBashForFileOps = (cmd: string, cwdPath: string) => {
        const paths: string[] = [];
        // Redirect: > or >> followed by whitespace and filename
        const redirectMatches = cmd.match(/>+\s+(\S+)/g);
        if (redirectMatches) {
          for (const m of redirectMatches) {
            const target = m.replace(/^>+\s*/, '');
            paths.push(target.startsWith('/') ? target : `${cwdPath}/${target}`);
          }
        }
        // tee
        const teeMatch = cmd.match(/tee\s+(?:-a\s+)?(\S+)/);
        if (teeMatch?.[1]) {
          const t = teeMatch[1];
          paths.push(t.startsWith('/') ? t : `${cwdPath}/${t}`);
        }
        // cp dest
        const cpMatch = cmd.match(/cp\s+\S+\s+(\S+)/);
        if (cpMatch?.[1]) {
          const t = cpMatch[1];
          paths.push(t.startsWith('/') ? t : `${cwdPath}/${t}`);
        }
        // sed -i
        const sedMatch = cmd.match(/sed\s+-i(?:\.\w+)?\s+'[^']+'\s+(\S+)/);
        if (sedMatch?.[1]) {
          const t = sedMatch[1];
          paths.push(t.startsWith('/') ? t : `${cwdPath}/${t}`);
        }
        return paths;
      };
    }
  }
  return _parseBashForFileOps!(command, cwd);
}

/** For testing: override the parseBash function */
export function _setParseBashFn(fn: ((command: string, cwd: string) => string[]) | undefined): void {
  _parseBashForFileOps = fn;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolCallWindow {
  messageId: number;
  messageCreatedAt: number;
  sessionId: string;
  toolName: string;
  toolCallItemId: string | null;
  toolUseId: string | null;
  filePaths: string[];
  outputText: string;
}

/**
 * Diff data for a file changed by a tool call.
 * SYNC: Keep in sync with ToolCallDiffResult in packages/runtime/src/ui/AgentTranscript/components/CustomToolWidgets/index.ts
 */
export interface ToolCallDiffResult {
  filePath: string;
  operation: string; // 'create' | 'edit' | 'delete' | 'bash'
  diffs: Array<{ oldString: string; newString: string }>; // empty for bash/unknown
  content?: string; // full content for create operations
  linesAdded?: number;
  linesRemoved?: number;
}

export interface ToolCallFileEdit {
  id: number;
  sessionId: string;
  sessionFileId: string;
  messageId: number;
  toolCallItemId: string | null;
  toolUseId: string | null;
  matchScore: number;
  matchReason: string;
  fileTimestamp: Date | null;
  createdAt: Date;
}

interface SessionFileRow {
  id: string;
  file_path: string;
  timestamp: Date;
  metadata: any;
}

interface AgentMessageRow {
  id: number;
  content: string;
  created_at: Date;
}

interface ToolCallMatchRow {
  id: number;
  session_id: string;
  session_file_id: string;
  message_id: number;
  tool_call_item_id: string | null;
  tool_use_id: string | null;
  match_score: number;
  match_reason: string;
  file_timestamp: Date | null;
  created_at: Date;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TIME_CUTOFF_MS = 10_000; // 10 second hard cutoff around tool call
const MIN_MATCH_SCORE = 30; // Must have at least a filename match

// Tool item types that represent tool calls
const TOOL_ITEM_TYPES = new Set([
  'mcp_tool_call',
  'command_execution',
  'file_change',
  'tool_call',
  'function_call',
]);

// Common path fields in tool arguments
const PATH_FIELDS = ['file_path', 'filePath', 'path', 'notebook_path', 'notebookPath'];

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/**
 * Ensure a value is a number, converting from string if needed.
 */
function ensureNumber(value: number | string): number {
  return typeof value === 'number' ? value : Number(value);
}

/**
 * Extract file paths from tool call arguments.
 */
function extractFilePathsFromArgs(args: any, workspacePath?: string): string[] {
  if (!args) return [];
  const paths: string[] = [];

  // Direct path fields
  for (const field of PATH_FIELDS) {
    if (typeof args[field] === 'string') {
      paths.push(args[field]);
    }
  }

  // file_change: args.changes[].path
  if (Array.isArray(args.changes)) {
    for (const change of args.changes) {
      if (change && typeof change.path === 'string') {
        paths.push(change.path);
      }
    }
  }

  // Bash commands: parse for file operations
  if (typeof args.command === 'string' && workspacePath) {
    const bashPaths = parseBashPaths(args.command, workspacePath);
    paths.push(...bashPaths);
  }

  return paths;
}

/**
 * Extract file paths mentioned in tool result/output text.
 * Scans for absolute paths that look like file references.
 */
function extractFilePathsFromOutput(output: any): string[] {
  const text = stringifyOutput(output);
  if (!text) return [];

  // Match absolute paths (Unix-style)
  const pathRegex = /(?:^|\s)(\/[^\s:,;'"()\[\]{}]+\.[a-zA-Z0-9]+)/g;
  const paths: string[] = [];
  let match;
  while ((match = pathRegex.exec(text)) !== null) {
    const p = match[1];
    // Filter out common non-file paths
    if (!p.includes('/proc/') && !p.includes('/dev/') && !p.includes('/sys/')) {
      paths.push(p);
    }
  }
  return paths;
}

/**
 * Stringify tool output for text scanning.
 */
function stringifyOutput(output: any): string {
  if (typeof output === 'string') return output;
  if (output === null || output === undefined) return '';
  if (typeof output === 'object') {
    // Check common result fields
    const parts: string[] = [];
    if (typeof output.output === 'string') parts.push(output.output);
    if (typeof output.stdout === 'string') parts.push(output.stdout);
    if (typeof output.stderr === 'string') parts.push(output.stderr);
    if (typeof output.aggregated_output === 'string') parts.push(output.aggregated_output);
    if (typeof output.result === 'string') parts.push(output.result);
    if (parts.length > 0) return parts.join('\n');
    // Fallback: stringify the whole thing (truncated)
    try {
      const str = JSON.stringify(output);
      return str.length > 10000 ? str.slice(0, 10000) : str;
    } catch {
      return '';
    }
  }
  return String(output);
}

/**
 * Parse an ai_agent_messages content string to extract tool call windows.
 */
export function parseToolCallWindows(
  messageId: number,
  content: string,
  createdAt: Date,
  sessionId: string,
  workspacePath?: string
): ToolCallWindow[] {
  const windows: ToolCallWindow[] = [];

  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch {
    return windows;
  }

  if (!parsed || typeof parsed !== 'object') return windows;

  const eventType = typeof parsed.type === 'string' ? parsed.type : '';

  // -----------------------------------------------------------------------
  // Format 1: Raw Claude API messages
  // Structure: {"type":"assistant","message":{"content":[{"type":"tool_use",...}]}}
  // or: {"type":"user","message":{"content":[{"type":"tool_result",...}]}}
  // -----------------------------------------------------------------------
  if ((eventType === 'assistant' || eventType === 'user') && parsed.message?.content) {
    const contentBlocks = Array.isArray(parsed.message.content) ? parsed.message.content : [];

    for (const block of contentBlocks) {
      if (!block || typeof block !== 'object') continue;

      if (block.type === 'tool_use' && typeof block.name === 'string') {
        const toolName = block.name;
        const args = block.input ?? null;
        const toolId = typeof block.id === 'string' ? block.id : null;

        const argPaths = extractFilePathsFromArgs(args, workspacePath);
        const allPaths = [...new Set(argPaths)];

        windows.push({
          messageId,
          messageCreatedAt: createdAt.getTime(),
          sessionId,
          toolName,
          toolCallItemId: toolId,
          toolUseId: toolId,
          filePaths: allPaths,
          outputText: '',
        });
      }
    }

    return windows;
  }

  // -----------------------------------------------------------------------
  // Format 2: Claude Code SDK events
  // Structure: {"type":"item.completed","item":{"type":"tool_call",...}}
  // -----------------------------------------------------------------------
  const item = parsed.item;

  if (!item || typeof item !== 'object') return windows;

  const itemType = typeof item.type === 'string' ? item.type : '';

  // Only process tool-like items
  const isTool = TOOL_ITEM_TYPES.has(itemType) ||
    itemType.includes('tool') ||
    itemType.includes('command');

  if (!isTool) return windows;

  // Extract tool name
  let toolName = '';
  if (itemType === 'mcp_tool_call') {
    const server = typeof item.server === 'string' ? item.server : '';
    const tool = typeof item.tool === 'string' ? item.tool : '';
    toolName = server && tool ? `mcp__${server}__${tool}` : tool || 'Unknown';
  } else if (itemType === 'command_execution') {
    toolName = 'Bash';
  } else if (itemType === 'file_change') {
    toolName = 'file_change';
  } else {
    toolName = typeof item.name === 'string' ? item.name :
      typeof item.tool === 'string' ? item.tool :
      typeof item.command === 'string' ? item.command : 'Unknown';
  }

  // Extract tool arguments
  let args: any = null;
  if (itemType === 'command_execution') {
    // Codex uses command field directly, often wrapped in a shell invocation
    // like "/bin/zsh -lc 'actual command'" - unwrap to get the inner command
    let rawCommand = typeof item.command === 'string' ? item.command : '';
    const shellMatch = rawCommand.match(/\/(?:bin|usr\/bin)\/(?:bash|zsh|sh)\s+-l?c\s+(.+)$/);
    if (shellMatch) {
      rawCommand = shellMatch[1].replace(/^['"]|['"]$/g, '');
    }
    args = { command: rawCommand };
  } else if (itemType === 'file_change') {
    args = { changes: item.changes };
  } else {
    // Standard tool call with arguments/input
    args = item.arguments ?? item.args ?? item.input ?? item.parameters ?? null;
    // Also check nested tool object
    if (!args && item.tool && typeof item.tool === 'object') {
      const toolObj = item.tool as any;
      args = toolObj.arguments ?? toolObj.args ?? toolObj.input ?? null;
    }
  }

  // Extract result/output for completed items
  let result: any = null;
  if (eventType === 'item.completed') {
    result = item.result ?? item.output ?? item.aggregated_output ?? null;
  }

  // Extract file paths
  const argPaths = extractFilePathsFromArgs(args, workspacePath);
  const outputPaths = extractFilePathsFromOutput(result);
  const allPaths = [...new Set([...argPaths, ...outputPaths])];

  // Get item ID and tool use ID
  const itemId = typeof item.id === 'string' ? item.id : null;
  const toolUseId = typeof item.tool_use_id === 'string' ? item.tool_use_id :
    typeof item.id === 'string' ? item.id : null;

  windows.push({
    messageId,
    messageCreatedAt: createdAt.getTime(),
    sessionId,
    toolName,
    toolCallItemId: itemId,
    toolUseId,
    filePaths: allPaths,
    outputText: stringifyOutput(result),
  });

  return windows;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

interface MatchCandidate {
  window: ToolCallWindow;
  score: number;
  reasons: string[];
}

/** Exported for testing */
export function scoreMatch(
  filePath: string,
  fileTimestamp: number,
  window: ToolCallWindow,
  fileMetadataToolUseId?: string
): MatchCandidate | null {
  let score = 0;
  const reasons: string[] = [];

  // 1. Direct toolUseId match - definitive, bypasses time cutoff
  if (fileMetadataToolUseId && window.toolUseId && fileMetadataToolUseId === window.toolUseId) {
    score += 100;
    reasons.push('toolUseId');
    return { window, score, reasons };
  }

  // 2. Time cutoff - hard filter, not a score adjustment.
  //    File edit must be within 10s before tool call start or 10s after tool result end.
  const toolTime = window.messageCreatedAt;
  const timeDiff = Math.abs(fileTimestamp - toolTime);
  if (timeDiff > TIME_CUTOFF_MS) {
    return null; // Outside time window, not a candidate
  }

  // 3. Filename in tool input (arguments) - basename match only
  const fileName = path.basename(filePath);
  const nameInArgs = window.filePaths.some(p => path.basename(p) === fileName);
  if (nameInArgs) {
    score += 40;
    reasons.push('name_in_args');
  }

  // 4. Filename in tool output
  if (window.outputText && window.outputText.includes(fileName)) {
    score += 30;
    reasons.push('name_in_output');
  }

  return { window, score, reasons };
}

// ---------------------------------------------------------------------------
// ToolCallMatcher class
// ---------------------------------------------------------------------------

class ToolCallMatcherImpl {
  /**
   * Match all unmatched session_files entries for a session.
   * Returns the number of new matches created.
   */
  async matchSession(sessionId: string): Promise<number> {
    try {
      if (!database.isInitialized()) {
        await database.initialize();
      }

      // 1. Load edited session_files
      const filesResult = await database.query<SessionFileRow>(
        `SELECT id, file_path, timestamp, metadata
         FROM session_files
         WHERE session_id = $1 AND link_type = 'edited'`,
        [sessionId]
      );
      const sessionFiles = filesResult.rows;
      if (sessionFiles.length === 0) return 0;

      // 2. Get workspace path from first file (for bash parsing)
      const workspacePath = this.inferWorkspacePath(sessionFiles[0].file_path);

      // 3. Load output messages
      const messagesResult = await database.query<AgentMessageRow>(
        `SELECT id, content, created_at
         FROM ai_agent_messages
         WHERE session_id = $1 AND direction = 'output' AND hidden = FALSE
         ORDER BY id ASC`,
        [sessionId]
      );

      // 4. Parse tool call windows from messages
      const windows: ToolCallWindow[] = [];
      for (const msg of messagesResult.rows) {
        const msgWindows = parseToolCallWindows(
          ensureNumber(msg.id),
          msg.content,
          msg.created_at instanceof Date ? msg.created_at : new Date(msg.created_at),
          sessionId,
          workspacePath
        );
        windows.push(...msgWindows);
      }

      if (windows.length === 0) return 0;

      // 5. Load existing matches to avoid re-processing
      const existingResult = await database.query<{ session_file_id: string }>(
        `SELECT session_file_id FROM ai_tool_call_file_edits WHERE session_id = $1`,
        [sessionId]
      );
      const alreadyMatched = new Set(existingResult.rows.map(r => r.session_file_id));

      // 6. Match each unmatched file
      const matches: Array<{
        sessionId: string;
        sessionFileId: string;
        messageId: number;
        toolCallItemId: string | null;
        toolUseId: string | null;
        score: number;
        reason: string;
        fileTimestamp: number;
      }> = [];

      for (const file of sessionFiles) {
        if (alreadyMatched.has(file.id)) continue;

        const fileTimestamp = file.timestamp instanceof Date
          ? file.timestamp.getTime()
          : new Date(file.timestamp).getTime();

        const metadataToolUseId = file.metadata?.toolUseId;

        // Score against all windows (scoreMatch returns null for time-cutoff failures)
        const candidates = windows
          .map(w => scoreMatch(file.file_path, fileTimestamp, w, metadataToolUseId))
          .filter((c): c is MatchCandidate => c !== null && c.score >= MIN_MATCH_SCORE);

        // Pick the best match
        const best = candidates.sort((a, b) => b.score - a.score)[0];

        if (best) {
          matches.push({
            sessionId,
            sessionFileId: file.id,
            messageId: best.window.messageId,
            toolCallItemId: best.window.toolCallItemId,
            toolUseId: best.window.toolUseId,
            score: best.score,
            reason: `${best.reasons.join(',')}|score=${best.score}|tool=${best.window.toolName}`,
            fileTimestamp,
          });
        }
      }

      if (matches.length > 0) {
        await this.insertMatchesBatch(matches);
        logger.main.debug(`[ToolCallMatcher] Matched ${matches.length} files for session ${sessionId}`);
      }

      return matches.length;
    } catch (error) {
      logger.main.error('[ToolCallMatcher] matchSession failed:', error);
      return 0;
    }
  }

  /**
   * Get all matches for a session.
   */
  async getMatchesForSession(sessionId: string): Promise<ToolCallFileEdit[]> {
    try {
      if (!database.isInitialized()) {
        await database.initialize();
      }

      const result = await database.query<ToolCallMatchRow>(
        `SELECT id, session_id, session_file_id, message_id,
                tool_call_item_id, tool_use_id, match_score, match_reason, file_timestamp, created_at
         FROM ai_tool_call_file_edits
         WHERE session_id = $1
         ORDER BY id ASC`,
        [sessionId]
      );

      return result.rows.map(row => this.mapRowToToolCallFileEdit(row));
    } catch (error) {
      logger.main.error('[ToolCallMatcher] getMatchesForSession failed:', error);
      return [];
    }
  }

  /**
   * Get match for a specific session file.
   */
  async getMatchForFile(sessionFileId: string): Promise<ToolCallFileEdit | null> {
    try {
      if (!database.isInitialized()) {
        await database.initialize();
      }

      const result = await database.query<ToolCallMatchRow>(
        `SELECT id, session_id, session_file_id, message_id,
                tool_call_item_id, tool_use_id, match_score, match_reason, file_timestamp, created_at
         FROM ai_tool_call_file_edits
         WHERE session_file_id = $1
         LIMIT 1`,
        [sessionFileId]
      );

      if (result.rows.length === 0) return null;

      const row = result.rows[0];
      return this.mapRowToToolCallFileEdit(row);
    } catch (error) {
      logger.main.error('[ToolCallMatcher] getMatchForFile failed:', error);
      return null;
    }
  }

  /**
   * Get file diffs caused by a specific tool call.
   * Looks up matches by tool_call_item_id, then extracts diff data from
   * the raw ai_agent_messages content (tool arguments).
   */
  async getDiffsForToolCall(
    sessionId: string,
    toolCallItemId: string
  ): Promise<ToolCallDiffResult[]> {
    try {
      if (!database.isInitialized()) {
        await database.initialize();
      }

      // 1. Find matches for this tool call
      const matchResult = await database.query<{
        session_file_id: string;
        message_id: number;
        match_reason: string;
      }>(
        `SELECT session_file_id, message_id, match_reason
         FROM ai_tool_call_file_edits
         WHERE session_id = $1 AND tool_call_item_id = $2`,
        [sessionId, toolCallItemId]
      );

      if (matchResult.rows.length === 0) return [];

      // 2. Get session_files metadata for each match
      const fileIds = matchResult.rows.map(r => r.session_file_id);
      const filesResult = await database.query<{
        id: string;
        file_path: string;
        metadata: any;
      }>(
        `SELECT id, file_path, metadata
         FROM session_files
         WHERE id = ANY($1)`,
        [fileIds]
      );

      const filesById = new Map<string, { filePath: string; metadata: any }>();
      for (const row of filesResult.rows) {
        filesById.set(row.id, {
          filePath: row.file_path,
          metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata || {}),
        });
      }

      // 3. Get the raw ai_agent_messages content for the matched message(s)
      const messageIds = [...new Set(matchResult.rows.map(r => r.message_id))];
      const msgResult = await database.query<{
        id: number;
        content: string;
      }>(
        `SELECT id, content
         FROM ai_agent_messages
         WHERE id = ANY($1)`,
        [messageIds]
      );

      const messagesById = new Map<number, string>();
      for (const row of msgResult.rows) {
        const id = ensureNumber(row.id);
        messagesById.set(id, row.content);
      }

      // 4. Build diff results
      const results: ToolCallDiffResult[] = [];

      for (const match of matchResult.rows) {
        const fileInfo = filesById.get(match.session_file_id);
        if (!fileInfo) continue;

        const msgId = ensureNumber(match.message_id);
        const rawContent = messagesById.get(msgId);
        const operation = fileInfo.metadata?.operation || 'edit';

        const diffResult: ToolCallDiffResult = {
          filePath: fileInfo.filePath,
          operation,
          diffs: [],
          linesAdded: fileInfo.metadata?.linesAdded,
          linesRemoved: fileInfo.metadata?.linesRemoved,
        };

        // Try to extract diff data from the raw message content
        if (rawContent) {
          const extracted = this.extractDiffsFromMessageContent(rawContent, fileInfo.filePath);
          if (extracted.diffs.length > 0) {
            diffResult.diffs = extracted.diffs;
          }
          if (extracted.content) {
            diffResult.content = extracted.content;
          }
        }

        results.push(diffResult);
      }

      return results;
    } catch (error) {
      logger.main.error('[ToolCallMatcher] getDiffsForToolCall failed:', error);
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Map a database row to a ToolCallFileEdit object.
   */
  private mapRowToToolCallFileEdit(row: ToolCallMatchRow): ToolCallFileEdit {
    return {
      id: ensureNumber(row.id),
      sessionId: row.session_id,
      sessionFileId: row.session_file_id,
      messageId: ensureNumber(row.message_id),
      toolCallItemId: row.tool_call_item_id,
      toolUseId: row.tool_use_id,
      matchScore: ensureNumber(row.match_score),
      matchReason: row.match_reason || '',
      fileTimestamp: row.file_timestamp ? (row.file_timestamp instanceof Date ? row.file_timestamp : new Date(row.file_timestamp)) : null,
      createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
    };
  }

  /**
   * Extract diff data from a raw ai_agent_messages content string.
   * Parses the JSON to find tool arguments containing old_string/new_string,
   * content (for Write), or other diff-relevant fields.
   */
  private extractDiffsFromMessageContent(
    content: string,
    targetFilePath: string
  ): { diffs: Array<{ oldString: string; newString: string }>; content?: string } {
    try {
      const parsed = JSON.parse(content);

      // Determine tool arguments based on message format
      let args: any = null;
      let itemForChanges: any = null;

      if (parsed?.item) {
        // Claude Code SDK format: {"type":"item.completed","item":{...}}
        const item = parsed.item;
        args = item.arguments ?? item.args ?? item.input ?? item.parameters ?? null;
        itemForChanges = item;
      } else if (parsed?.message?.content && Array.isArray(parsed.message.content)) {
        // Raw Claude API format: {"type":"assistant","message":{"content":[{"type":"tool_use","input":{...}}]}}
        // Find the tool_use block that targets our file
        for (const block of parsed.message.content) {
          if (block?.type === 'tool_use' && block.input) {
            const blockArgs = block.input;
            const blockFilePath = blockArgs.file_path || blockArgs.filePath || blockArgs.path || blockArgs.notebook_path;
            if (blockFilePath && typeof blockFilePath === 'string') {
              const normalizedBlock = path.normalize(blockFilePath);
              const normalizedTarget = path.normalize(targetFilePath);
              if (normalizedBlock === normalizedTarget) {
                args = blockArgs;
                break;
              }
            } else if (!blockFilePath) {
              // No file path in args - could be a bash command or other tool
              args = blockArgs;
            }
          }
        }
      }

      if (!args || typeof args !== 'object') return { diffs: [] };

      // Check if this tool call targets the right file
      const toolFilePath = args.file_path || args.filePath || args.path || args.notebook_path;

      // For MCP tools with file_path arg, verify it matches our target
      if (toolFilePath && typeof toolFilePath === 'string') {
        const normalizedTool = path.normalize(toolFilePath);
        const normalizedTarget = path.normalize(targetFilePath);
        if (normalizedTool !== normalizedTarget) {
          return { diffs: [] };
        }
      }

      // Extract Edit-style diffs (old_string / new_string)
      if (args.old_string !== undefined || args.new_string !== undefined) {
        return {
          diffs: [{
            oldString: args.old_string || '',
            newString: args.new_string || '',
          }],
        };
      }

      // Extract Write-style content (full file creation)
      if (typeof args.content === 'string' && args.content.length > 0) {
        return { diffs: [], content: args.content };
      }

      // Multi-edit: replacements array
      if (Array.isArray(args.replacements)) {
        const diffs = args.replacements
          .filter((r: any) => r && (r.oldText || r.old_text || r.newText || r.new_text))
          .map((r: any) => ({
            oldString: r.oldText || r.old_text || '',
            newString: r.newText || r.new_text || '',
          }));
        if (diffs.length > 0) return { diffs };
      }

      // file_change: check for content in changes array
      if (itemForChanges && Array.isArray(itemForChanges.changes)) {
        for (const change of itemForChanges.changes) {
          if (change.path === targetFilePath && typeof change.content === 'string') {
            return { diffs: [], content: change.content };
          }
        }
      }

      return { diffs: [] };
    } catch {
      return { diffs: [] };
    }
  }

  private async insertMatchesBatch(
    matches: Array<{
      sessionId: string;
      sessionFileId: string;
      messageId: number;
      toolCallItemId: string | null;
      toolUseId: string | null;
      score: number;
      reason: string;
      fileTimestamp: number;
    }>
  ): Promise<void> {
    if (matches.length === 0) return;

    const values: any[] = [];
    const placeholders: string[] = [];
    let paramIdx = 1;

    for (const m of matches) {
      const fileTs = m.fileTimestamp ? new Date(m.fileTimestamp) : null;
      placeholders.push(`($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, $${paramIdx + 5}, $${paramIdx + 6}, $${paramIdx + 7})`);
      values.push(m.sessionId, m.sessionFileId, m.messageId, m.toolCallItemId, m.toolUseId, m.score, m.reason, fileTs);
      paramIdx += 8;
    }

    await database.query(
      `INSERT INTO ai_tool_call_file_edits
       (session_id, session_file_id, message_id, tool_call_item_id, tool_use_id, match_score, match_reason, file_timestamp)
       VALUES ${placeholders.join(', ')}
       ON CONFLICT (session_file_id, message_id) DO UPDATE SET
         match_score = EXCLUDED.match_score,
         match_reason = EXCLUDED.match_reason,
         file_timestamp = EXCLUDED.file_timestamp`,
      values
    );
  }

  private async insertMatch(
    sessionId: string,
    sessionFileId: string,
    messageId: number,
    toolCallItemId: string | null,
    toolUseId: string | null,
    matchScore: number,
    matchReason: string,
    fileTimestamp?: number
  ): Promise<void> {
    const fileTs = fileTimestamp ? new Date(fileTimestamp) : null;
    await database.query(
      `INSERT INTO ai_tool_call_file_edits
       (session_id, session_file_id, message_id, tool_call_item_id, tool_use_id, match_score, match_reason, file_timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (session_file_id, message_id) DO UPDATE SET
         match_score = EXCLUDED.match_score,
         match_reason = EXCLUDED.match_reason,
         file_timestamp = EXCLUDED.file_timestamp`,
      [sessionId, sessionFileId, messageId, toolCallItemId, toolUseId, matchScore, matchReason, fileTs]
    );
  }

  /**
   * Infer workspace path from a file path by going up to a reasonable root.
   * Uses heuristic: find the path component before the first src/ or packages/ or lib/ etc.
   */
  private inferWorkspacePath(filePath: string): string {
    // Simple heuristic: go up directories until we hit a common root indicator
    const parts = filePath.split(path.sep);
    const markers = ['src', 'packages', 'lib', 'node_modules', '.git'];
    for (let i = 0; i < parts.length; i++) {
      if (markers.includes(parts[i])) {
        return parts.slice(0, i).join(path.sep);
      }
    }
    // Fallback: use the directory two levels up from the file
    return path.dirname(path.dirname(filePath));
  }
}

export const toolCallMatcher = new ToolCallMatcherImpl();
