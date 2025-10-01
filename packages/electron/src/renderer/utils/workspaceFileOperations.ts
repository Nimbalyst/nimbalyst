/**
 * Workspace file operations
 *
 * Extracts handleWorkspaceFileSelect logic from App.tsx
 */

const LOG_CONFIG = {
  WORKSPACE_FILE_SELECT: false,
};

interface FileSelectOptions {
  filePath: string;
  currentFilePath: string | null;
  tabs: any;
  isInitializedRef: React.MutableRefObject<boolean>;
  setCurrentFilePath: (path: string | null) => void;
  setCurrentFileName: (name: string) => void;
  setCurrentDirectory: (dir: string | null) => void;
}

export async function handleWorkspaceFileSelect(options: FileSelectOptions): Promise<void> {
  const {
    filePath,
    currentFilePath,
    tabs,
    isInitializedRef,
    setCurrentFilePath,
    setCurrentFileName,
    setCurrentDirectory,
  } = options;

  // NOTE: autoSaveCancellationRef removed - EditorContainer handles all autosave now

  if (!window.electronAPI) return;

  if (LOG_CONFIG.WORKSPACE_FILE_SELECT) console.log('[WORKSPACE_FILE_SELECT] Selecting file:', filePath);

  const activeTabId = tabs.activeTabId;
  const activeFilePath = tabs.activeTab
    ? tabs.activeTab.filePath
    : currentFilePath;

  if (activeFilePath === filePath) {
    const existingTab = tabs.findTabByPath(filePath);
    if (existingTab) {
      if (LOG_CONFIG.WORKSPACE_FILE_SELECT) console.log('[WORKSPACE_FILE_SELECT] File already active, ensuring tab focus');
      tabs.switchTab(existingTab.id);
    }
    return;
  }

  // NOTE: No need to manually save here - EditorContainer handles save-on-tab-switch
  // When we call tabs.switchTab() or tabs.addTab() below, it triggers onTabChange,
  // which triggers EditorContainer's visibility useEffect, which saves dirty tabs before hiding.

  // If tabs are enabled, check if file is already open in a tab
  const existingTab = tabs.findTabByPath(filePath);
  if (existingTab) {
    if (LOG_CONFIG.WORKSPACE_FILE_SELECT) console.log('[WORKSPACE_FILE_SELECT] File already open in tab, switching');
    tabs.switchTab(existingTab.id);
    return;
  }

  try {
    const result = await window.electronAPI.switchWorkspaceFile(filePath);
    if (result) {
      if (LOG_CONFIG.WORKSPACE_FILE_SELECT) console.log('[WORKSPACE_FILE_SELECT] File loaded successfully');

      // Add a new tab - onTabChange will handle all state updates
      console.log('[TABS] Adding tab for file:', result.filePath);
      const tabId = tabs.addTab(result.filePath, result.content);
      if (!tabId) {
        console.warn('Failed to add tab - max tabs reached');
        // Could show a dialog here
      } else {
        console.log('[TABS] Added tab with ID:', tabId);
        // State updates (contentRef, currentFilePath, etc.) will be handled by onTabChange callback
      }

      // Update current directory based on the file path
      const dirPath = result.filePath.substring(0, result.filePath.lastIndexOf('/'));
      setCurrentDirectory(dirPath);

      // Add to recent files
      if (window.electronAPI?.addToWorkspaceRecentFiles) {
        window.electronAPI.addToWorkspaceRecentFiles(filePath);
      }

      // Explicitly update the current file in main process (redundant but safe)
      if (LOG_CONFIG.WORKSPACE_FILE_SELECT) console.log('[WORKSPACE_FILE_SELECT] Ensuring backend has correct file path');
      const syncResult = window.electronAPI.setCurrentFile(filePath);
      if (syncResult && typeof syncResult.then === 'function') {
        await syncResult;
      }

      // Create automatic snapshot when switching to file
      if (window.electronAPI.history) {
        try {
          // Check if we have previous snapshots
          const snapshots = await window.electronAPI.history.listSnapshots(result.filePath);
          if (snapshots.length === 0) {
            // First time opening this file, create initial snapshot
            await window.electronAPI.history.createSnapshot(
              result.filePath,
              result.content,
              'auto',
              'Initial file open'
            );
          } else {
            // Check if content changed since last snapshot
            const latestSnapshot = snapshots[0]; // Assuming sorted by timestamp desc
            const lastContent = await window.electronAPI.history.loadSnapshot(
              result.filePath,
              latestSnapshot.timestamp
            );
            if (lastContent !== result.content) {
              // Content actually changed, create snapshot
              await window.electronAPI.history.createSnapshot(
                result.filePath,
                result.content,
                'auto',
                'File changed externally'
              );
            }
          }
        } catch (error) {
          console.error('Failed to create automatic snapshot:', error);
        }
      }
    }
  } catch (error) {
    console.error('Failed to switch workspace file:', error);
  }
}