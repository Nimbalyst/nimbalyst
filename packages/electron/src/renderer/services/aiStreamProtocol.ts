import { logger } from '../utils/logger';

/**
 * Protocol for handling streaming edits from AI providers
 *
 * AI providers can signal streaming mode by including special markers in their response:
 * - STREAM_START: {position: "cursor" | "selection" | {line, column}, mode: "extend" | "after"}
 * - STREAM_CONTENT: markdown content to stream
 * - STREAM_END: signal end of streaming
 */

export interface StreamingEditRequest {
  type: 'stream';
  insertAfter?: string; // Text to search for and insert after (end of line)
  insertAtEnd?: boolean; // Insert at end of document
  mode: 'extend' | 'after'; // extend = modify existing, after = insert after
  content?: string; // Initial content if any
}

export interface StreamingEdit {
  id: string;
  status: 'pending' | 'streaming' | 'complete' | 'error';
  insertAfter?: string;
  insertAtEnd?: boolean;
  mode: 'extend' | 'after';
  content: string;
  error?: string;
}

/**
 * Detects if an AI response contains streaming markers
 */
export function detectStreamingIntent(content: string): {
  isStreaming: boolean;
  streamConfig?: {
    position: string;
    mode: 'extend' | 'after';
  };
  cleanContent: string;
} {
  logger.protocol.info('Detecting streaming intent in content:', {
    length: content.length,
    first100: content.substring(0, 100),
    startsWithHTML: content.startsWith('<!--'),
    startsWithAt: content.startsWith('@'),
    hasStreamEdit: content.includes('STREAM_EDIT'),
    hasStreamToEditor: content.includes('stream-to-editor')
  });

  // Look for streaming directive anywhere in the response (not just at start)
  const streamingPattern = /<!--\s*STREAM_EDIT:\s*(.+?)\s*-->/;
  const match = content.match(streamingPattern);

  if (match) {
    logger.protocol.info('Found STREAM_EDIT marker:', match[0]);
    try {
      const config = JSON.parse(match[1]);
      logger.protocol.info('Parsed config:', config);
      // Extract clean content - everything after the STREAM_EDIT marker
      const markerIndex = content.indexOf(match[0]);
      const afterMarker = content.substring(markerIndex + match[0].length);
      // Remove leading newline if present
      const cleanContent = afterMarker.replace(/^\n/, '');

      return {
        isStreaming: true,
        streamConfig: config,
        cleanContent: cleanContent
      };
    } catch (e) {
      logger.protocol.warn('Failed to parse streaming config:', e);
    }
  }

  // Alternative: Check for MCP-style directive
  const mcpPattern = /^@stream-to-editor\s+(.+?)\n/;
  const mcpMatch = content.match(mcpPattern);

  if (mcpMatch) {
    logger.protocol.info('Found @stream-to-editor marker:', mcpMatch[0]);
    const params = mcpMatch[1].split(/\s+/);
    const config = {
      position: params[0] || 'cursor',
      mode: (params[1] as 'extend' | 'after') || 'after'
    };
    logger.protocol.info('Parsed MCP config:', config);
    return {
      isStreaming: true,
      streamConfig: config,
      cleanContent: content.replace(mcpPattern, '')
    };
  }

  logger.protocol.info('No streaming markers found', content);
  return {
    isStreaming: false,
    cleanContent: content
  };
}

/**
 * Parses streaming chunks and extracts content
 */
export function parseStreamingChunk(chunk: string): {
  type: 'content' | 'metadata' | 'end';
  data?: any;
} {
  // Check for end marker
  if (chunk.includes('<!-- STREAM_END -->') || chunk.includes('@end-stream')) {
    return { type: 'end' };
  }

  // Check for metadata updates
  if (chunk.startsWith('<!-- STREAM_META:')) {
    const metaMatch = chunk.match(/<!-- STREAM_META:\s*(.+?)\s*-->/);
    if (metaMatch) {
      try {
        return { type: 'metadata', data: JSON.parse(metaMatch[1]) };
      } catch (e) {
        logger.protocol.warn('Failed to parse stream metadata:', e);
      }
    }
  }

  // Otherwise treat as content
  return { type: 'content', data: chunk };
}

/**
 * Creates a streaming edit request that AI providers can recognize
 */
export function createStreamingEditPrompt(
  action: string,
  position: 'cursor' | 'selection',
  mode: 'extend' | 'after'
): string {
  return `Please ${action} and stream the content directly into the editor at the ${position} using ${mode} mode.

When you want to stream content, start your response with:
<!-- STREAM_EDIT: {"position": "${position}", "mode": "${mode}"} -->

Then provide the markdown content to stream. End with:
<!-- STREAM_END -->`;
}
