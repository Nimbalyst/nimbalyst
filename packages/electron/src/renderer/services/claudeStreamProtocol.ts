import { logger } from '../utils/logger';

/**
 * Protocol for handling streaming edits from Claude
 * 
 * Claude can signal streaming mode by including special markers in its response:
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
 * Detects if a Claude response contains streaming markers
 */
export function detectStreamingIntent(content: string): {
  isStreaming: boolean;
  streamConfig?: {
    position: string;
    mode: 'extend' | 'after';
  };
  cleanContent: string;
} {
  logger.log('protocol', 'Detecting streaming intent in content:', {
    length: content.length,
    first100: content.substring(0, 100),
    startsWithHTML: content.startsWith('<!--'),
    startsWithAt: content.startsWith('@'),
    hasStreamEdit: content.includes('STREAM_EDIT'),
    hasStreamToEditor: content.includes('stream-to-editor')
  });
  
  // Look for streaming directive at the start of the response
  const streamingPattern = /^<!--\s*STREAM_EDIT:\s*(.+?)\s*-->\n?/;
  const match = content.match(streamingPattern);
  
  if (match) {
    logger.log('protocol', 'Found STREAM_EDIT marker:', match[0]);
    try {
      const config = JSON.parse(match[1]);
      logger.log('protocol', 'Parsed config:', config);
      return {
        isStreaming: true,
        streamConfig: config,
        cleanContent: content.replace(streamingPattern, '')
      };
    } catch (e) {
      logger.log('protocol', 'Failed to parse streaming config:', e);
    }
  }
  
  // Alternative: Check for MCP-style directive
  const mcpPattern = /^@stream-to-editor\s+(.+?)\n/;
  const mcpMatch = content.match(mcpPattern);
  
  if (mcpMatch) {
    logger.log('protocol', 'Found @stream-to-editor marker:', mcpMatch[0]);
    const params = mcpMatch[1].split(/\s+/);
    const config = {
      position: params[0] || 'cursor',
      mode: (params[1] as 'extend' | 'after') || 'after'
    };
    logger.log('protocol', 'Parsed MCP config:', config);
    return {
      isStreaming: true,
      streamConfig: config,
      cleanContent: content.replace(mcpPattern, '')
    };
  }
  
  logger.log('protocol', 'No streaming markers found');
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
        logger.log('protocol', 'Failed to parse stream metadata:', e);
      }
    }
  }
  
  // Otherwise treat as content
  return { type: 'content', data: chunk };
}

/**
 * Creates a streaming edit request that Claude can recognize
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