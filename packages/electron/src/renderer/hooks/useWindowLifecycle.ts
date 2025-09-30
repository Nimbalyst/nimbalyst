import { useEffect, useRef } from 'react';
import { logger } from '../utils/logger';

interface UseWindowLifecycleProps {
  tabsRef: React.MutableRefObject<any>;
  getContentRef: React.MutableRefObject<(() => string) | null>;
  isDirtyRef: React.MutableRefObject<boolean>;
  currentFilePath: string | null;
  lastSaveTimeRef: React.MutableRefObject<number>;
}

/**
 * Hook to handle window lifecycle events (mount/unmount/beforeunload).
 * Saves unsaved changes when the window is closing or reloading.
 */
export function useWindowLifecycle({
  tabsRef,
  getContentRef,
  isDirtyRef,
  currentFilePath,
  lastSaveTimeRef
}: UseWindowLifecycleProps) {
  useEffect(() => {
    logger.ui.info('App component mounted');

    // Save on window close/reload
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      // Save current tab content first
      if (tabsRef.current && tabsRef.current.activeTabId && getContentRef.current) {
        const currentContent = getContentRef.current();
        tabsRef.current.updateTab(tabsRef.current.activeTabId, {
          content: currentContent,
          isDirty: isDirtyRef.current
        });
      }

      // Check if any tabs are dirty
      let hasDirtyTabs = isDirtyRef.current;
      if (tabsRef.current && tabsRef.current.tabs) {
        hasDirtyTabs = hasDirtyTabs || tabsRef.current.tabs.some((tab: any) => tab.isDirty);
      }

      if (hasDirtyTabs) {
        console.log('[WINDOW CLOSE] Has unsaved changes');
        // This will show a dialog in Electron
        e.preventDefault();
        e.returnValue = 'You have unsaved changes. Are you sure you want to quit?';

        // Try to save current file quickly
        if (isDirtyRef.current && getContentRef.current && currentFilePath && window.electronAPI) {
          const content = getContentRef.current();
          // Fire and forget - don't await
          window.electronAPI.saveFile(content, currentFilePath).then(result => {
            if (result && result.success) {
              // Mark the time we saved to ignore file change events
              lastSaveTimeRef.current = Date.now();
              console.log('[WINDOW CLOSE] Saved current file');
            }
          }).catch(error => {
            console.error('[WINDOW CLOSE] Failed to save:', error);
          });
        }
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      logger.ui.info('App component unmounting');
      window.removeEventListener('beforeunload', handleBeforeUnload);

      // Final save attempt on unmount
      if (isDirtyRef.current && getContentRef.current && currentFilePath && window.electronAPI) {
        const content = getContentRef.current();
        window.electronAPI.saveFile(content, currentFilePath).catch(error => {
          console.error('[UNMOUNT] Failed to save:', error);
        });
      }
    };
  }, [currentFilePath, tabsRef, getContentRef, isDirtyRef, lastSaveTimeRef]);
}