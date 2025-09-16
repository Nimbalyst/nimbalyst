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
