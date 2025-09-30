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
  isDirtyRef: React.MutableRefObject<boolean>;
  tabPreferences: any;
  tabs: any;
  autoSaveBeforeNavigation: (options: any) => Promise<boolean>;
  autoSaveCancellationRef: React.MutableRefObject<AbortController | null>;
  contentVersionRef: React.MutableRefObject<number>;
  isInitializedRef: React.MutableRefObject<boolean>;
  contentRef: React.MutableRefObject<string>;
  initialContentRef: React.MutableRefObject<string>;
  setCurrentFilePath: (path: string | null) => void;
  setCurrentFileName: (name: string) => void;
  setIsDirty: (dirty: boolean) => void;
  setContentVersion: (fn: (v: number) => number) => void;
  setCurrentDirectory: (dir: string | null) => void;
}

export async function handleWorkspaceFileSelect(options: FileSelectOptions): Promise<void> {
  const {
    filePath,
    currentFilePath,
    isDirtyRef,
    tabPreferences,
    tabs,
    autoSaveBeforeNavigation,
    autoSaveCancellationRef,
    contentVersionRef,
    isInitializedRef,
    contentRef,
    initialContentRef,
    setCurrentFilePath,
    setCurrentFileName,
    setIsDirty,
    setContentVersion,
    setCurrentDirectory,
  } = options;

  // Cancel any pending autosave for the previous file
  if (autoSaveCancellationRef.current) {
    console.log('[FILE_SELECT] Cancelling pending autosave');
    autoSaveCancellationRef.current.abort();
    autoSaveCancellationRef.current = null;
  }

  if (!window.electronAPI) return;

  if (LOG_CONFIG.WORKSPACE_FILE_SELECT) console.log('[WORKSPACE_FILE_SELECT] Selecting file:', filePath);

  const activeTabId = tabPreferences.preferences.enabled ? tabs.activeTabId : null;
  const activeFilePath = tabPreferences.preferences.enabled && tabs.activeTab
    ? tabs.activeTab.filePath
    : currentFilePath;

  if (activeFilePath === filePath) {
    if (tabPreferences.preferences.enabled) {
      const existingTab = tabs.findTabByPath(filePath);
      if (existingTab) {
        if (LOG_CONFIG.WORKSPACE_FILE_SELECT) console.log('[WORKSPACE_FILE_SELECT] File already active, ensuring tab focus');
        tabs.switchTab(existingTab.id);
      }
    }
    return;
  }

  const wasDirty = isDirtyRef.current;

  if (activeFilePath && activeFilePath !== filePath && wasDirty) {
    if (LOG_CONFIG.WORKSPACE_FILE_SELECT) console.log('[WORKSPACE_FILE_SELECT] Auto-saving current file before switching');
    await autoSaveBeforeNavigation({
      tabId: activeTabId,
      filePath: activeFilePath,
      force: true,
      reason: 'Autosave before switching file'
    });
  }

  // If tabs are enabled, check if file is already open in a tab after autosave
  if (tabPreferences.preferences.enabled) {
    const existingTab = tabs.findTabByPath(filePath);
    if (existingTab) {
      if (LOG_CONFIG.WORKSPACE_FILE_SELECT) console.log('[WORKSPACE_FILE_SELECT] File already open in tab, switching');
      tabs.switchTab(existingTab.id);
      return;
    }
  }

  try {
    const result = await window.electronAPI.switchWorkspaceFile(filePath);
    if (result) {
      if (LOG_CONFIG.WORKSPACE_FILE_SELECT) console.log('[WORKSPACE_FILE_SELECT] File loaded successfully');

      // If tabs are enabled, add a new tab
      if (tabPreferences.preferences.enabled) {
        console.log('[TABS] Adding tab for file:', result.filePath);
        console.log('[TABS] Current tabs before add:', tabs.tabs);
        const tabId = tabs.addTab(result.filePath, result.content);
        if (!tabId) {
          console.warn('Failed to add tab - max tabs reached');
          // Could show a dialog here
        } else {
          console.log('[TABS] Added tab with ID:', tabId);
          console.log('[TABS] Current tabs after add:', tabs.tabs);
          // Set initialContentRef for the new tab
          initialContentRef.current = result.content;
          setCurrentFilePath(result.filePath);
          setCurrentFileName(result.filePath.split('/').pop() || result.filePath);
          contentRef.current = result.content;
          isDirtyRef.current = false;
          setIsDirty(false);
        }
      } else {
        // Original non-tab behavior
        contentVersionRef.current += 1;
        setContentVersion(v => v + 1);
        isInitializedRef.current = false;
        contentRef.current = result.content;
        setCurrentFilePath(result.filePath);
        setCurrentFileName(result.filePath.split('/').pop() || result.filePath);
        isDirtyRef.current = false;
        setIsDirty(false);
        initialContentRef.current = result.content;
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