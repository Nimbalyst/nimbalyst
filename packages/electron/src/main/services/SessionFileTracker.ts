/**
 * Session File Tracker
 * Automatically tracks file interactions during AI sessions
 *
 * This service ensures that files modified by agents are:
 * 1. Tracked in the session_files database
 * 2. Have file watchers attached for change detection
 * 3. Have their tracker items/metadata refreshed in the document service
 */

import { BrowserWindow } from 'electron';
import { SessionFilesRepository } from '@nimbalyst/runtime';
import type { FileLinkType, EditedFileMetadata, ReadFileMetadata, ReferencedFileMetadata } from '@nimbalyst/runtime/ai/server/types';
import { parseBashForFileOps } from '@nimbalyst/runtime/ai/server/providers/bashUtils';
import { logger } from '../utils/logger';
import { startFileWatcher } from '../file/FileWatcher';
import { documentServices } from '../window/WindowManager';

/**
 * Extract file mentions from user messages
 * Matches patterns like @filename.ext or @path/to/file.ext
 */
function extractFileMentions(message: string): string[] {
  // Match @filename.ext or @path/to/file.ext
  const regex = /@([^\s@]+\.[a-zA-Z0-9]+|[^\s@]+\/[^\s@]*)/g;
  const matches: string[] = [];
  let match;

  while ((match = regex.exec(message)) !== null) {
    const filePath = match[1];
    if (filePath && !matches.includes(filePath)) {
      matches.push(filePath);
    }
  }

  return matches;
}

/**
 * Determine link type based on tool name
 */
function getLinkTypeForTool(toolName: string): FileLinkType | null {
  const editTools = ['Write', 'Edit', 'NotebookEdit', 'writeFile', 'editFile', 'applyDiff', 'streamContent', 'Bash'];
  const readTools = ['Read', 'Glob', 'Grep', 'readFile', 'searchFiles', 'listFiles', 'getDocumentContent'];

  if (editTools.includes(toolName)) {
    return 'edited';
  }
  if (readTools.includes(toolName)) {
    return 'read';
  }

  return null;
}

/**
 * Extract file path(s) from tool arguments
 * Returns the first file path found, or null if none
 * For Bash commands, this will be handled separately by extractBashFilePaths
 */
function extractFilePathFromArgs(toolName: string, args: any): string | null {
  if (!args) return null;

  // Common patterns for file paths in tool arguments
  const pathFields = [
    'file_path',
    'filePath',
    'path',
    'notebook_path',
    'notebookPath'
  ];

  for (const field of pathFields) {
    if (args[field] && typeof args[field] === 'string') {
      return args[field];
    }
  }

  return null;
}

/**
 * Extract file paths from Bash command
 * Uses the same parser from ClaudeCodeProvider to detect file operations
 */
function extractBashFilePaths(command: string, workspaceId: string): string[] {
  return parseBashForFileOps(command, workspaceId);
}

/**
 * Extract metadata for edited files
 */
function extractEditMetadata(toolName: string, args: any, result: any): EditedFileMetadata {
  const metadata: EditedFileMetadata = {
    toolName
  };

  // Determine operation type
  if (toolName === 'Write' || toolName === 'writeFile') {
    metadata.operation = 'create';
  } else if (toolName === 'Edit' || toolName === 'editFile' || toolName === 'applyDiff') {
    metadata.operation = 'edit';
  } else if (toolName === 'Bash') {
    // For Bash, store the command for reference
    metadata.operation = 'bash';
    if (args?.command) {
      metadata.bashCommand = args.command.slice(0, 200); // Store first 200 chars
    }
  }

  // Try to extract line counts from result
  if (result && typeof result === 'object') {
    if (typeof result.linesAdded === 'number') {
      metadata.linesAdded = result.linesAdded;
    }
    if (typeof result.linesRemoved === 'number') {
      metadata.linesRemoved = result.linesRemoved;
    }
  }

  return metadata;
}

/**
 * Extract metadata for read files
 */
function extractReadMetadata(toolName: string, args: any, result: any): ReadFileMetadata {
  const metadata: ReadFileMetadata = {
    toolName
  };

  // Check if it was a partial read
  if (args) {
    metadata.wasPartial = !!(args.limit || args.offset);
  }

  // Try to extract bytes read from result
  if (result && typeof result === 'string') {
    metadata.bytesRead = Buffer.byteLength(result, 'utf8');
  }

  return metadata;
}

export class SessionFileTracker {
  private enabled = true;

  /**
   * Track a tool execution and create appropriate file links.
   * For edited files, also ensures a file watcher is attached to detect
   * subsequent changes (including changes from concurrent AI sessions or
   * external editors).
   *
   * @param sessionId - The AI session ID
   * @param workspaceId - The workspace path
   * @param toolName - Name of the tool that was executed
   * @param args - Tool arguments (used to extract file path)
   * @param result - Tool execution result
   * @param window - Optional BrowserWindow to attach file watchers for edited files
   */
  async trackToolExecution(
    sessionId: string,
    workspaceId: string,
    toolName: string,
    args: any,
    result: any,
    window?: BrowserWindow | null
  ): Promise<void> {
    // console.log('[SessionFileTracker] trackToolExecution called:', { sessionId, workspaceId, toolName, enabled: this.enabled });

    if (!this.enabled) {
      // console.log('[SessionFileTracker] Tracking disabled, returning');
      return;
    }

    try {
      const linkType = getLinkTypeForTool(toolName);
      // console.log('[SessionFileTracker] Link type for tool:', { toolName, linkType });

      if (!linkType) {
        // Tool doesn't interact with files
        // console.log('[SessionFileTracker] Tool does not interact with files');
        return;
      }

      // Special handling for Bash commands - extract all affected files from the command
      if (toolName === 'Bash') {
        const command = args?.command;
        if (!command || typeof command !== 'string') {
          logger.main.debug('[SessionFileTracker] No command found in Bash args');
          return;
        }

        const filePaths = extractBashFilePaths(command, workspaceId);
        // console.log('[SessionFileTracker] Extracted Bash file paths:', filePaths);

        if (filePaths.length === 0) {
          logger.main.debug('[SessionFileTracker] No file operations detected in Bash command');
          return;
        }

        // Track each affected file
        for (const filePath of filePaths) {
          await this.trackSingleFile(sessionId, workspaceId, filePath, linkType, toolName, args, result, window);
        }
        return;
      }

      // For non-Bash tools, extract single file path from args
      const filePath = extractFilePathFromArgs(toolName, args);
      // console.log('[SessionFileTracker] Extracted file path:', { toolName, filePath, args });

      if (!filePath) {
        logger.main.debug(`[SessionFileTracker] No file path found in ${toolName} args`);
        // console.log('[SessionFileTracker] No file path found in args');
        return;
      }

      await this.trackSingleFile(sessionId, workspaceId, filePath, linkType, toolName, args, result, window);
    } catch (error) {
      logger.main.error('[SessionFileTracker] Failed to track tool execution:', error);
      console.error('[SessionFileTracker] Error details:', error);
      // Don't throw - tracking failures shouldn't break AI operations
    }
  }

  /**
   * Track a single file link
   * Extracted as a separate method to handle both single-file and multi-file (Bash) tracking
   */
  private async trackSingleFile(
    sessionId: string,
    workspaceId: string,
    filePath: string,
    linkType: FileLinkType,
    toolName: string,
    args: any,
    result: any,
    window?: BrowserWindow | null
  ): Promise<void> {
    try {

      // Prepare metadata based on link type
      let metadata: any = {};
      if (linkType === 'edited') {
        metadata = extractEditMetadata(toolName, args, result);

        // Ensure file watcher is attached for edited files
        // This is critical for detecting subsequent changes, even for files
        // beyond the 5000 file limit in the file tree
        // console.log(`[SessionFileTracker] Edited file detected: ${filePath}, window provided: ${!!window}, window destroyed: ${window?.isDestroyed?.()}`);
        if (window && !window.isDestroyed()) {
          try {
            await startFileWatcher(window, filePath);
            // console.log(`[SessionFileTracker] Started file watcher for edited file: ${filePath}`);
          } catch (watchError) {
            // Log but don't fail - file watcher is not critical for tracking
            console.error(`[SessionFileTracker] Failed to start file watcher for ${filePath}:`, watchError);
          }
        } else {
          console.warn(`[SessionFileTracker] Cannot start file watcher - no valid window for: ${filePath}`);
        }

        // Refresh tracker items/metadata for the edited file
        // This ensures plan frontmatter and inline trackers (#bug, #task, etc.)
        // are immediately visible in the tracker UI
        const documentService = documentServices.get(workspaceId);
        if (documentService) {
          try {
            await documentService.refreshFileMetadata(filePath);
            // console.log(`[SessionFileTracker] Refreshed tracker/metadata for: ${filePath}`);
          } catch (refreshError) {
            // Log but don't fail - metadata refresh is not critical for tracking
            console.error(`[SessionFileTracker] Failed to refresh metadata for ${filePath}:`, refreshError);
          }
        } else {
          console.warn(`[SessionFileTracker] No document service found for workspace: ${workspaceId}`);
        }
      } else if (linkType === 'read') {
        metadata = extractReadMetadata(toolName, args, result);
      }

      // console.
      // '[SessionFileTracker] About to add file link:', {
      //   sessionId,
      //   workspaceId,
      //   filePath,
      //   linkType,
      //   metadata
      // });

      // Add file link to database
      const addedLink = await SessionFilesRepository.addFileLink({
        sessionId,
        workspaceId,
        filePath,
        linkType,
        timestamp: Date.now(),
        metadata
      });

      // console.log('[SessionFileTracker] File link added successfully:', addedLink);
      logger.main.debug(`[SessionFileTracker] Tracked ${linkType} link: ${filePath}`);
    } catch (error) {
      logger.main.error('[SessionFileTracker] Failed to track tool execution:', error);
      console.error('[SessionFileTracker] Error details:', error);
      // Don't throw - tracking failures shouldn't break AI operations
    }
  }

  /**
   * Track file references from user messages
   */
  async trackUserMessage(
    sessionId: string,
    workspaceId: string,
    messageContent: string,
    messageIndex: number
  ): Promise<void> {
    if (!this.enabled) return;

    try {
      const mentions = extractFileMentions(messageContent);

      for (const filePath of mentions) {
        // Resolve to absolute path if relative
        const resolvedPath = filePath.startsWith('/')
          ? filePath
          : `${workspaceId}/${filePath}`;

        // Only track if file exists
        const { existsSync } = await import('fs');
        if (!existsSync(resolvedPath)) {
          logger.main.debug(`[SessionFileTracker] Skipping non-existent @mention: ${filePath}`);
          continue;
        }

        const metadata: ReferencedFileMetadata = {
          mentionContext: messageContent.substring(0, 200), // Store first 200 chars for context
          messageIndex
        };

        await SessionFilesRepository.addFileLink({
          sessionId,
          workspaceId,
          filePath: resolvedPath,
          linkType: 'referenced',
          timestamp: Date.now(),
          metadata
        });

        logger.main.debug(`[SessionFileTracker] Tracked referenced file: ${resolvedPath}`);
      }
    } catch (error) {
      logger.main.error('[SessionFileTracker] Failed to track user message:', error);
      // Don't throw - tracking failures shouldn't break AI operations
    }
  }

  /**
   * Enable or disable file tracking
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    logger.main.info(`[SessionFileTracker] File tracking ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Check if tracking is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }
}

// Export singleton instance
export const sessionFileTracker = new SessionFileTracker();
