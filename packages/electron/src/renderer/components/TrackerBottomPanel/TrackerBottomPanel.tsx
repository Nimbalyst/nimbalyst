import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { TrackerTable, SortColumn as TrackerSortColumn, SortDirection as TrackerSortDirection, trackerItemCountByTypeAtom } from '@nimbalyst/runtime/plugins/TrackerPlugin';
import { MaterialSymbol } from '@nimbalyst/runtime';
import { globalRegistry, loadBuiltinTrackers } from '@nimbalyst/runtime/plugins/TrackerPlugin/models';
import { usePostHog } from 'posthog-js/react';
import type { TrackerItemType } from '@nimbalyst/runtime';
import {
  activeTrackerTypeAtom,
  trackerPanelHeightAtom,
  trackerSettingsVisibleAtom,
  setActiveTrackerTypeAtom,
  setTrackerPanelHeightAtom,
  toggleTrackerSettingsAtom,
  closeTrackerPanelAtom,
  type TrackerType,
} from '../../store/atoms/trackers';

// Load built-in trackers immediately at module level
loadBuiltinTrackers();

export type TrackerBottomPanelType = string; // Now dynamic based on registered trackers

interface BottomPanelProps {
  minHeight?: number;
  maxHeight?: number;
  onSwitchToFilesMode?: () => void;
  /** Workspace path for writing tracker files */
  workspacePath?: string;
}

/** Small component so each tab badge subscribes to its own atom */
function TrackerTabCount({ type }: { type: TrackerItemType }) {
  const count = useAtomValue(trackerItemCountByTypeAtom(type));
  return <>{count}</>;
}

export const TrackerBottomPanel: React.FC<BottomPanelProps> = ({
  minHeight = 200,
  maxHeight = 800,
  onSwitchToFilesMode,
  workspacePath,
}) => {
  // Atom state
  const activePanel = useAtomValue(activeTrackerTypeAtom);
  const height = useAtomValue(trackerPanelHeightAtom);
  const showSettings = useAtomValue(trackerSettingsVisibleAtom);
  const setActivePanel = useSetAtom(setActiveTrackerTypeAtom);
  const setHeight = useSetAtom(setTrackerPanelHeightAtom);
  const toggleSettings = useSetAtom(toggleTrackerSettingsAtom);
  const closePanel = useSetAtom(closeTrackerPanelAtom);

  // Local state
  const [isResizing, setIsResizing] = useState(false);
  const [quickAddType, setQuickAddType] = useState<string | null>(null);
  const posthog = usePostHog();

  // Get available tracker types from registry, re-read when new trackers are registered
  const [registryVersion, setRegistryVersion] = useState(0);
  useEffect(() => {
    return globalRegistry.onChange(() => setRegistryVersion(v => v + 1));
  }, []);
  const trackerTypes = useMemo(() => {
    return globalRegistry.getAll();
  }, [registryVersion]);

  // Item counts are derived from atoms via TrackerTabCount component (per-tab subscription)

  // Track analytics when panel is opened or switched
  useEffect(() => {
    if (activePanel && posthog) {
      posthog.capture('tracker_tab_opened', {
        trackerType: activePanel,
      });
    }
  }, [activePanel, posthog]);

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
    setHeight(newHeight);
  }, [isResizing, minHeight, maxHeight, setHeight]);

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
    if (activePanel !== panel) {
      setActivePanel(panel as TrackerType);
    }
  };

  // Handle new item button click
  const handleNewItem = useCallback((type: string) => {
    posthog?.capture('tracker_quick_add_opened', { trackerType: type });
    setQuickAddType(type);
  }, [posthog]);

  const handleQuickAddClose = useCallback(() => {
    setQuickAddType(null);
  }, []);

  const handleQuickAddSubmit = useCallback(async (title: string, priority: string) => {
    if (!workspacePath || !quickAddType) return;

    try {
      const tracker = trackerTypes.find(t => t.type === quickAddType);
      const prefix = tracker?.idPrefix || quickAddType.substring(0, 3);
      const timestamp = Date.now().toString(36);
      const random = Math.random().toString(36).substring(2, 8);
      const id = `${prefix}_${timestamp}${random}`;

      const statusField = tracker?.fields.find(f => f.name === 'status');
      const defaultStatus = (statusField?.default as string) || 'to-do';
      const syncMode = tracker?.sync?.mode || 'local';

      const result = await window.electronAPI.documentService.createTrackerItem({
        id,
        type: quickAddType,
        title,
        status: defaultStatus,
        priority,
        workspace: workspacePath,
        syncMode,
      });

      if (!result.success) {
        throw new Error(result.error || 'Failed to create tracker item');
      }

      posthog?.capture('tracker_item_created', {
        trackerType: quickAddType,
        priority,
        source: 'quick_add_panel'
      });

      setQuickAddType(null);
    } catch (error) {
      console.error('[TrackerBottomPanel] Failed to create tracker item:', error);
    }
  }, [workspacePath, quickAddType, trackerTypes, posthog]);

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
            <div className="bottom-panel-header flex items-center justify-between h-7 px-1 bg-[var(--nim-bg-secondary)] border-b border-[var(--nim-border)] shrink-0">
              <div className="bottom-panel-tabs flex gap-0.5 items-center">
                {trackerTypes.map((tracker) => (
                  <button
                    key={tracker.type}
                    className={`bottom-panel-tab flex items-center gap-1.5 py-1 px-2.5 border-none text-[12px] cursor-pointer transition-colors duration-150 ${
                      activePanel === tracker.type
                        ? 'bg-[var(--nim-bg)] text-[var(--nim-text)] font-medium rounded-t border-b-2 border-b-[var(--nim-primary)]'
                        : 'bg-transparent text-[var(--nim-text-muted)] rounded hover:bg-[var(--nim-bg-hover)] hover:text-[var(--nim-text)]'
                    }`}
                    onClick={() => handlePanelClick(tracker.type)}
                  >
                    <MaterialSymbol icon={tracker.icon} size={14} />
                    {tracker.displayNamePlural}
                    <span
                      className={`tab-count py-px px-1.5 text-[10px] font-semibold rounded-full min-w-[16px] text-center ${
                        activePanel === tracker.type
                          ? 'bg-[var(--nim-primary)] text-white'
                          : 'bg-[var(--nim-bg-tertiary)] text-[var(--nim-text-muted)]'
                      }`}
                    >
                      <TrackerTabCount type={tracker.type as TrackerItemType} />
                    </span>
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1">
                <button
                  className={`bottom-panel-settings flex items-center justify-center w-6 h-6 p-0 bg-transparent border-none cursor-pointer rounded transition-colors duration-150 hover:bg-[var(--nim-bg-hover)] ${
                    showSettings ? 'text-[var(--nim-primary)]' : 'text-[var(--nim-text-muted)] hover:text-[var(--nim-text)]'
                  }`}
                  onClick={() => {
                    posthog?.capture('tracker_settings_toggled', { open: !showSettings });
                    toggleSettings();
                  }}
                  title="Tracker settings"
                >
                  <MaterialSymbol icon="settings" size={16} />
                </button>
                <button
                  className="bottom-panel-close flex items-center justify-center w-6 h-6 p-0 bg-transparent border-none text-[var(--nim-text-muted)] cursor-pointer rounded transition-colors duration-150 hover:bg-[var(--nim-bg-hover)] hover:text-[var(--nim-text)]"
                  onClick={() => closePanel()}
                  title="Close panel"
                >
                  <MaterialSymbol icon="close" size={18} />
                </button>
              </div>
            </div>
            <div className="bottom-panel-content flex-1 overflow-auto p-0 relative">
              {showSettings ? (
                <TrackerSettingsView
                  trackers={trackerTypes}
                  workspacePath={workspacePath}
                  onClose={() => toggleSettings()}
                />
              ) : activePanel ? (
                <TrackerTable
                  filterType={activePanel as 'all' | 'bug' | 'task' | 'plan' | 'idea' | 'decision'}
                  sortBy={trackerSortBy}
                  sortDirection={trackerSortDirection}
                  hideTypeTabs={true}
                  onSortChange={(column, direction) => {
                    setTrackerSortBy(column);
                    setTrackerSortDirection(direction);
                  }}
                  onSwitchToFilesMode={onSwitchToFilesMode}
                  onNewItem={handleNewItem}
                />
              ) : null}

              {quickAddType && !showSettings && (
                <QuickAddInline
                  type={quickAddType}
                  tracker={trackerTypes.find(t => t.type === quickAddType)}
                  onSubmit={handleQuickAddSubmit}
                  onClose={handleQuickAddClose}
                />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

/**
 * Quick Add Inline Form
 */
interface QuickAddInlineProps {
  type: string;
  tracker?: { displayName: string; icon: string; color: string };
  onSubmit: (title: string, priority: string) => void;
  onClose: () => void;
}

const QuickAddInline: React.FC<QuickAddInlineProps> = ({ type, tracker, onSubmit, onClose }) => {
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState('medium');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (title.trim()) {
      onSubmit(title.trim(), priority);
    }
  };

  const color = tracker?.color || '#6b7280';
  const displayName = tracker?.displayName || type.charAt(0).toUpperCase() + type.slice(1);
  const icon = tracker?.icon || 'label';

  return (
    <div
      className="quick-add-inline absolute top-0 left-0 right-0 bg-[var(--nim-bg-secondary)] border-b border-[var(--nim-border)] shadow-sm z-20"
      style={{
        animation: 'slideInDown 0.15s ease-out',
      }}
    >
      <form onSubmit={handleSubmit} className="flex items-center gap-3 px-4 py-2">
        <span className="material-symbols-outlined text-lg shrink-0" style={{ color }}>
          {icon}
        </span>

        <input
          ref={inputRef}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={`New ${displayName.toLowerCase()}...`}
          className="flex-1 min-w-0 px-3 py-1.5 bg-[var(--nim-bg)] border border-[var(--nim-border)] rounded text-sm text-[var(--nim-text)] placeholder:text-[var(--nim-text-faint)] focus:outline-none focus:border-[var(--nim-primary)]"
        />

        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          className="px-2 py-1.5 bg-[var(--nim-bg)] border border-[var(--nim-border)] rounded text-sm text-[var(--nim-text)] focus:outline-none focus:border-[var(--nim-primary)] shrink-0"
        >
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="critical">Critical</option>
        </select>

        <button
          type="submit"
          disabled={!title.trim()}
          className="px-3 py-1.5 rounded text-sm font-medium text-white border-none cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 shrink-0"
          style={{ backgroundColor: color }}
        >
          Add
        </button>

        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded hover:bg-[var(--nim-bg-hover)] text-[var(--nim-text-muted)] shrink-0"
          title="Cancel (Esc)"
        >
          <MaterialSymbol icon="close" size={18} />
        </button>
      </form>

      <style>{`
        @keyframes slideInDown {
          from {
            transform: translateY(-100%);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
};

/**
 * Tracker Settings View
 */
interface TrackerSettingsViewProps {
  trackers: Array<{
    type: string;
    displayName: string;
    displayNamePlural: string;
    icon: string;
    color: string;
    modes: { inline: boolean; fullDocument: boolean };
  }>;
  workspacePath?: string;
  onClose: () => void;
}

const TrackerSettingsView: React.FC<TrackerSettingsViewProps> = ({ trackers, workspacePath }) => {
  const [enabledTrackers, setEnabledTrackers] = useState<Set<string>>(() => new Set(trackers.map(t => t.type)));

  const handleToggle = (type: string) => {
    setEnabledTrackers(prev => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  };

  const handleOpenConfigFile = async (type: string) => {
    if (!workspacePath) return;
    const configPath = `${workspacePath}/.nimbalyst/trackers/${type}.yaml`;
    await window.electronAPI?.invoke('workspace:open-file', { workspacePath, filePath: configPath });
  };

  return (
    <div className="tracker-settings-view h-full flex gap-6 p-4 overflow-auto">
      <div className="flex flex-wrap items-start gap-2 content-start flex-1 min-w-0">
        {trackers.map((tracker) => (
          <div
            key={tracker.type}
            className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)]"
          >
            <span className="material-symbols-outlined text-base" style={{ color: tracker.color }}>
              {tracker.icon}
            </span>
            <span className="text-sm text-[var(--nim-text)]">{tracker.displayNamePlural}</span>

            <button
              className="p-0.5 rounded hover:bg-[var(--nim-bg-hover)] text-[var(--nim-text-faint)] hover:text-[var(--nim-text)] transition-colors"
              onClick={() => handleOpenConfigFile(tracker.type)}
              title={`Edit ${tracker.type}.yaml`}
            >
              <MaterialSymbol icon="edit" size={14} />
            </button>

            <button
              className={`relative w-8 h-4 rounded-full transition-colors ${
                enabledTrackers.has(tracker.type)
                  ? 'bg-[var(--nim-primary)]'
                  : 'bg-[var(--nim-bg-tertiary)]'
              }`}
              onClick={() => handleToggle(tracker.type)}
              title={enabledTrackers.has(tracker.type) ? 'Disable' : 'Enable'}
            >
              <div
                className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${
                  enabledTrackers.has(tracker.type) ? 'translate-x-4' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>
        ))}
      </div>

      <div className="w-80 shrink-0 flex flex-col gap-3 text-sm text-[var(--nim-text-muted)]">
        <div className="font-medium text-[var(--nim-text)]">Customizing Trackers</div>
        <p className="m-0">
          Each tracker type is defined in a YAML config file at <code className="px-1 py-0.5 rounded bg-[var(--nim-bg-secondary)] text-xs">.nimbalyst/trackers/</code>. Click the edit icon to open a tracker's config.
        </p>
        <p className="m-0">
          You can customize fields, status options, priorities, colors, and how items display in the table.
        </p>
        <p className="m-0 text-xs text-[var(--nim-text-faint)]">
          Tip: Ask Claude to help create custom trackers. Try: "Create a tracker for feature requests with vote count and target version fields"
        </p>
      </div>
    </div>
  );
};
