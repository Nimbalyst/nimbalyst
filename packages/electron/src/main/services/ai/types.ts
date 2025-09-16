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
  isError?: boolean;
  errorMessage?: string;
  isStreamingStatus?: boolean;
  streamingData?: {
    position: string;
    mode: string;
    content: string;
    isActive: boolean;
  };
}

export type AIProviderType = 'claude' | 'claude-code' | 'openai' | 'lmstudio';

export interface AIModel {
  id: string;           // e.g., 'gpt-4', 'claude-3-5-sonnet-20241022'
  name: string;         // e.g., 'GPT-4', 'Claude 3.5 Sonnet'
  provider: AIProviderType;
  maxTokens?: number;
  contextWindow?: number;
}

export interface SessionData {
  id: string;  // Our session ID
  provider: AIProviderType;  // Provider type, locked per session
  model?: string;  // Specific model used (e.g., 'gpt-4', 'claude-3-5-sonnet')
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
  toolCall?: {
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

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
  handler?: (args: any) => Promise<any>;
  source?: 'main' | 'renderer'; // Where the tool executes
}

export interface ToolHandler {
  applyDiff(args: DiffArgs): Promise<DiffResult>;
  // Dynamic tool execution
  executeTool?(name: string, args: any): Promise<any>;
}
