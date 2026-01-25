/**
 * TrackerTable - Standalone table component for displaying tracker items
 * Shows bugs, tasks, plans, and ideas across all documents in workspace
 */

import React, { useEffect, useState, useCallback } from 'react';
import type {
  TrackerItem,
  TrackerItemChangeEvent,
  TrackerItemType,
  TrackerItemStatus,
  TrackerItemPriority
} from '../../../core/DocumentService';
import { globalRegistry } from '../models';
import {usePostHog} from "posthog-js/react";

export type SortColumn = 'title' | 'type' | 'status' | 'priority' | 'progress' | 'module' | 'lastIndexed';
export type SortDirection = 'asc' | 'desc';

interface TrackerTableProps {
  filterType?: TrackerItemType | 'all';
  sortBy?: SortColumn;
  sortDirection?: SortDirection;
  onSortChange?: (column: SortColumn, direction: SortDirection) => void;
  hideTypeTabs?: boolean;
  onSwitchToFilesMode?: () => void;
}

function getStatusColor(status: TrackerItemStatus): string {
  const statusColors: Record<string, string> = {
    'to-do': '#6b7280',
    'in-progress': '#eab308',
    'in-review': '#8b5cf6',
    'done': '#22c55e',
    'blocked': '#ef4444',
  };
  return statusColors[status] || '#6b7280';
}

function getPriorityColor(priority: TrackerItemPriority | undefined): string {
  if (!priority) return '#6b7280';
  const priorityColors: Record<string, string> = {
    'critical': '#dc2626',
    'high': '#ef4444',
    'medium': '#f59e0b',
    'low': '#6b7280',
  };
  return priorityColors[priority] || '#6b7280';
}

function getTypeIcon(type: TrackerItemType): string {
  const icons: Record<TrackerItemType, string> = {
    'bug': 'bug_report',
    'task': 'check_box',
    'plan': 'assignment',
    'idea': 'lightbulb',
    'decision': 'gavel'
  };
  return icons[type];
}

function formatDate(date: Date): string {
  // If date is invalid or epoch (our placeholder for missing dates), show nothing
  if (!date || date.getTime() === 0 || isNaN(date.getTime())) {
    return '';
  }

  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return date.toLocaleDateString();
}

/**
 * Convert full-document tracker items (from frontmatter) to TrackerItem format
 * Works for any tracker type that supports fullDocument mode (plan, decision, etc.)
 */
function convertFullDocumentToTrackerItems(metadata: any[], trackerType: TrackerItemType): TrackerItem[] {
  // Get the frontmatter key for this tracker type (e.g., 'planStatus', 'decisionStatus')
  const frontmatterKey = `${trackerType}Status`;

  return metadata
    .filter(doc => {
      // Only include documents that have the tracker's frontmatter key
      const hasTrackerStatus = !!(doc.frontmatter && doc.frontmatter[frontmatterKey]);

      // Exclude agent files
      const pathLower = doc.path.toLowerCase();
      const isAgentFile = pathLower.includes('/agents/') || pathLower.includes('\\agents\\');

      return hasTrackerStatus && !isAgentFile;
    })
    .map(doc => {
      const trackerStatus = doc.frontmatter[frontmatterKey] as any || {};
      const frontmatter = doc.frontmatter;

      // Map status to standard tracker item status
      let status: TrackerItemStatus = 'to-do';
      const statusValue = (trackerStatus.status || frontmatter.status || 'draft').toLowerCase();

      if (statusValue === 'completed' || statusValue === 'done' || statusValue === 'decided' || statusValue === 'implemented') {
        status = 'done';
      } else if (statusValue === 'in-progress' || statusValue === 'in-development' || statusValue === 'evaluating') {
        status = 'in-progress';
      } else if (statusValue === 'in-review') {
        status = 'in-review';
      } else if (statusValue === 'blocked') {
        status = 'blocked';
      }

      // Use file modified date for full-document trackers (more accurate than frontmatter)
      // This ensures recently-edited plans appear at the top regardless of frontmatter state
      let actualDate: Date | null = null;

      if (doc.lastModified) {
        // lastModified can be a Date object or ISO string
        if (doc.lastModified instanceof Date) {
          actualDate = doc.lastModified;
        } else {
          const parsed = new Date(doc.lastModified);
          if (!isNaN(parsed.getTime())) {
            actualDate = parsed;
          }
        }
      }

      return {
        type: trackerType,
        title: trackerStatus.title || frontmatter.title || doc.path.split('/').pop()?.replace('.md', '') || 'Untitled',
        status,
        priority: (trackerStatus.priority || frontmatter.priority || 'medium') as TrackerItemPriority,
        module: doc.path,
        lineNumber: 0,
        owner: trackerStatus.owner || frontmatter.owner,
        tags: trackerStatus.tags || frontmatter.tags,
        progress: trackerStatus.progress || frontmatter.progress,
        lastIndexed: actualDate || new Date(0), // Use epoch for invalid dates
      } as TrackerItem;
    });
}

export function TrackerTable({
  filterType = 'all',
  sortBy = 'lastIndexed',
  sortDirection = 'desc',
  onSortChange,
  hideTypeTabs = false,
  onSwitchToFilesMode,
}: TrackerTableProps): JSX.Element {
  const [items, setItems] = useState<TrackerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentSortBy, setCurrentSortBy] = useState<SortColumn>(sortBy);
  const [currentSortDirection, setCurrentSortDirection] = useState<SortDirection>(sortDirection);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  // Only use internal type filter state when tabs are shown (not hidden by parent)
  const [internalTypeFilter, setInternalTypeFilter] = useState<TrackerItemType | 'all'>('all');
  const posthog = usePostHog();

  // Use prop filterType when hideTypeTabs is true, otherwise use internal state
  const activeTypeFilter = hideTypeTabs ? filterType : internalTypeFilter;

  useEffect(() => {
    let unsubscribeTracker: (() => void) | null = null;
    let unsubscribeMetadata: (() => void) | null = null;
    let isSubscribed = true;

    async function loadItems() {
      try {
        // console.log('[TrackerTable] loadItems called, typeFilter:', typeFilter);
        const documentService = (window as any).documentService;

        if (!documentService) {
          console.log('[TrackerTable] Document service not available yet');
          setError('Document service not available');
          setLoading(false);
          return;
        }

        if (!documentService.listTrackerItems) {
          console.log('[TrackerTable] listTrackerItems not available');
          setError('Tracker items not supported');
          setLoading(false);
          return;
        }

        // Load tracker items
        // console.log('[TrackerTable] Loading tracker items...');
        const trackerItems = activeTypeFilter !== 'all' && documentService.getTrackerItemsByType
          ? await documentService.getTrackerItemsByType(activeTypeFilter)
          : await documentService.listTrackerItems();

        // console.log('[TrackerTable] Loaded tracker items:', trackerItems?.length || 0);

        // Convert to proper date format - use updated/created, NOT lastIndexed (that's indexing time)
        let allItems = (trackerItems || []).map((item: TrackerItem) => {
          // Use updated field first (when user last modified), then created
          // DO NOT use lastIndexed - that's when the indexer last ran, not when user modified
          const dateSource = item.updated || item.created;
          let actualDate: Date | null = null;

          if (dateSource) {
            if (typeof dateSource === 'number') {
              actualDate = new Date(dateSource);
            } else if (typeof dateSource === 'string') {
              const parsed = new Date(dateSource);
              if (!isNaN(parsed.getTime())) {
                actualDate = parsed;
              }
            }
          }

          return {
            ...item,
            lastIndexed: actualDate || new Date(0) // Use epoch for invalid dates so they sort to bottom
          };
        });

        // Load full-document tracker items from frontmatter
        if (documentService.listDocumentMetadata) {
          const metadata = await documentService.listDocumentMetadata();

          // Get all tracker types that support fullDocument mode
          const trackerTypes = globalRegistry.getAll();
          const fullDocumentTrackers = trackerTypes.filter(t => t.modes.fullDocument);

          // console.log('[TrackerTable] Found full-document trackers:', fullDocumentTrackers.map(t => t.type));

          // Load items for each full-document tracker type
          for (const tracker of fullDocumentTrackers) {
            // Only load if we're showing all types or this specific type
            if (activeTypeFilter === 'all' || activeTypeFilter === tracker.type) {
              const items = convertFullDocumentToTrackerItems(metadata || [], tracker.type as TrackerItemType);
              // console.log(`[TrackerTable] Loaded ${items.length} ${tracker.type} items from frontmatter`);
              allItems = [...allItems, ...items];
            }
          }
        }

        // console.log('[TrackerTable] Total items to display:', allItems.length);
        if (isSubscribed) {
          setItems(allItems);
          setLoading(false);
          // console.log('[TrackerTable] State updated with', allItems.length, 'items');
        }
      } catch (err) {
        console.error('[TrackerTable] Failed to load tracker items:', err);
        if (isSubscribed) {
          setError('Failed to load tracker items');
          setLoading(false);
        }
      }
    }

    async function setupWatchers() {
      const documentService = (window as any).documentService;
      if (!documentService) {
        console.log('[TrackerTable] Cannot setup watchers - no document service');
        return;
      }

      // Subscribe to tracker item changes
      if (documentService.watchTrackerItems) {
        // console.log('[TrackerTable] Setting up tracker items watcher');
        unsubscribeTracker = documentService.watchTrackerItems((change: TrackerItemChangeEvent) => {
          console.log('[TrackerTable] Tracker items changed event received:', {
            added: change.added?.length || 0,
            updated: change.updated?.length || 0,
            removed: change.removed?.length || 0
          });
          // Only reload items, don't re-register watchers
          loadItems();
        });
      }

      // Subscribe to metadata changes (for full-document tracker types)
      // Need to watch metadata if we're showing all types or any type that supports fullDocument mode
      const trackerTypes = globalRegistry.getAll();
      const fullDocumentTrackers = trackerTypes.filter(t => t.modes.fullDocument);
      const needsMetadataWatcher = activeTypeFilter === 'all' || fullDocumentTrackers.some(t => t.type === activeTypeFilter);

      if (documentService.watchDocumentMetadata && needsMetadataWatcher) {
        // console.log('[TrackerTable] Setting up metadata watcher');
        unsubscribeMetadata = documentService.watchDocumentMetadata(() => {
          console.log('[TrackerTable] Metadata changed event received');
          // Only reload items, don't re-register watchers
          loadItems();
        });
      }
    }

    // Initial load
    loadItems();
    // Setup watchers once
    setupWatchers();

    return () => {
      isSubscribed = false;
      if (unsubscribeTracker) {
        unsubscribeTracker();
      }
      if (unsubscribeMetadata) {
        unsubscribeMetadata();
      }
    };
  }, [activeTypeFilter]);

  const sortItems = useCallback((itemsToSort: TrackerItem[], sortColumn: SortColumn, sortDir: SortDirection) => {
    const sorted = [...itemsToSort].sort((a, b) => {
      let compareValue = 0;

      switch (sortColumn) {
        case 'title':
          compareValue = a.title.localeCompare(b.title);
          break;
        case 'type':
          compareValue = a.type.localeCompare(b.type);
          break;
        case 'status':
          compareValue = a.status.localeCompare(b.status);
          break;
        case 'priority': {
          const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
          const aPriority = a.priority ? (priorityOrder[a.priority] ?? 4) : 4;
          const bPriority = b.priority ? (priorityOrder[b.priority] ?? 4) : 4;
          compareValue = aPriority - bPriority;
          break;
        }
        case 'progress': {
          const aProgress = a.progress ?? -1; // Items without progress sort to bottom
          const bProgress = b.progress ?? -1;
          compareValue = aProgress - bProgress;
          break;
        }
        case 'module':
          compareValue = a.module.localeCompare(b.module);
          break;
        case 'lastIndexed':
        default:
          compareValue = a.lastIndexed.getTime() - b.lastIndexed.getTime();
          break;
      }

      return sortDir === 'asc' ? compareValue : -compareValue;
    });

    return sorted;
  }, []);

  const filteredItems = items
    .filter(item => {
      // Apply search filter
      if (searchTerm) {
        const searchLower = searchTerm.toLowerCase();
        const matchesSearch =
          item.title.toLowerCase().includes(searchLower) ||
          item.module.toLowerCase().includes(searchLower) ||
          (item.owner && item.owner.toLowerCase().includes(searchLower)) ||
          (item.tags && item.tags.some(tag => tag.toLowerCase().includes(searchLower)));
        if (!matchesSearch) return false;
      }

      // Apply type filter
      if (activeTypeFilter !== 'all' && item.type !== activeTypeFilter) {
        return false;
      }

      // Apply status filter
      if (statusFilter !== 'all' && item.status !== statusFilter) {
        return false;
      }

      // Apply priority filter
      if (priorityFilter !== 'all' && item.priority !== priorityFilter) {
        return false;
      }

      return true;
    });

  // console.log('[TrackerTable] Render - items:', items.length, 'filtered:', filteredItems.length, 'typeFilter:', typeFilter);
  const sortedItems = sortItems(filteredItems, currentSortBy, currentSortDirection);

  const handleRowClick = (item: TrackerItem) => {
    // Track analytics
    if (posthog) {
      posthog.capture('tracker_item_clicked', {
        trackerType: item.type,
        itemStatus: item.status,
        isInline: item.lineNumber !== undefined && item.lineNumber !== 0,
      });
    }

    // Switch to files mode first if we're in agent mode
    if (onSwitchToFilesMode) {
      onSwitchToFilesMode();
    }

    // Open the document and scroll to the tracker item
    const documentService = (window as any).documentService;
    if (documentService && documentService.openDocument) {
      documentService.getDocumentByPath(item.module).then((doc: any) => {
        if (doc) {
          // Construct the full absolute path for the editor registry
          // item.workspace is the full workspace path, doc.path is relative
          const fullPath = item.workspace && doc.path
            ? `${item.workspace}/${doc.path}`.replace(/\/+/g, '/')
            : doc.path;

          documentService.openDocument(doc.id).then(() => {
            // Wait for editor to be ready and then scroll to the tracker item
            // Only scroll for inline items (full-document items don't need scrolling)
            if (item.lineNumber !== undefined && item.lineNumber !== 0) {
              const editorRegistry = (window as any).__editorRegistry;
              if (editorRegistry && item.id) {
                // Give the editor time to render and register
                setTimeout(() => {
                  // Use the full absolute path
                  editorRegistry.scrollToTrackerItem(fullPath, item.id);
                }, 500);
              }
            }
          });
        }
      });
    }
  };

  const handleColumnClick = (column: SortColumn) => {
    const newDirection = currentSortBy === column && currentSortDirection === 'desc' ? 'asc' : 'desc';
    if (currentSortBy !== column) {
      posthog.capture('tracker_table_sort', { column });
    }
    setCurrentSortBy(column);
    setCurrentSortDirection(newDirection);

    if (onSortChange) {
      onSortChange(column, newDirection);
    }
  };

  const getSortIndicator = (column: SortColumn) => {
    if (currentSortBy !== column) {
      return <span className="sort-indicator opacity-30 text-sm">&#8645;</span>;
    }
    return currentSortDirection === 'desc'
      ? <span className="sort-indicator active opacity-100 text-[var(--nim-primary)] text-sm">&#8595;</span>
      : <span className="sort-indicator active opacity-100 text-[var(--nim-primary)] text-sm">&#8593;</span>;
  };

  if (loading) {
    return (
      <div className="tracker-table-loading flex flex-col items-center justify-center py-[60px] px-5 text-[var(--nim-text-muted)] text-center gap-3">
        <div className="spinner w-8 h-8 border-[3px] border-[var(--nim-border)] border-t-[var(--nim-primary)] rounded-full animate-spin"></div>
        <span>Loading tracker items...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="tracker-table-error flex flex-col items-center justify-center py-[60px] px-5 text-[#ef4444] text-center gap-3">
        <span>Warning: {error}</span>
      </div>
    );
  }

  const statusOptions = [
    { value: 'all', label: 'All' },
    { value: 'to-do', label: 'To Do' },
    { value: 'in-progress', label: 'In Progress' },
    { value: 'in-review', label: 'In Review' },
    { value: 'done', label: 'Done' },
    { value: 'blocked', label: 'Blocked' },
  ];

  const priorityOptions = [
    { value: 'all', label: 'All' },
    { value: 'critical', label: 'Critical' },
    { value: 'high', label: 'High' },
    { value: 'medium', label: 'Medium' },
    { value: 'low', label: 'Low' },
  ];

  const typeOptions = [
    { value: 'all', label: 'All', icon: 'list' },
    { value: 'bug', label: 'Bugs', icon: 'bug_report' },
    { value: 'task', label: 'Tasks', icon: 'check_box' },
    { value: 'plan', label: 'Plans', icon: 'assignment' },
    { value: 'idea', label: 'Ideas', icon: 'lightbulb' },
    { value: 'decision', label: 'Decisions', icon: 'gavel' },
  ];

  return (
    <div className="tracker-table-wrapper flex flex-col h-full w-full bg-[var(--nim-bg)]">
      {/* Type filter tabs */}
      {!hideTypeTabs && (
        <div className="tracker-type-tabs flex gap-1 py-3 px-4 bg-[var(--nim-bg)] border-b border-[var(--nim-border)]">
          {typeOptions.map(option => (
            <button
              key={option.value}
              className={`tracker-type-tab flex items-center gap-1.5 py-2 px-3 bg-transparent border border-[var(--nim-border)] rounded-md text-[var(--nim-text-muted)] text-[13px] font-medium cursor-pointer transition-all duration-150 hover:bg-[var(--nim-bg-secondary)] ${internalTypeFilter === option.value ? 'active bg-[var(--nim-bg-secondary)] !border-[var(--nim-primary)] !text-[var(--nim-primary)]' : ''}`}
              onClick={() => setInternalTypeFilter(option.value as TrackerItemType | 'all')}
            >
              <span className="material-symbols-outlined text-lg">{option.icon}</span>
              <span>{option.label}</span>
              {option.value === 'all' && <span className={`count py-0.5 px-1.5 rounded-[10px] text-[11px] font-semibold ${internalTypeFilter === option.value ? 'bg-[var(--nim-primary)] text-[var(--nim-bg)]' : 'bg-[var(--nim-bg-tertiary)]'}`}>{items.length}</span>}
              {option.value !== 'all' && (
                <span className={`count py-0.5 px-1.5 rounded-[10px] text-[11px] font-semibold ${internalTypeFilter === option.value ? 'bg-[var(--nim-primary)] text-[var(--nim-bg)]' : 'bg-[var(--nim-bg-tertiary)]'}`}>{items.filter(i => i.type === option.value).length}</span>
              )}
            </button>
          ))}
        </div>
      )}

      <div className="tracker-table-container flex-1 overflow-auto px-3 pb-3">
        <table className="tracker-table w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th
                className="tracker-table-header type sortable sticky top-0 bg-[var(--nim-bg-secondary)] py-1.5 px-2 text-left text-[11px] font-semibold text-[var(--nim-text-faint)] uppercase tracking-[0.5px] border-b border-[var(--nim-border)] z-10 cursor-pointer select-none hover:bg-[var(--nim-bg-hover)]"
                onClick={() => handleColumnClick('type')}
              >
                <span className="header-content inline-flex items-center gap-1 whitespace-nowrap">
                  <span>TYPE</span>
                  {getSortIndicator('type')}
                </span>
              </th>
              <th
                className="tracker-table-header title sortable sticky top-0 bg-[var(--nim-bg-secondary)] py-1.5 px-2 text-left text-[11px] font-semibold text-[var(--nim-text-faint)] uppercase tracking-[0.5px] border-b border-[var(--nim-border)] z-10 cursor-pointer select-none hover:bg-[var(--nim-bg-hover)]"
                onClick={() => handleColumnClick('title')}
              >
                <span className="header-content inline-flex items-center gap-1 whitespace-nowrap">
                  <span>TITLE</span>
                  {getSortIndicator('title')}
                </span>
              </th>
              <th
                className="tracker-table-header status sortable sticky top-0 bg-[var(--nim-bg-secondary)] py-1.5 px-2 text-left text-[11px] font-semibold text-[var(--nim-text-faint)] uppercase tracking-[0.5px] border-b border-[var(--nim-border)] z-10 cursor-pointer select-none hover:bg-[var(--nim-bg-hover)]"
                onClick={() => handleColumnClick('status')}
              >
                <span className="header-content inline-flex items-center gap-1 whitespace-nowrap">
                  <span>STATUS</span>
                  {getSortIndicator('status')}
                </span>
              </th>
              <th
                className="tracker-table-header priority sortable sticky top-0 bg-[var(--nim-bg-secondary)] py-1.5 px-2 text-left text-[11px] font-semibold text-[var(--nim-text-faint)] uppercase tracking-[0.5px] border-b border-[var(--nim-border)] z-10 cursor-pointer select-none hover:bg-[var(--nim-bg-hover)]"
                onClick={() => handleColumnClick('priority')}
              >
                <span className="header-content inline-flex items-center gap-1 whitespace-nowrap">
                  <span>PRIORITY</span>
                  {getSortIndicator('priority')}
                </span>
              </th>
              <th
                className="tracker-table-header progress sortable sticky top-0 bg-[var(--nim-bg-secondary)] py-1.5 px-2 text-left text-[11px] font-semibold text-[var(--nim-text-faint)] uppercase tracking-[0.5px] border-b border-[var(--nim-border)] z-10 cursor-pointer select-none hover:bg-[var(--nim-bg-hover)]"
                onClick={() => handleColumnClick('progress')}
              >
                <span className="header-content inline-flex items-center gap-1 whitespace-nowrap">
                  <span>PROGRESS</span>
                  {getSortIndicator('progress')}
                </span>
              </th>
              <th
                className="tracker-table-header module sortable sticky top-0 bg-[var(--nim-bg-secondary)] py-1.5 px-2 text-left text-[11px] font-semibold text-[var(--nim-text-faint)] uppercase tracking-[0.5px] border-b border-[var(--nim-border)] z-10 cursor-pointer select-none hover:bg-[var(--nim-bg-hover)]"
                onClick={() => handleColumnClick('module')}
              >
                <span className="header-content inline-flex items-center gap-1 whitespace-nowrap">
                  <span>MODULE</span>
                  {getSortIndicator('module')}
                </span>
              </th>
              <th
                className="tracker-table-header updated sortable sticky top-0 bg-[var(--nim-bg-secondary)] py-1.5 px-2 text-left text-[11px] font-semibold text-[var(--nim-text-faint)] uppercase tracking-[0.5px] border-b border-[var(--nim-border)] z-10 cursor-pointer select-none hover:bg-[var(--nim-bg-hover)]"
                onClick={() => handleColumnClick('lastIndexed')}
              >
                <span className="header-content inline-flex items-center gap-1 whitespace-nowrap">
                  <span>UPDATED</span>
                  {getSortIndicator('lastIndexed')}
                </span>
              </th>
            </tr>
            <tr className="filter-row">
              <th className="tracker-table-header filter-cell py-2 px-3 bg-[var(--nim-bg)]"></th>
              <th className="tracker-table-header filter-cell py-2 px-3 bg-[var(--nim-bg)]">
                <input
                  type="text"
                  className="filter-input w-full py-1 px-1.5 bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] rounded text-[var(--nim-text)] text-xs focus:outline-none focus:border-[var(--nim-primary)]"
                  placeholder="Search..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </th>
              <th className="tracker-table-header filter-cell py-2 px-3 bg-[var(--nim-bg)]">
                <select
                  className="filter-select w-full py-1 px-1.5 bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] rounded text-[var(--nim-text)] text-xs focus:outline-none focus:border-[var(--nim-primary)]"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  {statusOptions.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </th>
              <th className="tracker-table-header filter-cell py-2 px-3 bg-[var(--nim-bg)]">
                <select
                  className="filter-select w-full py-1 px-1.5 bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] rounded text-[var(--nim-text)] text-xs focus:outline-none focus:border-[var(--nim-primary)]"
                  value={priorityFilter}
                  onChange={(e) => setPriorityFilter(e.target.value)}
                >
                  {priorityOptions.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </th>
              <th className="tracker-table-header filter-cell py-2 px-3 bg-[var(--nim-bg)]"></th>
              <th className="tracker-table-header filter-cell py-2 px-3 bg-[var(--nim-bg)]"></th>
              <th className="tracker-table-header filter-cell py-2 px-3 bg-[var(--nim-bg)]"></th>
            </tr>
          </thead>
          <tbody>
          {sortedItems.length === 0 ? (
            <tr>
              <td colSpan={7} className="tracker-table-empty-cell !p-0 !border-none">
                <div className="tracker-table-empty flex flex-col items-center justify-center py-[60px] px-5 text-[var(--nim-text-muted)] text-center gap-3">
                  <span>No tracker items found</span>
                  <p className="text-xs text-[var(--nim-text-faint)] mt-2">Create tracker items using #bug, #task, #plan, or #idea in any markdown file</p>
                </div>
              </td>
            </tr>
          ) : (
            sortedItems.map((item, index) => (
              <tr
                key={index}
                className="tracker-table-row border-b border-[var(--nim-border)] cursor-pointer transition-colors duration-100 hover:bg-[var(--nim-bg-secondary)]"
                onClick={() => handleRowClick(item)}
              >
                <td className="tracker-table-cell type p-[5px] text-[var(--nim-text)] align-middle w-[60px]">
                  <span className={`type-icon type-${item.type} inline-flex items-center justify-center w-6 h-6 rounded ${
                    item.type === 'bug' ? 'bg-[rgba(220,38,38,0.1)] text-[#dc2626]' :
                    item.type === 'task' ? 'bg-[rgba(37,99,235,0.1)] text-[#2563eb]' :
                    item.type === 'plan' ? 'bg-[rgba(124,58,237,0.1)] text-[#7c3aed]' :
                    item.type === 'idea' ? 'bg-[rgba(202,138,4,0.1)] text-[#ca8a04]' :
                    'bg-[var(--nim-bg-tertiary)]'
                  }`}>
                    <span className="material-symbols-outlined text-base">{getTypeIcon(item.type)}</span>
                  </span>
                </td>
                <td className="tracker-table-cell title p-[5px] text-[var(--nim-text)] align-middle min-w-[200px]">
                  <div className="title-info flex flex-col gap-0.5">
                    <div className="title-text font-medium text-[var(--nim-text)]">{item.title}</div>
                    {/*{item.tags && item.tags.length > 0 && (*/}
                    {/*  <div className="tags flex gap-1 flex-wrap">*/}
                    {/*    {item.tags.map((tag, i) => (*/}
                    {/*      <span key={i} className="tag py-0.5 px-1.5 bg-[var(--nim-bg-tertiary)] rounded-[3px] text-[11px] text-[var(--nim-text-muted)]">{tag}</span>*/}
                    {/*    ))}*/}
                    {/*  </div>*/}
                    {/*)}*/}
                  </div>
                </td>
                <td className="tracker-table-cell status p-[5px] text-[var(--nim-text)] align-middle w-[120px]">
                  <span
                    className="status-badge inline-block py-0.5 px-2 rounded-[10px] text-[11px] font-medium border"
                    style={{
                      backgroundColor: `${getStatusColor(item.status)}20`,
                      color: getStatusColor(item.status),
                      borderColor: getStatusColor(item.status)
                    }}
                  >
                    {item.status.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                  </span>
                </td>
                <td className="tracker-table-cell priority p-[5px] text-[var(--nim-text)] align-middle w-[100px]">
                  {item.priority && (
                    <span
                      className="priority-badge font-semibold text-xs"
                      style={{ color: getPriorityColor(item.priority) }}
                    >
                      {item.priority.charAt(0).toUpperCase() + item.priority.slice(1)}
                    </span>
                  )}
                </td>
                <td className="tracker-table-cell progress p-[5px] text-[var(--nim-text)] align-middle w-[60px] min-w-[60px]">
                  {item.progress !== undefined && item.progress !== null && (
                    <div className="progress-bar-container flex flex-col items-center gap-0.5">
                      <span className="progress-text text-[11px] font-semibold text-[var(--nim-text)]">{item.progress}%</span>
                      <div className="progress-bar-fill w-full h-1 bg-[var(--nim-bg-tertiary)] rounded-sm relative overflow-hidden" style={{ '--progress-width': `${item.progress}%` } as React.CSSProperties}>
                        <div className="absolute top-0 left-0 h-full bg-[var(--nim-primary)] rounded-sm transition-all duration-300" style={{ width: `${item.progress}%` }}></div>
                      </div>
                    </div>
                  )}
                </td>
                <td className="tracker-table-cell module p-[5px] text-[var(--nim-text)] align-middle min-w-[150px] max-w-[250px]">
                  <span className="module-text text-[var(--nim-text-muted)] text-xs font-mono whitespace-nowrap overflow-hidden text-ellipsis block">{item.module}</span>
                </td>
                <td className="tracker-table-cell updated p-[5px] text-[var(--nim-text)] align-middle w-[120px]">
                  <span className="updated-text text-[var(--nim-text-faint)] text-xs">{formatDate(item.lastIndexed)}</span>
                </td>
              </tr>
            ))
          )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
