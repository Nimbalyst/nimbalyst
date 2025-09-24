// AI Stream Response types - MUST match what UI expects!
export type AIStreamChunk =
  | { type: 'text'; content: string }  // Text content - MUST use 'content' not 'text'!
  | { type: 'complete'; content: string; isComplete: true; usage?: any }  // Completion
  | { type: 'error'; error: string }  // Error
  | { type: 'tool_call'; toolCall: any }  // Tool call
  | { type: 'tool_error'; toolError: any }  // Tool error
  | { type: 'stream_edit_start'; config: any }  // Stream edit start
  | { type: 'stream_edit_content'; content: string }  // Stream edit content
  | { type: 'stream_edit_end'; error?: string };  // Stream edit end

export type AIStreamResponse = AsyncIterableIterator<AIStreamChunk>;

export interface DocumentContext {
  filePath?: string;
  fileType?: string;
  content: string;
}

export type StreamingMode = 'extend' | 'after' | 'append' | 'replace' | 'insert';

export interface StreamingConfig {
  position?: 'cursor' | 'selection' | 'end' | 'after-selection';
  mode: StreamingMode;
  insertAfter?: string;
  insertAtEnd?: boolean;
}

export interface ProviderRequest {
  prompt: string;
  document?: DocumentContext;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
}

export interface ChatToolCall {
  id?: string;
  name: string;
  arguments?: any;
  result?: any;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: number;
  edits?: any[];
  toolCall?: ChatToolCall;
  isStreamingStatus?: boolean;
  streamingData?: {
    position: string;
    mode: string;
    content: string;
    isActive: boolean;
  };
  isError?: boolean;
  errorMessage?: string;
}

export interface ChatSession {
  id: string;
  provider: string;
  model?: string;
  title?: string;
  draftInput?: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

export type StreamEvent =
  | { type: 'start'; config: StreamingConfig }
  | { type: 'content'; chunk: string }
  | { type: 'end' }
  | { type: 'error'; error: string };

export interface StreamCallbacks {
  onStart?: (config: StreamingConfig) => void;
  onContent?: (chunk: string) => void;
  onEnd?: () => void;
  onError?: (err: unknown) => void;
}
