/**
 * EditorStateManager - Service for managing editor state
 * Extracted from App.tsx as part of Phase 2 refactoring
 */

interface EditorState {
  currentFilePath: string | null;
  currentFileName: string;
  isDirty: boolean;
  contentVersion: number;
}

type EditorListener = (state: EditorState) => void;

class EditorStateManager {
  private state: EditorState = {
    currentFilePath: null,
    currentFileName: 'Untitled',
    isDirty: false,
    contentVersion: 0,
  };

  private listeners: Set<EditorListener> = new Set();

  get currentFilePath(): string | null {
    return this.state.currentFilePath;
  }

  get currentFileName(): string {
    return this.state.currentFileName;
  }

  get isDirty(): boolean {
    return this.state.isDirty;
  }

  get contentVersion(): number {
    return this.state.contentVersion;
  }

  subscribe(listener: EditorListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    this.listeners.forEach(listener => listener(this.state));
  }

  setCurrentFile(path: string | null, name?: string): void {
    this.state = {
      ...this.state,
      currentFilePath: path,
      currentFileName: name || (path ? path.split('/').pop() || 'Untitled' : 'Untitled'),
    };
    this.notify();
  }

  setDirty(dirty: boolean): void {
    if (this.state.isDirty !== dirty) {
      this.state = {
        ...this.state,
        isDirty: dirty,
      };
      this.notify();
    }
  }

  incrementContentVersion(): void {
    this.state = {
      ...this.state,
      contentVersion: this.state.contentVersion + 1,
    };
    this.notify();
  }

  loadFromState(state: Partial<EditorState>): void {
    this.state = {
      ...this.state,
      ...state,
    };
    this.notify();
  }
}

// Singleton instance
export const editorStateManager = new EditorStateManager();