/**
 * Common types for AI provider abstraction
 */

import type { ToolDefinition } from '../tools';
export type { ToolDefinition } from '../tools';

export interface DocumentContext {
  filePath?: string;
  fileType?: string;
  content: string;
  cursorPosition?: { line: number; column: number };
  selection?:
    | string
    | {
        start: { line: number; column: number };
        end: { line: number; column: number };
      };
}

export interface ChatAttachment {
  id: string;
  filename: string;
  filepath: string;
  mimeType: string;
  size: number;
  type: 'image' | 'pdf' | 'document';
  thumbnail?: string;
  addedAt: number;
}

export interface Message {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  timestamp: number;
  // Additional fields for rich message types
  edits?: any[];
  toolCall?: {
    id?: string;
    name: string;
    arguments?: any;
    result?: any;
    targetFilePath?: string;  // File path this tool call was executed against
  };
  isError?: boolean;
  errorMessage?: string;
  isThinking?: boolean;
  isSystem?: boolean; // For system messages like slash command output
  isStreamingStatus?: boolean;
  streamingData?: {
    position: string;
    mode: string;
    content: string;
    isActive: boolean;
  };
  tokenUsage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
  attachments?: ChatAttachment[];
}

export type AIProviderType = 'claude' | 'claude-code' | 'openai' | 'openai-codex' | 'lmstudio';

export interface AIModel {
  id: string;           // e.g., 'gpt-4', 'claude-3-5-sonnet-20241022'
  name: string;         // e.g., 'GPT-4', 'Claude 3.5 Sonnet'
  provider: AIProviderType;
  maxTokens?: number;
  contextWindow?: number;
}

export type SessionType = 'chat' | 'planning' | 'coding';

export interface SessionData {
  id: string;  // Our session ID
  provider: AIProviderType | string;  // Provider type
  model?: string;  // Specific model used (e.g., 'gpt-4', 'claude-3-5-sonnet')
  sessionType?: SessionType;  // Type of session: 'chat', 'planning', 'coding'
  messages: Message[];
  documentContext?: DocumentContext;
  workspacePath?: string;
  name?: string;
  title?: string;
  draftInput?: string;

  // Time tracking
  createdAt: number;  // Creation timestamp
  updatedAt: number;  // Last update timestamp

  // Additional metadata
  metadata?: Record<string, unknown>;

  // Provider-specific data
  providerSessionId?: string;  // For Claude Code's internal session ID
  providerConfig?: {
    model?: string;
    apiKey?: string;  // If using per-session keys
  };
}

export interface ProviderConfig {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  baseUrl?: string;
  allowedTools?: string[];  // List of allowed tool names, ['*'] for all tools
}

export interface ProviderCapabilities {
  streaming: boolean;
  tools: boolean;
  mcpSupport: boolean;
  edits: boolean;
  resumeSession: boolean;
}

export interface ProviderSettings {
  enabled: boolean;
  apiKey?: string;
  models?: string[];  // List of enabled model IDs for this provider
  defaultModel?: string;
  baseUrl?: string;  // For custom endpoints
}

export interface StreamChunk {
  type: 'text' | 'tool_call' | 'tool_error' | 'error' | 'complete' | 'stream_edit_start' | 'stream_edit_content' | 'stream_edit_end';
  content?: string;
  isSystem?: boolean; // For system messages like slash command output
  toolCall?: {
    id?: string;
    name: string;
    arguments?: any;
    result?: any;
  };
  toolError?: {
    name: string;
    arguments?: any;
    error: string;
    result?: any;
  };
  error?: string;
  isComplete?: boolean;
  config?: any; // For stream_edit_start
  usage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
}

export interface DiffArgs {
  replacements: Array<{
    oldText: string;
    newText: string;
  }>;
}

export interface DiffResult {
  success: boolean;
  error?: string;
  appliedCount?: number;
}

export interface ToolHandler {
  // All methods are optional - handlers can implement any subset
  applyDiff?(args: DiffArgs): Promise<DiffResult>;
  // Stream content tool for real-time streaming
  streamContent?(args: any): Promise<any>;
  // File search tool
  searchFiles?(args: any): Promise<any>;
  // List files tool
  listFiles?(args: any): Promise<any>;
  // Read file tool
  readFile?(args: any): Promise<any>;
  // Write file tool
  writeFile?(args: any): Promise<any>;
  // Get document content
  getDocumentContent?(args: any): Promise<any>;
  // Update frontmatter
  updateFrontmatter?(args: any): Promise<any>;
  // Dynamic tool execution - for any other tool
  // Note: executeTool has different signature (name, args) so we handle it separately
  executeTool?(name: string, args: any): Promise<any>;
  // Dynamic property access for other tools
  [key: string]: ((args: any) => Promise<any>) | ((name: string, args: any) => Promise<any>) | undefined;
}

/**
 * File link types for tracking file interactions in AI sessions
 */
export type FileLinkType = 'edited' | 'referenced' | 'read';

/**
 * File link metadata structures for each link type
 */
export interface EditedFileMetadata {
  operation?: 'edit' | 'create' | 'delete' | 'rename';
  linesAdded?: number;
  linesRemoved?: number;
  toolName?: string;
}

export interface ReferencedFileMetadata {
  mentionContext?: string;
  messageIndex?: number;
}

export interface ReadFileMetadata {
  toolName?: string;
  bytesRead?: number;
  wasPartial?: boolean;
}

/**
 * Link between a file and an AI session
 */
export interface FileLink {
  id: string;
  sessionId: string;
  workspaceId: string;
  filePath: string;
  linkType: FileLinkType;
  timestamp: number;
  metadata?: EditedFileMetadata | ReferencedFileMetadata | ReadFileMetadata | Record<string, unknown>;
}
