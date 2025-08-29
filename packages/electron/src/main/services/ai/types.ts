/**
 * Common types for AI provider abstraction
 */

export interface DocumentContext {
  filePath: string;
  fileType: string;
  content: string;
  cursorPosition?: { line: number; column: number };
  selection?: { 
    start: { line: number; column: number }; 
    end: { line: number; column: number } 
  };
}

export interface Message {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: number;
  // Additional fields for rich message types
  edits?: any[];
  toolCall?: {
    name: string;
    arguments?: any;
    result?: any;
  };
  isStreamingStatus?: boolean;
  streamingData?: {
    position: string;
    mode: string;
    content: string;
    isActive: boolean;
  };
}

export interface SessionData {
  id: string;  // Our session ID
  provider: 'claude' | 'claude-code';  // Provider type, locked per session
  timestamp: number;
  messages: Message[];
  documentContext?: DocumentContext;
  projectPath?: string;
  name?: string;
  title?: string;
  draftInput?: string;
  
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
}

export interface ProviderCapabilities {
  streaming: boolean;
  tools: boolean;
  mcpSupport: boolean;
  edits: boolean;
  resumeSession: boolean;
}

export interface StreamChunk {
  type: 'text' | 'tool_call' | 'error' | 'complete' | 'stream_edit_start' | 'stream_edit_content' | 'stream_edit_end';
  content?: string;
  toolCall?: {
    name: string;
    arguments?: any;
    result?: any;
  };
  error?: string;
  isComplete?: boolean;
  config?: any; // For stream_edit_start
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
  applyDiff(args: DiffArgs): Promise<DiffResult>;
  // Other common tools can be added here
}