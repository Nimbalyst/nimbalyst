/**
 * Session File Tracker
 * Automatically tracks file interactions during AI sessions
 */

import { SessionFilesRepository } from '@nimbalyst/runtime';
import type { FileLinkType, EditedFileMetadata, ReadFileMetadata, ReferencedFileMetadata } from '@nimbalyst/runtime/ai/server/types';
import { logger } from '../utils/logger';

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
  const editTools = ['Write', 'Edit', 'NotebookEdit', 'writeFile', 'editFile', 'applyDiff', 'streamContent'];
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
 * Extract file path from tool arguments
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
   * Track a tool execution and create appropriate file links
   */
  async trackToolExecution(
    sessionId: string,
    workspaceId: string,
    toolName: string,
    args: any,
    result: any
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

      const filePath = extractFilePathFromArgs(toolName, args);
      // console.log('[SessionFileTracker] Extracted file path:', { toolName, filePath, args });

      if (!filePath) {
        logger.main.debug(`[SessionFileTracker] No file path found in ${toolName} args`);
        // console.log('[SessionFileTracker] No file path found in args');
        return;
      }

      // Prepare metadata based on link type
      let metadata: any = {};
      if (linkType === 'edited') {
        metadata = extractEditMetadata(toolName, args, result);
      } else if (linkType === 'read') {
        metadata = extractReadMetadata(toolName, args, result);
      }

      // console.log('[SessionFileTracker] About to add file link:', {
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
