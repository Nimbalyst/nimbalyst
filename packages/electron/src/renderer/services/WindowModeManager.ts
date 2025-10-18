/**
 * Window Mode Manager
 *
 * Manages content mode switching within workspace windows.
 * Handles state preservation, transitions, and persistence.
 */

import type {
  ContentMode,
  WorkspaceWindowState,
  ModeChangeEvent,
  FilesModeState,
  AgentModeState,
  PlanModeState,
  createDefaultWorkspaceWindowState
} from '../types/WindowModeTypes';

export class WindowModeManager {
  private state: WorkspaceWindowState;
  private listeners: Set<(event: ModeChangeEvent) => void> = new Set();
  private persistenceTimer: NodeJS.Timeout | null = null;
  private readonly PERSISTENCE_DELAY = 500; // ms

  constructor(initialState: WorkspaceWindowState) {
    this.state = initialState;
  }

  /**
   * Get the current window state
   */
  getState(): Readonly<WorkspaceWindowState> {
    return this.state;
  }

  /**
   * Get the current active mode
   */
  getActiveMode(): ContentMode {
    return this.state.activeMode;
  }

  /**
   * Get state for a specific mode
   */
  getModeState<T extends ContentMode>(
    mode: T
  ): T extends 'files'
    ? FilesModeState
    : T extends 'agent'
    ? AgentModeState
    : PlanModeState {
    switch (mode) {
      case 'files':
        return this.state.filesMode as any;
      case 'agent':
        return this.state.agentMode as any;
      case 'plan':
        return this.state.planMode as any;
      default:
        throw new Error(`Invalid mode: ${mode}`);
    }
  }

  /**
   * Switch to a different content mode
   */
  switchMode(newMode: ContentMode): void {
    const oldMode = this.state.activeMode;

    if (oldMode === newMode) {
      console.log(`[WindowModeManager] Already in ${newMode} mode`);
      return;
    }

    console.log(`[WindowModeManager] Switching from ${oldMode} to ${newMode}`);

    // Update active mode
    this.state = {
      ...this.state,
      activeMode: newMode,
      lastUpdated: Date.now()
    };

    // Notify listeners
    const event: ModeChangeEvent = {
      from: oldMode,
      to: newMode,
      timestamp: Date.now()
    };
    this.notifyListeners(event);

    // Schedule persistence
    this.schedulePersistence();
  }

  /**
   * Update files mode state
   */
  updateFilesModeState(updates: Partial<FilesModeState>): void {
    this.state = {
      ...this.state,
      filesMode: {
        ...this.state.filesMode,
        ...updates
      },
      lastUpdated: Date.now()
    };
    this.schedulePersistence();
  }

  /**
   * Update agent mode state
   */
  updateAgentModeState(updates: Partial<AgentModeState>): void {
    this.state = {
      ...this.state,
      agentMode: {
        ...this.state.agentMode,
        ...updates
      },
      lastUpdated: Date.now()
    };
    this.schedulePersistence();
  }

  /**
   * Update plan mode state
   */
  updatePlanModeState(updates: Partial<PlanModeState>): void {
    this.state = {
      ...this.state,
      planMode: {
        ...this.state.planMode,
        ...updates
      },
      lastUpdated: Date.now()
    };
    this.schedulePersistence();
  }

  /**
   * Update AI Chat state (shared across all modes)
   */
  updateAIChatState(updates: Partial<WorkspaceWindowState['aiChat']>): void {
    this.state = {
      ...this.state,
      aiChat: {
        ...this.state.aiChat,
        ...updates
      },
      lastUpdated: Date.now()
    };
    this.schedulePersistence();
  }

  /**
   * Subscribe to mode change events
   */
  onModeChange(listener: (event: ModeChangeEvent) => void): () => void {
    this.listeners.add(listener);
    // Return unsubscribe function
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Notify all listeners of a mode change
   */
  private notifyListeners(event: ModeChangeEvent): void {
    this.listeners.forEach(listener => {
      try {
        listener(event);
      } catch (error) {
        console.error('[WindowModeManager] Error in mode change listener:', error);
      }
    });
  }

  /**
   * Schedule state persistence (debounced)
   */
  private schedulePersistence(): void {
    if (this.persistenceTimer) {
      clearTimeout(this.persistenceTimer);
    }

    this.persistenceTimer = setTimeout(() => {
      this.persist();
    }, this.PERSISTENCE_DELAY);
  }

  /**
   * Persist current state to storage
   */
  private async persist(): Promise<void> {
    try {
      if (!window.electronAPI?.invoke) {
        console.warn('[WindowModeManager] Electron API not available for persistence');
        return;
      }

      await window.electronAPI.invoke('workspace:save-window-mode-state', {
        workspacePath: this.state.workspacePath,
        state: this.state
      });

      console.log('[WindowModeManager] State persisted successfully');
    } catch (error) {
      console.error('[WindowModeManager] Failed to persist state:', error);
    }
  }

  /**
   * Force immediate persistence (e.g., before window close)
   */
  async flush(): Promise<void> {
    if (this.persistenceTimer) {
      clearTimeout(this.persistenceTimer);
      this.persistenceTimer = null;
    }
    await this.persist();
  }

  /**
   * Load state from storage
   */
  static async load(workspacePath: string): Promise<WindowModeManager> {
    try {
      if (!window.electronAPI?.invoke) {
        throw new Error('Electron API not available');
      }

      const savedState = await window.electronAPI.invoke(
        'workspace:load-window-mode-state',
        workspacePath
      );

      if (savedState) {
        console.log('[WindowModeManager] Loaded saved state:', savedState.activeMode);
        return new WindowModeManager(savedState);
      }
    } catch (error) {
      console.warn('[WindowModeManager] Failed to load saved state:', error);
    }

    // Create default state if loading fails
    const { createDefaultWorkspaceWindowState } = await import('../types/WindowModeTypes');
    const defaultState = createDefaultWorkspaceWindowState(workspacePath);
    console.log('[WindowModeManager] Using default state');
    return new WindowModeManager(defaultState);
  }

  /**
   * Reset to default state (for testing or cleanup)
   */
  reset(): void {
    const workspacePath = this.state.workspacePath;
    import('../types/WindowModeTypes').then(({ createDefaultWorkspaceWindowState }) => {
      this.state = createDefaultWorkspaceWindowState(workspacePath);
      this.schedulePersistence();
    });
  }

  /**
   * Dispose of the manager (cleanup before unmount)
   */
  dispose(): void {
    if (this.persistenceTimer) {
      clearTimeout(this.persistenceTimer);
      this.persistenceTimer = null;
    }
    this.listeners.clear();
  }
}

/**
 * React hook for using WindowModeManager
 * (Will be implemented in a separate file)
 */
export function useWindowModeManager(workspacePath: string) {
  // This will be implemented as a React hook
  // For now, it's just a placeholder
  return null;
}
