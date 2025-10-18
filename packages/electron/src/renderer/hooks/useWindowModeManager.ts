/**
 * React hook for Window Mode Management
 *
 * Provides React components with access to the WindowModeManager
 * and reactive state updates when modes change.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { WindowModeManager } from '../services/WindowModeManager';
import type {
  ContentMode,
  WorkspaceWindowState,
  FilesModeState,
  AgentModeState,
  PlanModeState
} from '../types/WindowModeTypes';

interface UseWindowModeManagerReturn {
  // Current state
  activeMode: ContentMode;
  state: Readonly<WorkspaceWindowState>;

  // Mode-specific state
  filesMode: FilesModeState;
  agentMode: AgentModeState;
  planMode: PlanModeState;

  // Actions
  switchMode: (mode: ContentMode) => void;
  updateFilesModeState: (updates: Partial<FilesModeState>) => void;
  updateAgentModeState: (updates: Partial<AgentModeState>) => void;
  updatePlanModeState: (updates: Partial<PlanModeState>) => void;
  updateAIChatState: (updates: Partial<WorkspaceWindowState['aiChat']>) => void;

  // Utilities
  isLoading: boolean;
  manager: WindowModeManager | null;
}

/**
 * Hook for managing window content modes
 *
 * @param workspacePath - Path to the current workspace
 * @returns Mode manager state and actions
 */
export function useWindowModeManager(workspacePath: string | null): UseWindowModeManagerReturn {
  const [manager, setManager] = useState<WindowModeManager | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [, forceUpdate] = useState({});
  const managerRef = useRef<WindowModeManager | null>(null);

  // Force a re-render
  const triggerUpdate = useCallback(() => {
    forceUpdate({});
  }, []);

  // Initialize manager when workspace path changes
  useEffect(() => {
    if (!workspacePath) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    const initManager = async () => {
      try {
        setIsLoading(true);

        // Dispose of old manager if it exists
        if (managerRef.current) {
          await managerRef.current.flush();
          managerRef.current.dispose();
        }

        // Load new manager
        const newManager = await WindowModeManager.load(workspacePath);

        if (cancelled) {
          newManager.dispose();
          return;
        }

        managerRef.current = newManager;
        setManager(newManager);
      } catch (error) {
        console.error('[useWindowModeManager] Failed to initialize manager:', error);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    initManager();

    return () => {
      cancelled = true;
      if (managerRef.current) {
        // Flush on cleanup
        managerRef.current.flush().catch(console.error);
      }
    };
  }, [workspacePath]);

  // Subscribe to mode changes
  useEffect(() => {
    if (!manager) return;

    const unsubscribe = manager.onModeChange((event) => {
      console.log(`[useWindowModeManager] Mode changed: ${event.from} -> ${event.to}`);
      triggerUpdate();
    });

    return unsubscribe;
  }, [manager, triggerUpdate]);

  // Flush state on unmount
  useEffect(() => {
    return () => {
      if (managerRef.current) {
        managerRef.current.flush().catch(console.error);
        managerRef.current.dispose();
      }
    };
  }, []);

  // Create action callbacks
  const switchMode = useCallback((mode: ContentMode) => {
    if (!manager) return;
    manager.switchMode(mode);
    triggerUpdate();
  }, [manager, triggerUpdate]);

  const updateFilesModeState = useCallback((updates: Partial<FilesModeState>) => {
    if (!manager) return;
    manager.updateFilesModeState(updates);
    triggerUpdate();
  }, [manager, triggerUpdate]);

  const updateAgentModeState = useCallback((updates: Partial<AgentModeState>) => {
    if (!manager) return;
    manager.updateAgentModeState(updates);
    triggerUpdate();
  }, [manager, triggerUpdate]);

  const updatePlanModeState = useCallback((updates: Partial<PlanModeState>) => {
    if (!manager) return;
    manager.updatePlanModeState(updates);
    triggerUpdate();
  }, [manager, triggerUpdate]);

  const updateAIChatState = useCallback((updates: Partial<WorkspaceWindowState['aiChat']>) => {
    if (!manager) return;
    manager.updateAIChatState(updates);
    triggerUpdate();
  }, [manager, triggerUpdate]);

  // Get current state (or defaults if no manager)
  const state = manager?.getState() ?? null;
  const filesMode = state?.filesMode ?? {
    activeTabId: null,
    tabs: [],
    closedTabs: [],
    tabOrder: [],
    sidebarView: 'files' as const,
    sidebarWidth: 250
  };
  const agentMode = state?.agentMode ?? {
    mountLocation: 'main' as const,
    activeSessionId: null,
    sessionTabs: [],
    closedSessions: [],
    sessionHistoryLayout: {
      width: 240,
      collapsed: false,
      collapsedGroups: []
    }
  };
  const planMode = state?.planMode ?? {
    activePlanPath: null,
    viewMode: 'edit' as const,
    filters: {}
  };

  return {
    activeMode: state?.activeMode ?? 'files',
    state: state as Readonly<WorkspaceWindowState>,
    filesMode,
    agentMode,
    planMode,
    switchMode,
    updateFilesModeState,
    updateAgentModeState,
    updatePlanModeState,
    updateAIChatState,
    isLoading,
    manager
  };
}
