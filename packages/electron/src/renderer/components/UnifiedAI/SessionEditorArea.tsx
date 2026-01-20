/**
 * SessionEditorArea - Embedded editor tabs for an AI session
 *
 * This component provides a resizable editor area within the agent mode interface.
 * Each session can have its own set of open file tabs, independent from the main workspace tabs.
 *
 * Layout modes:
 * - 'editor': Editor maximized, transcript hidden
 * - 'split': Both editor and transcript visible with adjustable ratio
 * - 'transcript': Transcript maximized (default), editor hidden
 *
 * Note: For Phase 2, this uses TabsProvider like WorktreeFilesMode.
 * Phase 3 will refactor TabManager/TabContent to use Jotai atoms directly.
 */

import React, { useCallback, useRef, useMemo, forwardRef, useImperativeHandle } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { TabsProvider, useTabs, useTabsActions } from '../../contexts/TabsContext';
import { TabManager } from '../TabManager/TabManager';
import { TabContent } from '../TabContent/TabContent';
import {
  sessionEditorStateAtom,
  setSessionLayoutModeAtom,
  setSessionSplitRatioAtom,
  setSessionTabCountAtom,
  sessionActiveAtom,
  type SessionLayoutMode,
} from '../../store';
import './SessionEditorArea.css';

export interface SessionEditorAreaRef {
  openFile: (filePath: string) => void;
  hasTabs: () => boolean;
}

interface SessionEditorAreaProps {
  sessionId: string;
  workspacePath: string;
  /** Render prop for transcript content - rendered below editor in split mode */
  children?: React.ReactNode;
  /** Called when the number of open tabs changes */
  onTabCountChange?: (count: number) => void;
}

/**
 * Inner component that uses TabsContext.
 * Must be wrapped in TabsProvider.
 */
interface SessionEditorAreaInnerProps {
  sessionId: string;
  workspacePath: string;
  layoutMode: SessionLayoutMode;
  splitRatio: number;
  onLayoutModeChange: (mode: SessionLayoutMode) => void;
  onSplitRatioChange: (ratio: number) => void;
  onTabCountChange?: (count: number) => void;
}

const SessionEditorAreaInner = forwardRef<SessionEditorAreaRef, SessionEditorAreaInnerProps>(
  function SessionEditorAreaInner(
    {
      sessionId,
      workspacePath,
      layoutMode,
      splitRatio,
      onLayoutModeChange,
      onSplitRatioChange,
      onTabCountChange,
    },
    ref
  ) {
    // isActive is managed via Jotai atom to prevent re-render cascades
    const isActive = useAtomValue(sessionActiveAtom(sessionId));
    const { tabs } = useTabs();
    const tabsActions = useTabsActions();
    const containerRef = useRef<HTMLDivElement>(null);
    const isResizingRef = useRef(false);
    const prevTabCountRef = useRef(tabs.length);

    // Notify parent when tab count changes
    React.useEffect(() => {
      if (tabs.length !== prevTabCountRef.current) {
        prevTabCountRef.current = tabs.length;
        onTabCountChange?.(tabs.length);
      }
    }, [tabs.length, onTabCountChange]);

    // Expose methods via ref
    useImperativeHandle(
      ref,
      () => ({
        openFile: (filePath: string) => {
          // Check if tab already exists
          const existing = tabsActions.findTabByPath(filePath);
          if (existing) {
            tabsActions.switchTab(existing.id);
            return;
          }
          // Add new tab
          tabsActions.addTab(filePath, '', true);

          // If in transcript mode and we have tabs, switch to split mode
          if (layoutMode === 'transcript') {
            onLayoutModeChange('split');
          }
        },
        hasTabs: () => tabs.length > 0,
      }),
      [tabsActions, tabs.length, layoutMode, onLayoutModeChange]
    );

    // Handle tab close
    const handleTabClose = useCallback(
      (tabId: string) => {
        tabsActions.removeTab(tabId);
      },
      [tabsActions]
    );

    // Handle new tab (not typically used in session editors)
    const handleNewTab = useCallback(() => {
      // Session editors don't support new tab button - files are opened by clicking in transcript
    }, []);

    // Handle resize drag
    const handleResizeStart = useCallback(
      (e: React.MouseEvent) => {
        e.preventDefault();
        isResizingRef.current = true;

        const startY = e.clientY;
        const container = containerRef.current?.parentElement;
        if (!container) return;

        const containerRect = container.getBoundingClientRect();
        const containerHeight = containerRect.height;

        const handleMouseMove = (moveEvent: MouseEvent) => {
          if (!isResizingRef.current) return;

          const deltaY = moveEvent.clientY - startY;
          const currentHeight = splitRatio * containerHeight;
          const newHeight = currentHeight + deltaY;
          const newRatio = newHeight / containerHeight;

          // Clamp between 10% and 90%
          const clampedRatio = Math.max(0.1, Math.min(0.9, newRatio));
          onSplitRatioChange(clampedRatio);
        };

        const handleMouseUp = () => {
          isResizingRef.current = false;
          document.removeEventListener('mousemove', handleMouseMove);
          document.removeEventListener('mouseup', handleMouseUp);
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = 'ns-resize';
        document.body.style.userSelect = 'none';
      },
      [splitRatio, onSplitRatioChange]
    );

    const hasTabs = tabs.length > 0;

    // Calculate height style based on mode - must be before early return to keep hooks order consistent
    const heightStyle = useMemo(() => {
      if (layoutMode === 'editor') {
        return { flex: 1 };
      }
      return { height: `${splitRatio * 100}%`, minHeight: '100px' };
    }, [layoutMode, splitRatio]);

    // If in transcript mode or no tabs, don't render the editor area
    if (layoutMode === 'transcript' || !hasTabs) {
      return null;
    }

    return (
      <div className="session-editor-area" ref={containerRef} style={heightStyle}>
        <div className="session-editor-header">
          <div className="session-editor-tabs">
            <TabManager
              onTabClose={handleTabClose}
              onNewTab={handleNewTab}
              hideTabBar={false}
              isActive={isActive}
            >
              <></>
            </TabManager>
          </div>
        </div>
        <div className="session-editor-content">
          <TabContent />
        </div>
        {layoutMode === 'split' && (
          <div className="session-editor-resize-handle" onMouseDown={handleResizeStart}>
            <div className="resize-handle-grip" />
          </div>
        )}
      </div>
    );
  }
);

/**
 * SessionEditorArea - Wraps inner component with TabsProvider
 *
 * This is the main entry point for embedding session editors.
 * It manages the Jotai state for layout and wraps with TabsProvider for tab management.
 */
const SessionEditorAreaComponent = forwardRef<SessionEditorAreaRef, SessionEditorAreaProps>(
  function SessionEditorArea({ sessionId, workspacePath, children, onTabCountChange: onTabCountChangeProp }, ref) {
    const state = useAtomValue(sessionEditorStateAtom(sessionId));
    const setLayoutMode = useSetAtom(setSessionLayoutModeAtom);
    const setSplitRatio = useSetAtom(setSessionSplitRatioAtom);
    const setTabCountAtom = useSetAtom(setSessionTabCountAtom);
    const innerRef = useRef<SessionEditorAreaRef>(null);
    const [tabCount, setTabCount] = React.useState(0);

    // Forward ref methods
    useImperativeHandle(
      ref,
      () => ({
        openFile: (filePath: string) => {
          innerRef.current?.openFile(filePath);
        },
        hasTabs: () => innerRef.current?.hasTabs() ?? false,
      }),
      []
    );

    const handleLayoutModeChange = useCallback(
      (mode: SessionLayoutMode) => {
        setLayoutMode({ sessionId, mode });
      },
      [sessionId, setLayoutMode]
    );

    const handleSplitRatioChange = useCallback(
      (ratio: number) => {
        setSplitRatio({ sessionId, ratio });
      },
      [sessionId, setSplitRatio]
    );

    const handleTabCountChange = useCallback((count: number) => {
      setTabCount(count);
      // Sync to Jotai atom so header can read it
      setTabCountAtom({ sessionId, count });
      onTabCountChangeProp?.(count);
    }, [sessionId, setTabCountAtom, onTabCountChangeProp]);

    // Always render TabsProvider to maintain tab state, but inner may return null
    // Use disablePersistence so session editors don't restore/save to workspace state
    // Note: isActive is read from Jotai atom by inner component, not passed as prop
    return (
      <TabsProvider workspacePath={workspacePath} disablePersistence>
        <SessionEditorAreaInner
          ref={innerRef}
          sessionId={sessionId}
          workspacePath={workspacePath}
          layoutMode={state.layoutMode}
          splitRatio={state.splitRatio}
          onLayoutModeChange={handleLayoutModeChange}
          onSplitRatioChange={handleSplitRatioChange}
          onTabCountChange={handleTabCountChange}
        />
      </TabsProvider>
    );
  }
);

/**
 * Memoized SessionEditorArea - prevents re-renders when parent re-renders
 * due to unrelated state changes (like sessionData updates).
 * The TabsProvider inside is expensive to re-render.
 */
export const SessionEditorArea = React.memo(SessionEditorAreaComponent);

export default SessionEditorArea;
