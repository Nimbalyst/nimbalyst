import { useEffect, useRef } from 'react';
import type { ConfigTheme } from 'rexical';

interface UseHMRStateRestorationProps {
  // State setters
  setWorkspaceMode: (mode: boolean) => void;
  setWorkspacePath: (path: string | null) => void;
  setWorkspaceName: (name: string | null) => void;
  setFileTree: (tree: FileTreeItem[]) => void;
  setCurrentFilePath: (path: string | null) => void;
  setCurrentFileName: (name: string | null) => void;
  setIsDirty: (dirty: boolean) => void;
  setContentVersion: (setter: (v: number) => number) => void;
  setSidebarWidth: (width: number) => void;
  setTheme: (theme: ConfigTheme) => void;

  // Refs
  contentRef: React.MutableRefObject<string>;
  initialContentRef: React.MutableRefObject<string>;
  isInitializedRef: React.MutableRefObject<boolean>;
  isDirtyRef: React.MutableRefObject<boolean>;
  contentVersionRef: React.MutableRefObject<number>;

  // State values (for save effect)
  workspaceMode: boolean;
  workspacePath: string | null;
  workspaceName: string | null;
  fileTree: FileTreeItem[];
  currentFilePath: string | null;
  currentFileName: string | null;
  sidebarWidth: number;
  theme: ConfigTheme;

  // Logging configuration
  LOG_CONFIG: { HMR: boolean };
}

/**
 * Hook to save and restore state during Hot Module Replacement (HMR) in development.
 * This preserves the app state when code changes are hot-reloaded.
 */
export function useHMRStateRestoration(props: UseHMRStateRestorationProps) {
  const {
    // State setters
    setWorkspaceMode,
    setWorkspacePath,
    setWorkspaceName,
    setFileTree,
    setCurrentFilePath,
    setCurrentFileName,
    setIsDirty,
    setContentVersion,
    setSidebarWidth,
    setTheme,

    // Refs
    contentRef,
    initialContentRef,
    isInitializedRef,
    isDirtyRef,
    contentVersionRef,

    // State values
    workspaceMode,
    workspacePath,
    workspaceName,
    fileTree,
    currentFilePath,
    currentFileName,
    sidebarWidth,
    theme,

    // Config
    LOG_CONFIG
  } = props;

  // Restore state during development HMR (only on mount)
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      // Restore state from session storage on mount
      const savedState = sessionStorage.getItem('rexical-dev-state');
      if (savedState) {
        try {
          const state = JSON.parse(savedState);
          if (LOG_CONFIG.HMR) console.log('[HMR] Restoring dev state:', state);

          // Restore the state
          if (state.workspaceMode) {
            setWorkspaceMode(true);
            setWorkspacePath(state.workspacePath);
            setWorkspaceName(state.workspaceName);
            setFileTree(state.fileTree || []);
          }

          if (state.filePath) {
            setCurrentFilePath(state.filePath);
            setCurrentFileName(state.fileName);

            // Reset local content so we can hydrate from disk
            contentRef.current = '';
            initialContentRef.current = '';
            isInitializedRef.current = false;
            isDirtyRef.current = false;
            setIsDirty(false);

            const hydrateFromDisk = async () => {
              if (!window.electronAPI) {
                return;
              }

              try {
                const targetPath = state.filePath as string;
                const shouldSwitchWorkspace = Boolean(state.workspaceMode && window.electronAPI.switchWorkspaceFile);

                let result: { filePath: string; content: string } | null = null;

                if (shouldSwitchWorkspace && window.electronAPI.switchWorkspaceFile) {
                  result = await window.electronAPI.switchWorkspaceFile(targetPath);
                } else if (window.electronAPI.readFileContent) {
                  const res = await window.electronAPI.readFileContent(targetPath);
                  result = res && typeof res.content === 'string'
                    ? { filePath: targetPath, content: res.content }
                    : null;
                }

                if (result && typeof result.content === 'string') {
                  contentRef.current = result.content;
                  initialContentRef.current = result.content;
                  contentVersionRef.current += 1;
                  setContentVersion(v => v + 1);
                } else if (LOG_CONFIG.HMR) {
                  console.warn('[HMR] No disk content returned while restoring dev state for', targetPath);
                }
              } catch (error) {
                console.error('[HMR] Failed to load latest file content during dev restore:', error);
              }
            };

            hydrateFromDisk();

            // Update the main process about the current file
            if (window.electronAPI) {
              window.electronAPI.setCurrentFile(state.filePath);
            }
          }

          if (state.sidebarWidth) {
            setSidebarWidth(state.sidebarWidth);
          }

          if (state.theme) {
            setTheme(state.theme);
          }

          // Clear the saved state
          sessionStorage.removeItem('rexical-dev-state');
        } catch (error) {
          if (LOG_CONFIG.HMR) console.error('[HMR] Failed to restore dev state:', error);
        }
      }
    }
  }, []); // Empty dependency array - only run on mount

  // Save state before HMR in development
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      const saveDevState = () => {
        const state = {
          workspaceMode,
          workspacePath,
          workspaceName,
          fileTree,
          filePath: currentFilePath,
          fileName: currentFileName,
          sidebarWidth: sidebarWidth,
          theme: theme
        };
        if (LOG_CONFIG.HMR) console.log('[HMR] Saving dev state:', state);
        sessionStorage.setItem('rexical-dev-state', JSON.stringify(state));
      };

      // Save state on beforeunload (catches HMR)
      window.addEventListener('beforeunload', saveDevState);

      return () => {
        window.removeEventListener('beforeunload', saveDevState);
      };
    }
  }, [workspaceMode, workspacePath, workspaceName, fileTree, currentFilePath, currentFileName, sidebarWidth, theme, LOG_CONFIG]);
}