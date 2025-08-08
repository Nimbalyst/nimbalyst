interface DocumentContext {
  filePath: string;
  fileType: string;
  content: string;
  cursorPosition?: { line: number; column: number };
  selection?: { start: { line: number; column: number }; end: { line: number; column: number } };
}

interface EditRequest {
  type: 'edit' | 'insert' | 'delete' | 'replace';
  file: string;
  range: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
  content: string;
  preview: boolean;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  edits?: EditRequest[];
}

interface Session {
  id: string;
  timestamp: number;
  messages: Message[];
  documentContext?: DocumentContext;
}

class ClaudeAPI {
  private listeners: Map<string, Set<Function>> = new Map();

  constructor() {
    // Set up IPC listeners for streaming responses
    window.electronAPI.onClaudeStreamResponse((data: any) => {
      this.emit('streamResponse', data);
    });

    window.electronAPI.onClaudeEditRequest((edit: EditRequest) => {
      this.emit('editRequest', edit);
    });
  }

  async initialize(apiKey?: string): Promise<{ success: boolean }> {
    return window.electronAPI.claudeInitialize(apiKey);
  }

  async createSession(documentContext?: DocumentContext): Promise<Session> {
    return window.electronAPI.claudeCreateSession(documentContext);
  }

  async sendMessage(
    message: string, 
    documentContext?: DocumentContext
  ): Promise<{ content: string; edits: EditRequest[] }> {
    return window.electronAPI.claudeSendMessage(message, documentContext);
  }

  async getSessions(): Promise<Session[]> {
    return window.electronAPI.claudeGetSessions();
  }

  async loadSession(sessionId: string): Promise<Session> {
    return window.electronAPI.claudeLoadSession(sessionId);
  }

  async clearSession(): Promise<{ success: boolean }> {
    return window.electronAPI.claudeClearSession();
  }

  async applyEdit(edit: EditRequest): Promise<{ success: boolean }> {
    return window.electronAPI.claudeApplyEdit(edit);
  }

  // Event handling
  on(event: string, callback: Function) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }

  off(event: string, callback: Function) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.delete(callback);
    }
  }

  private emit(event: string, data: any) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach(callback => callback(data));
    }
  }
}

export const claudeApi = new ClaudeAPI();
export type { DocumentContext, EditRequest, Message, Session };