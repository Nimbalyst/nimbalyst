/**
 * WorkspaceEditor - Main editing area for workspace mode
 *
 * Manages the tab system and multiple concurrent editor instances.
 */

import React, { useRef, useState, useCallback, useEffect } from 'react';
import type { ConfigTheme, TextReplacement } from 'rexical';
import { TOGGLE_SEARCH_COMMAND } from 'rexical';
import { TabManager } from '../TabManager/TabManager';
import { EditorContainer } from '../EditorContainer';
import { WorkspaceWelcome } from '../WorkspaceWelcome';
import { useTabs } from '../../hooks/useTabs';
import { useTabPreferences } from '../../hooks/useTabPreferences';
import { logger } from '../../utils/logger';
import './WorkspaceEditor.css';

interface WorkspaceEditorProps {
  workspaceName: string | null;
  workspacePath: string | null;
  theme: ConfigTheme;
  textReplacements?: TextReplacement[];
  onContentChange?: (content: string, isDirty: boolean) => void;
  onSave?: () => void;
  onFilePathChange?: (filePath: string | null) => void;
  onFileNameChange?: (fileName: string | null) => void;
  onGetContentRef?: (getContentFn: () => string) => void;
  onEditorReady?: (editor: any) => void;
}

export const WorkspaceEditor: React.FC<WorkspaceEditorProps> = ({
  workspaceName,
  workspacePath,
  theme,
  textReplacements,
  onContentChange,
  onSave,
  onFilePathChange,
  onFileNameChange,
  onGetContentRef,
  onEditorReady,
}) => {
  const tabPreferences = useTabPreferences();
  const contentRef = useRef('');
  const getContentRef = useRef<(() => string) | null>(null);
  const initialContentRef = useRef('');
  const isDirtyRef = useRef(false);
  const lastChangeTimeRef = useRef(0);
  const [isDirty, setIsDirty] = useState(false);
  const tabStatesRef = useRef<Map<string, { isDirty: boolean }>>(new Map());
  const editorRef = useRef<any>(null);
  const searchCommandRef = useRef<any>(null);

  const tabs = useTabs({
    enabled: tabPreferences.enabled,
    onTabChange: (tab) => {
      logger.ui.info(`[WorkspaceEditor] Tab changed to: ${tab.fileName}`);
      onFilePathChange?.(tab.filePath);
      onFileNameChange?.(tab.fileName);

      // Update content ref
      contentRef.current = tab.content;
      initialContentRef.current = tab.content;
      isDirtyRef.current = tab.isDirty;
      setIsDirty(tab.isDirty);
    },
    onTabClose: (tab) => {
      logger.ui.info(`[WorkspaceEditor] Tab closed: ${tab.fileName}`);
    },
  });

  // Handle content changes from editor
  const handleContentChange = useCallback(() => {
    if (getContentRef.current) {
      const currentContent = getContentRef.current();
      contentRef.current = currentContent;

      // Normalize content before comparing
      const normalizedCurrent = currentContent.trimEnd();
      const normalizedInitial = initialContentRef.current.trimEnd();
      const hasChanged = normalizedCurrent !== normalizedInitial;

      if (hasChanged) {
        const now = Date.now();
        lastChangeTimeRef.current = now;
      }

      isDirtyRef.current = hasChanged;

      // Track tab dirty state
      if (tabs.activeTabId) {
        tabStatesRef.current.set(tabs.activeTabId, { isDirty: hasChanged });
      }

      // Update state if changed
      if (isDirty !== hasChanged) {
        setIsDirty(hasChanged);
        if (tabs.activeTabId) {
          tabs.updateTab(tabs.activeTabId, { isDirty: hasChanged });
        }
      }

      onContentChange?.(currentContent, hasChanged);
    }
  }, [isDirty, tabs, onContentChange]);

  // Handle get content callback
  const handleGetContent = useCallback(
    (getContentFn: () => string) => {
      logger.ui.info('[WorkspaceEditor] Received getContent function');
      getContentRef.current = getContentFn;

      // Update initial content ref
      if (getContentFn) {
        const loadedContent = getContentFn();
        initialContentRef.current = loadedContent;
      }

      onGetContentRef?.(getContentFn);
    },
    [onGetContentRef]
  );

  // Handle editor ready
  const handleEditorReady = useCallback(
    (editor: any) => {
      logger.ui.info('[WorkspaceEditor] Editor ready');
      editorRef.current = editor;
      searchCommandRef.current = TOGGLE_SEARCH_COMMAND;
      onEditorReady?.(editor);
    },
    [onEditorReady]
  );

  // Handle save request
  const handleSaveRequest = useCallback(() => {
    logger.ui.info('[WorkspaceEditor] Save requested');
    onSave?.();
  }, [onSave]);

  // Show welcome screen if no active tab
  if (!tabs.activeTab) {
    return <WorkspaceWelcome workspaceName={workspaceName || 'Workspace'} />;
  }

  return (
    <div className="workspace-editor">
      <TabManager
        tabs={tabs.tabs}
        activeTabId={tabs.activeTabId}
        onTabSelect={tabs.switchTab}
        onTabClose={tabs.removeTab}
        onNewTab={() => {
          // TODO: Show new file dialog
          logger.ui.info('[WorkspaceEditor] New tab requested');
        }}
        onTogglePin={tabs.togglePin}
        onTabReorder={tabs.reorderTabs}
        onViewHistory={(tabId) => {
          const tab = tabs.getTabState(tabId);
          if (tab && tab.filePath) {
            logger.ui.info(`[WorkspaceEditor] View history for: ${tab.fileName}`);
            // TODO: Open history dialog
          }
        }}
      >
        <EditorContainer
          tabs={tabs.tabs}
          activeTabId={tabs.activeTabId}
          theme={theme}
          onGetContent={handleGetContent}
          onEditorReady={handleEditorReady}
          onContentChange={handleContentChange}
          onSaveRequest={handleSaveRequest}
          textReplacements={textReplacements}
        />
      </TabManager>
    </div>
  );
};
