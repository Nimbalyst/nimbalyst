/**
 * Autosave utilities
 *
 * Extracts autoSaveBeforeNavigation logic from App.tsx
 */

export interface AutoSaveOptions {
  filePath?: string | null;
  tabId?: string | null;
  content?: string;
  force?: boolean;
  reason?: string;
}

interface AutoSaveContext {
  currentFilePath: string | null;
  tabPreferences: any;
  tabs: any;
  isDirtyRef: React.MutableRefObject<boolean>;
  getContentRef: React.MutableRefObject<(() => string) | null>;
  contentRef: React.MutableRefObject<string>;
  initialContentRef: React.MutableRefObject<string>;
  lastSaveTimeRef: React.MutableRefObject<number>;
  setIsDirty: (dirty: boolean) => void;
  setCurrentFilePath: (path: string | null) => void;
  setCurrentFileName: (name: string) => void;
}

export async function autoSaveBeforeNavigation(
  options: AutoSaveOptions,
  context: AutoSaveContext
): Promise<boolean> {
  if (!window.electronAPI) {
    return false;
  }

  const {
    filePath: overridePath,
    tabId: overrideTabId,
    content: overrideContent,
    force = false,
    reason
  } = options;

  const {
    currentFilePath,
    tabPreferences,
    tabs,
    isDirtyRef,
    getContentRef,
    contentRef,
    initialContentRef,
    lastSaveTimeRef,
    setIsDirty,
    setCurrentFilePath,
    setCurrentFileName,
  } = context;

  const activeTabId = tabPreferences.preferences.enabled ? tabs.activeTabId : null;
  const activeTab = tabPreferences.preferences.enabled ? tabs.activeTab : null;

  const targetTabId = overrideTabId ?? (activeTabId ?? null);
  const targetFilePath = overridePath ?? (activeTab?.filePath ?? currentFilePath);

  if (!targetFilePath) {
    return false;
  }

  const content =
    overrideContent !== undefined
      ? overrideContent
      : getContentRef.current
        ? getContentRef.current()
        : contentRef.current;

  if (content === undefined || content === null) {
    return false;
  }

  const shouldSave = force || isDirtyRef.current;
  if (!shouldSave) {
    return false;
  }

  try {
    const result = await window.electronAPI.saveFile(content, targetFilePath);
    if (!result || !result.success) {
      return false;
    }

    lastSaveTimeRef.current = Date.now();

    const isActiveTab = !tabPreferences.preferences.enabled || (targetTabId !== null && targetTabId === tabs.activeTabId);

    if (tabPreferences.preferences.enabled && targetTabId) {
      tabs.updateTab(targetTabId, {
        content,
        isDirty: false,
        lastSaved: new Date()
      });
    }

    if (isActiveTab) {
      isDirtyRef.current = false;
      setIsDirty(false);
      initialContentRef.current = content;
      setCurrentFilePath(result.filePath);
      setCurrentFileName(result.filePath.split('/').pop() || result.filePath);
    }

    if (reason && window.electronAPI.history) {
      try {
        await window.electronAPI.history.createSnapshot(
          targetFilePath,
          content,
          'auto',
          reason
        );
      } catch (snapshotError) {
        console.warn('[AUTOSAVE] Failed to record snapshot:', snapshotError);
      }
    }

    return true;
  } catch (error) {
    console.error('[AUTOSAVE] Failed to save document automatically:', error);
    return false;
  }
}