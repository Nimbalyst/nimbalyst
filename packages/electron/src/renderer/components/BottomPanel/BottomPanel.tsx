import React, { useState, useCallback, useRef, useEffect } from 'react';
import './BottomPanel.css';
import { TrackerTable, SortColumn as TrackerSortColumn, SortDirection as TrackerSortDirection } from '@nimbalyst/runtime/plugins/ItemTrackerPlugin/TrackerTable';
import { MaterialSymbol } from '../MaterialSymbol';

export type BottomPanelType = 'plans' | 'bugs' | 'tasks' | 'ideas' | 'decisions';

interface BottomPanelProps {
  activePanel: BottomPanelType | null;
  onPanelChange: (panel: BottomPanelType | null) => void;
  height: number;
  onHeightChange: (height: number) => void;
  minHeight?: number;
  maxHeight?: number;
}

interface ItemCounts {
  plans: number;
  bugs: number;
  tasks: number;
  ideas: number;
  decisions: number;
}

export const  BottomPanel: React.FC<BottomPanelProps> = ({
  activePanel,
  onPanelChange,
  height,
  onHeightChange,
  minHeight = 200,
  maxHeight = 800,
}) => {
  const [isResizing, setIsResizing] = useState(false);
  const [itemCounts, setItemCounts] = useState<ItemCounts>({ plans: 0, bugs: 0, tasks: 0, ideas: 0, decisions: 0 });

  // Debug logging
  useEffect(() => {
    console.log('[BottomPanel Component] activePanel:', activePanel, 'height:', height, 'visible:', activePanel !== null);
  }, [activePanel, height]);

  // Load item counts
  useEffect(() => {
    let mounted = true;
    let retryTimer: NodeJS.Timeout | null = null;

    async function loadCounts() {
      const documentService = (window as any).documentService;

      if (!documentService) {
        console.log('[BottomPanel] documentService not available, will retry...');
        if (mounted) {
          retryTimer = setTimeout(() => loadCounts(), 500);
        }
        return;
      }

      if (!documentService.listTrackerItems) {
        console.log('[BottomPanel] listTrackerItems not available, will retry...');
        // Retry after a delay
        if (mounted) {
          retryTimer = setTimeout(() => loadCounts(), 500);
        }
        return;
      }

      try {
        const items = await documentService.listTrackerItems();
        if (!mounted) return;

        console.log('[BottomPanel] Loaded tracker items:', items.length);
        const counts: ItemCounts = {
          plans: items.filter((i: any) => i.type === 'plan' && i.status !== 'done').length,
          bugs: items.filter((i: any) => i.type === 'bug' && i.status !== 'done').length,
          tasks: items.filter((i: any) => i.type === 'task' && i.status !== 'done').length,
          ideas: items.filter((i: any) => i.type === 'idea').length,
          decisions: items.filter((i: any) => i.type === 'decision').length,
        };
        console.log('[BottomPanel] Counts:', counts);
        setItemCounts(counts);
      } catch (error) {
        console.error('[BottomPanel] Failed to load item counts:', error);
      }
    }

    loadCounts();

    // Subscribe to changes
    const documentService = (window as any).documentService;
    let unsubscribe: (() => void) | undefined;
    if (documentService && documentService.watchTrackerItems) {
      unsubscribe = documentService.watchTrackerItems(() => {
        if (mounted) loadCounts();
      });
    }

    return () => {
      mounted = false;
      if (retryTimer) clearTimeout(retryTimer);
      if (unsubscribe) unsubscribe();
    };
  }, []);

  const [trackerSortBy, setTrackerSortBy] = useState<TrackerSortColumn>('lastIndexed');
  const [trackerSortDirection, setTrackerSortDirection] = useState<TrackerSortDirection>('desc');
  const resizeStartY = useRef<number>(0);
  const resizeStartHeight = useRef<number>(0);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    resizeStartY.current = e.clientY;
    resizeStartHeight.current = height;
  }, [height]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing) return;

    const deltaY = resizeStartY.current - e.clientY;
    const newHeight = Math.min(
      Math.max(resizeStartHeight.current + deltaY, minHeight),
      maxHeight
    );
    onHeightChange(newHeight);
  }, [isResizing, minHeight, maxHeight, onHeightChange]);

  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
  }, []);

  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'ns-resize';
      document.body.style.userSelect = 'none';

      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
    }
  }, [isResizing, handleMouseMove, handleMouseUp]);

  const handlePanelClick = (panel: BottomPanelType) => {
    if (activePanel === panel) {
      onPanelChange(null);
    } else {
      onPanelChange(panel);
    }
  };

  const isVisible = activePanel !== null;

  return (
    <div
      className={`bottom-panel-container ${isVisible ? 'visible' : 'hidden'}`}
      style={{ height: isVisible ? `${height}px` : undefined }}
    >
      {isVisible && (
        <>
          <div className="bottom-panel-resize-handle" onMouseDown={handleMouseDown} />
          <div className="bottom-panel" style={{ height: '100%' }}>
            <div className="bottom-panel-header">
              <div className="bottom-panel-tabs">
                <button
                  className={`bottom-panel-tab ${activePanel === 'plans' ? 'active' : ''}`}
                  onClick={() => handlePanelClick('plans')}
                >
                  <MaterialSymbol icon="edit_note" size={16} />
                  Plans
                  <span className="tab-count">{itemCounts.plans}</span>
                </button>
                <button
                  className={`bottom-panel-tab ${activePanel === 'bugs' ? 'active' : ''}`}
                  onClick={() => handlePanelClick('bugs')}
                >
                  <MaterialSymbol icon="bug_report" size={16} />
                  Bugs
                  <span className="tab-count">{itemCounts.bugs}</span>
                </button>
                <button
                  className={`bottom-panel-tab ${activePanel === 'tasks' ? 'active' : ''}`}
                  onClick={() => handlePanelClick('tasks')}
                >
                  <MaterialSymbol icon="task_alt" size={16} />
                  Tasks
                  <span className="tab-count">{itemCounts.tasks}</span>
                </button>
                <button
                  className={`bottom-panel-tab ${activePanel === 'ideas' ? 'active' : ''}`}
                  onClick={() => handlePanelClick('ideas')}
                >
                  <MaterialSymbol icon="lightbulb" size={16} />
                  Ideas
                  <span className="tab-count">{itemCounts.ideas}</span>
                </button>
                <button
                  className={`bottom-panel-tab ${activePanel === 'decisions' ? 'active' : ''}`}
                  onClick={() => handlePanelClick('decisions')}
                >
                  <MaterialSymbol icon="gavel" size={16} />
                  Decisions
                  <span className="tab-count">{itemCounts.decisions}</span>
                </button>
              </div>
              <button
                className="bottom-panel-close"
                onClick={() => onPanelChange(null)}
                title="Close panel"
              >
                <MaterialSymbol icon="close" size={18} />
              </button>
            </div>
            <div className="bottom-panel-content">
              {activePanel === 'plans' && (
                <TrackerTable
                  filterType="plan"
                  sortBy={trackerSortBy}
                  sortDirection={trackerSortDirection}
                  hideTypeTabs={true}
                  onSortChange={(column, direction) => {
                    setTrackerSortBy(column);
                    setTrackerSortDirection(direction);
                  }}
                />
              )}
              {activePanel === 'bugs' && (
                <TrackerTable
                  filterType="bug"
                  sortBy={trackerSortBy}
                  sortDirection={trackerSortDirection}
                  hideTypeTabs={true}
                  onSortChange={(column, direction) => {
                    setTrackerSortBy(column);
                    setTrackerSortDirection(direction);
                  }}
                />
              )}
              {activePanel === 'tasks' && (
                <TrackerTable
                  filterType="task"
                  sortBy={trackerSortBy}
                  sortDirection={trackerSortDirection}
                  hideTypeTabs={true}
                  onSortChange={(column, direction) => {
                    setTrackerSortBy(column);
                    setTrackerSortDirection(direction);
                  }}
                />
              )}
              {activePanel === 'ideas' && (
                <TrackerTable
                  filterType="idea"
                  sortBy={trackerSortBy}
                  sortDirection={trackerSortDirection}
                  hideTypeTabs={true}
                  onSortChange={(column, direction) => {
                    setTrackerSortBy(column);
                    setTrackerSortDirection(direction);
                  }}
                />
              )}
              {activePanel === 'decisions' && (
                <TrackerTable
                  filterType="decision"
                  sortBy={trackerSortBy}
                  sortDirection={trackerSortDirection}
                  hideTypeTabs={true}
                  onSortChange={(column, direction) => {
                    setTrackerSortBy(column);
                    setTrackerSortDirection(direction);
                  }}
                />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
