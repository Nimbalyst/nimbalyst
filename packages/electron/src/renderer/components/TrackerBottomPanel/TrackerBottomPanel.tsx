import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { TrackerTable, SortColumn as TrackerSortColumn, SortDirection as TrackerSortDirection } from '@nimbalyst/runtime/plugins/TrackerPlugin';
import { MaterialSymbol, getFileIcon } from '@nimbalyst/runtime';
import { globalRegistry, loadBuiltinTrackers } from '@nimbalyst/runtime/plugins/TrackerPlugin/models';
import { usePostHog } from 'posthog-js/react';

// Load built-in trackers immediately at module level
loadBuiltinTrackers();

export type TrackerBottomPanelType = string; // Now dynamic based on registered trackers

interface BottomPanelProps {
  activePanel: TrackerBottomPanelType | null;
  onPanelChange: (panel: TrackerBottomPanelType | null) => void;
  height: number;
  onHeightChange: (height: number) => void;
  minHeight?: number;
  maxHeight?: number;
  onSwitchToFilesMode?: () => void;
}

interface ItemCounts {
  [key: string]: number; // Dynamic counts by tracker type
}

export const  TrackerBottomPanel: React.FC<BottomPanelProps> = ({
  activePanel,
  onPanelChange,
  height,
  onHeightChange,
  minHeight = 200,
  maxHeight = 800,
  onSwitchToFilesMode,
}) => {
  const [isResizing, setIsResizing] = useState(false);
  const posthog = usePostHog();

  // Get available tracker types from registry
  const trackerTypes = useMemo(() => {
    return globalRegistry.getAll();
  }, []);

  // Initialize counts for all tracker types
  const [itemCounts, setItemCounts] = useState<ItemCounts>(() => {
    const counts: ItemCounts = {};
    trackerTypes.forEach(tracker => {
      counts[tracker.type] = 0;
    });
    return counts;
  });

  // Refresh key to force TrackerTable to reload when data changes
  const [refreshKey, setRefreshKey] = useState(0);

  // Debug logging
   // useEffect(() => {
  //   console.log('[TrackerBottomPanel Component] activePanel:', activePanel, 'height:', height, 'visible:', activePanel !== null);
  // }, [activePanel, height]);

  // Load item counts
  useEffect(() => {
    let mounted = true;
    let retryTimer: NodeJS.Timeout | null = null;

    async function loadCounts() {
      const documentService = (window as any).documentService;

      if (!documentService) {
        // console.log('[TrackerBottomPanel] documentService not available, will retry...');
        if (mounted) {
          retryTimer = setTimeout(() => loadCounts(), 500);
        }
        return;
      }

      if (!documentService.listTrackerItems) {
        // console.log('[TrackerBottomPanel] listTrackerItems not available, will retry...');
        // Retry after a delay
        if (mounted) {
          retryTimer = setTimeout(() => loadCounts(), 500);
        }
        return;
      }

      try {
        // Trigger initial scan if needed (this will populate tracker items)
        if (documentService.refreshWorkspaceData) {
          await documentService.refreshWorkspaceData();
        }

        const items = await documentService.listTrackerItems();
        if (!mounted) return;

        // console.log('[TrackerBottomPanel] Loaded tracker items:', items.length);

        // Count tracker items dynamically for all types
        const counts: ItemCounts = {};
        trackerTypes.forEach(tracker => {
          // Count inline items from tracker_items table
          const inlineCount = items.filter((i: any) => {
            if (i.type !== tracker.type) return false;
            // Exclude 'done' and 'completed' status items
            const status = (i.status || '').toLowerCase();
            return status !== 'done' && status !== 'completed';
          }).length;

          counts[tracker.type] = inlineCount;
        });

        // Also count full-document trackers (plan, decision) from frontmatter
        if (documentService.listDocumentMetadata) {
          const metadata = await documentService.listDocumentMetadata();

          // For each tracker type that supports fullDocument mode
          trackerTypes.forEach(tracker => {
            if (!tracker.modes.fullDocument) return;

            const frontmatterKey = `${tracker.type}Status`; // e.g., 'planStatus', 'decisionStatus'
            const fullDocCount = metadata.filter((doc: any) => {
              if (!doc.frontmatter || !doc.frontmatter[frontmatterKey]) return false;

              const pathLower = doc.path.toLowerCase();
              const isAgentFile = pathLower.includes('/agents/') || pathLower.includes('\\agents\\');
              if (isAgentFile) return false;

              const status = (doc.frontmatter[frontmatterKey].status || '').toLowerCase();
              return status !== 'completed' && status !== 'done';
            }).length;

            counts[tracker.type] = (counts[tracker.type] || 0) + fullDocCount;
          });
        }

        // console.log('[TrackerBottomPanel] Counts:', counts);
        setItemCounts(counts);
      } catch (error) {
        console.error('[TrackerBottomPanel] Failed to load item counts:', error);
      }
    }

    loadCounts();

    // Subscribe to changes
    const documentService = (window as any).documentService;
    let unsubscribeTracker: (() => void) | undefined;
    let unsubscribeMetadata: (() => void) | undefined;

    if (documentService && documentService.watchTrackerItems) {
      unsubscribeTracker = documentService.watchTrackerItems(() => {
        if (mounted) {
          loadCounts();
          setRefreshKey(prev => prev + 1); // Force TrackerTable to reload
        }
      });
    }

    if (documentService && documentService.watchDocumentMetadata) {
      unsubscribeMetadata = documentService.watchDocumentMetadata(() => {
        if (mounted) {
          loadCounts();
          setRefreshKey(prev => prev + 1); // Force TrackerTable to reload
        }
      });
    }

    return () => {
      mounted = false;
      if (retryTimer) clearTimeout(retryTimer);
      if (unsubscribeTracker) unsubscribeTracker();
      if (unsubscribeMetadata) unsubscribeMetadata();
    };
  }, [trackerTypes]);

  // Track analytics when panel is opened or switched
  // Only fire when activePanel changes, not when itemCounts updates
  useEffect(() => {
    if (activePanel && posthog) {
      posthog.capture('tracker_tab_opened', {
        trackerType: activePanel,
        itemCount: itemCounts[activePanel] || 0,
      });
    }
  }, [activePanel, posthog]); // Removed itemCounts dependency

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
    return undefined;
  }, [isResizing, handleMouseMove, handleMouseUp]);

  const handlePanelClick = (panel: TrackerBottomPanelType) => {
    if (activePanel === panel) {
      onPanelChange(null);
    } else {
      onPanelChange(panel);
    }
  };

  const isVisible = activePanel !== null;

  return (
    <div
      className={`bottom-panel-container relative shrink-0 flex flex-col transition-[height] duration-200 ease-in-out ${isVisible ? 'visible flex' : 'hidden h-0 overflow-hidden !hidden'}`}
      style={{ height: isVisible ? `${height}px` : undefined }}
    >
      {isVisible && (
        <>
          <div
            className="bottom-panel-resize-handle absolute top-0 left-0 right-0 h-1 cursor-ns-resize z-10 bg-transparent hover:bg-[var(--nim-primary)]"
            onMouseDown={handleMouseDown}
          />
          <div className="bottom-panel flex flex-col bg-[var(--nim-bg)] border-t-2 border-[var(--nim-border)] overflow-hidden" style={{ height: '100%' }}>
            <div className="bottom-panel-header flex items-center justify-between h-8 px-1.5 bg-[var(--nim-bg-secondary)] border-b border-[var(--nim-border)] shrink-0">
              <div className="bottom-panel-tabs flex gap-0.5 items-center">
                {trackerTypes.map((tracker) => (
                  <button
                    key={tracker.type}
                    className={`bottom-panel-tab flex items-center gap-1 py-1 px-3 bg-transparent border-none text-[13px] cursor-pointer rounded transition-colors duration-150 ${
                      activePanel === tracker.type
                        ? 'active bg-[var(--nim-bg)] text-[var(--nim-text)] font-medium'
                        : 'text-[var(--nim-text-muted)] hover:bg-[var(--nim-bg-hover)] hover:text-[var(--nim-text)]'
                    }`}
                    onClick={() => handlePanelClick(tracker.type)}
                  >
                    <MaterialSymbol icon={tracker.icon} size={16} />
                    {tracker.displayNamePlural}
                    <span
                      className={`tab-count ml-1 py-px px-1.5 text-[11px] font-semibold rounded-[10px] min-w-[18px] text-center ${
                        activePanel === tracker.type
                          ? 'bg-[var(--nim-primary)] text-white'
                          : 'bg-[var(--nim-bg-tertiary)] text-[var(--nim-text-muted)]'
                      }`}
                    >
                      {itemCounts[tracker.type] || 0}
                    </span>
                  </button>
                ))}
              </div>
              <button
                className="bottom-panel-close flex items-center justify-center w-6 h-6 p-0 bg-transparent border-none text-[var(--nim-text-muted)] cursor-pointer rounded transition-colors duration-150 hover:bg-[var(--nim-bg-hover)] hover:text-[var(--nim-text)]"
                onClick={() => onPanelChange(null)}
                title="Close panel"
              >
                <MaterialSymbol icon="close" size={18} />
              </button>
            </div>
            <div className="bottom-panel-content flex-1 overflow-auto p-0">
              {activePanel && (
                <TrackerTable
                  key={refreshKey}
                  filterType={activePanel as 'all' | 'bug' | 'task' | 'plan' | 'idea' | 'decision'}
                  sortBy={trackerSortBy}
                  sortDirection={trackerSortDirection}
                  hideTypeTabs={true}
                  onSortChange={(column, direction) => {
                    setTrackerSortBy(column);
                    setTrackerSortDirection(direction);
                  }}
                  onSwitchToFilesMode={onSwitchToFilesMode}
                />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
