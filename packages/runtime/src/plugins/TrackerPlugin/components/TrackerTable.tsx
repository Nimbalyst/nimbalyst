/**
 * TrackerTable - Standalone table component for displaying tracker items
 * Shows bugs, tasks, plans, and ideas across all documents in workspace
 */

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useAtomValue } from 'jotai';
import type {
  TrackerItem,
  TrackerItemType,
  TrackerItemStatus,
  TrackerItemPriority
} from '../../../core/DocumentService';
import { trackerItemsByTypeAtom, trackerDataLoadedAtom } from '../trackerDataAtoms';
import { globalRegistry, parseDate } from '../models';
import {usePostHog} from "posthog-js/react";

export type SortColumn = 'title' | 'type' | 'status' | 'priority' | 'progress' | 'module' | 'lastIndexed' | (string & {});
export type SortDirection = 'asc' | 'desc';

interface TrackerTableProps {
  filterType?: TrackerItemType | 'all';
  sortBy?: SortColumn;
  sortDirection?: SortDirection;
  onSortChange?: (column: SortColumn, direction: SortDirection) => void;
  hideTypeTabs?: boolean;
  onSwitchToFilesMode?: () => void;
  /** Callback when user wants to create a new tracker item of the current type */
  onNewItem?: (type: TrackerItemType) => void;
  /** Callback when user clicks a row to select an item (opens detail panel) */
  onItemSelect?: (itemId: string) => void;
  /** Currently selected item ID for row highlighting */
  selectedItemId?: string | null;
  /** Override items instead of reading from atoms (used for archived view) */
  overrideItems?: TrackerItem[];
}

/**
 * Get educational description for each tracker type
 */
function getTypeDescription(type: TrackerItemType): { title: string; description: string; hints: string[] } {
  const descriptions: Record<TrackerItemType, { title: string; description: string; hints: string[] }> = {
    'plan': {
      title: 'Plans',
      description: 'Plans help you organize features, projects, and initiatives with AI assistance. Use /plan in chat to create a new plan document with status tracking.',
      hints: [
        'Use /plan in agent chat to create a new plan',
        'Plans support progress tracking and status updates',
        'Click "+ New" to start planning with AI',
      ],
    },
    'bug': {
      title: 'Bugs',
      description: "Bugs track issues and defects that need fixing. They're stored as inline items in your markdown documents, making them easy to find alongside related notes.",
      hints: [
        'Type #bug in any markdown file to create a bug',
        'Use /track bug in agent chat',
        'Click "+ New" to quickly add a bug',
      ],
    },
    'task': {
      title: 'Tasks',
      description: 'Tasks track work items and todos. Add them inline to any document or use the quick-add panel.',
      hints: [
        'Type #task in any markdown file to create a task',
        'Use /track task in agent chat',
        'Click "+ New" to quickly add a task',
      ],
    },
    'idea': {
      title: 'Ideas',
      description: 'Ideas capture concepts and proposals to explore. Jot them down quickly and revisit later.',
      hints: [
        'Type #idea in any markdown file to capture an idea',
        'Use /track idea in agent chat',
        'Click "+ New" to quickly add an idea',
      ],
    },
    'decision': {
      title: 'Decisions',
      description: 'Decisions document important choices and their rationale. Great for architectural decisions that need context preserved.',
      hints: [
        'Type #decision in any markdown file',
        'Use /track decision in agent chat',
        'Click "+ New" to document a decision',
      ],
    },
  };
  return descriptions[type] || descriptions['task'];
}

/**
 * Get color for tracker type (used for icons and accents)
 */
function getTypeColor(type: TrackerItemType): string {
  const colors: Record<TrackerItemType, string> = {
    'bug': '#dc2626',
    'task': '#2563eb',
    'plan': '#7c3aed',
    'idea': '#ca8a04',
    'decision': '#8b5cf6',
  };
  return colors[type] || '#6b7280';
}

/**
 * Multi-select checkbox dropdown for filtering table columns.
 */
const MultiSelectFilter: React.FC<{
  values: string[];
  selected: Set<string>;
  onChange: (selected: Set<string>) => void;
}> = ({ values, selected, onChange }) => {
  const [open, setOpen] = useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const toggle = (val: string) => {
    const next = new Set(selected);
    if (next.has(val)) next.delete(val); else next.add(val);
    onChange(next);
  };

  const activeCount = selected.size;

  return (
    <div ref={ref} className="relative">
      <button
        className={`w-full py-1 px-1.5 bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] rounded text-xs text-left truncate focus:outline-none focus:border-[var(--nim-primary)] ${
          activeCount > 0 ? 'text-[var(--nim-primary)]' : 'text-[var(--nim-text-faint)]'
        }`}
        onClick={() => setOpen(!open)}
      >
        {activeCount > 0 ? `${activeCount} selected` : 'All'}
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-0.5 w-40 max-h-48 overflow-auto bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] rounded shadow-lg z-30">
          {activeCount > 0 && (
            <button
              className="w-full px-2 py-1 text-xs text-[var(--nim-primary)] hover:bg-[var(--nim-bg-hover)] text-left border-b border-[var(--nim-border)]"
              onClick={() => onChange(new Set())}
            >
              Clear all
            </button>
          )}
          {values.map(val => (
            <label
              key={val}
              className="flex items-center gap-1.5 px-2 py-1 text-xs text-[var(--nim-text)] cursor-pointer hover:bg-[var(--nim-bg-hover)]"
            >
              <input
                type="checkbox"
                className="w-3 h-3"
                checked={selected.has(val)}
                onChange={() => toggle(val)}
              />
              <span className="truncate">{val || '(empty)'}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
};

const BUILTIN_STATUS_COLORS: Record<string, string> = {
  'to-do': '#6b7280',
  'in-progress': '#eab308',
  'in-review': '#8b5cf6',
  'done': '#22c55e',
  'blocked': '#ef4444',
};

function getStatusColor(status: TrackerItemStatus, trackerType?: string): string {
  // Check built-in statuses first
  if (BUILTIN_STATUS_COLORS[status]) {
    return BUILTIN_STATUS_COLORS[status];
  }

  // Look up color from the tracker model's status field options
  if (trackerType) {
    const model = globalRegistry.get(trackerType);
    if (model) {
      const statusField = model.fields.find(f => f.name === 'status');
      if (statusField?.options) {
        const option = statusField.options.find(o => o.value === status);
        if (option?.color) {
          return option.color;
        }
      }
    }
  }

  return '#6b7280';
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
/**
 * Resolve the tracker frontmatter data for a given document and tracker type.
 * Returns merged data with top-level fields as canonical and embedded fields as fallback.
 * Returns null if the document doesn't match this tracker type.
 */
export function resolveTrackerFrontmatter(frontmatter: Record<string, any> | undefined, trackerType: string): Record<string, any> | null {
  if (!frontmatter) return null;

  // Check type-specific key first (e.g. 'planStatus', 'decisionStatus')
  const specificKey = `${trackerType}Status`;
  if (frontmatter[specificKey] && typeof frontmatter[specificKey] === 'object') {
    return frontmatter[specificKey] as Record<string, any>;
  }

  // Check generic trackerStatus with nested type field
  if (frontmatter.trackerStatus && typeof frontmatter.trackerStatus === 'object') {
    const trackerData = frontmatter.trackerStatus as Record<string, any>;
    if (trackerData.type === trackerType) {
      // Top-level fields are canonical, embedded fields are backward-compat fallback
      const { trackerStatus: _, ...topLevel } = frontmatter;
      return { ...trackerData, ...topLevel };
    }
  }

  return null;
}

export function convertFullDocumentToTrackerItems(metadata: any[], trackerType: TrackerItemType): TrackerItem[] {
  return metadata
    .filter(doc => {
      // Only include documents that have matching tracker frontmatter
      const hasTrackerStatus = resolveTrackerFrontmatter(doc.frontmatter, trackerType) !== null;

      // Exclude agent files
      const pathLower = doc.path.toLowerCase();
      const isAgentFile = pathLower.includes('/agents/') || pathLower.includes('\\agents\\');

      return hasTrackerStatus && !isAgentFile;
    })
    .map(doc => {
      const trackerStatus = resolveTrackerFrontmatter(doc.frontmatter, trackerType) || {};
      const frontmatter = doc.frontmatter;

      // Use raw status value from frontmatter - custom trackers define their own statuses
      const statusValue = (trackerStatus.status || frontmatter.status || 'to-do').toLowerCase() as TrackerItemStatus;

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

      // Collect custom fields from the tracker model's field definitions
      const customFields: Record<string, any> = {};
      const model = globalRegistry.get(trackerType);
      if (model) {
        const builtinFields = new Set(['title', 'status', 'priority', 'owner', 'tags', 'progress']);
        for (const field of model.fields) {
          if (builtinFields.has(field.name)) continue;
          let value = trackerStatus[field.name] ?? frontmatter[field.name];
          // For date fields, also check the common 'date' frontmatter key as fallback
          if (value === undefined && (field.type === 'date' || field.type === 'datetime')) {
            value = trackerStatus.date ?? frontmatter.date;
          }
          if (value !== undefined && value !== null) {
            // Parse dates into Date objects at the data layer
            if (field.type === 'date' || field.type === 'datetime') {
              customFields[field.name] = parseDate(value) ?? value;
            } else {
              customFields[field.name] = value;
            }
          }
        }
      }

      return {
        type: trackerType,
        title: trackerStatus.title || frontmatter.title || doc.path.split('/').pop()?.replace('.md', '') || 'Untitled',
        status: statusValue,
        priority: (trackerStatus.priority || frontmatter.priority || 'medium') as TrackerItemPriority,
        module: doc.path,
        lineNumber: 0,
        owner: trackerStatus.owner || frontmatter.owner,
        tags: trackerStatus.tags || frontmatter.tags,
        progress: trackerStatus.progress || frontmatter.progress,
        lastIndexed: actualDate || new Date(0), // Use epoch for invalid dates
        customFields: Object.keys(customFields).length > 0 ? customFields : undefined,
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
  onNewItem,
  onItemSelect,
  selectedItemId,
  overrideItems,
}: TrackerTableProps): JSX.Element {
  // Type filter: use prop filterType when hideTypeTabs is true, otherwise use internal state
  const [internalTypeFilter, setInternalTypeFilter] = useState<TrackerItemType | 'all'>('all');
  const activeTypeFilter = hideTypeTabs ? filterType : internalTypeFilter;

  // Read tracker items from cross-platform atoms (populated by host adapter)
  const atomItems = useAtomValue(trackerItemsByTypeAtom(activeTypeFilter));
  const dataLoaded = useAtomValue(trackerDataLoadedAtom);

  // Use override items if provided (e.g., for archived view), otherwise atom items
  const sourceItems = overrideItems ?? atomItems;

  // Items from source (atom or override)
  const items = useMemo(() => {
    return sourceItems.map((item: TrackerItem) => {
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
        lastIndexed: item.lastIndexed instanceof Date ? item.lastIndexed : (actualDate || new Date(0)),
      };
    });
  }, [sourceItems]);

  const loading = !dataLoaded && items.length === 0;
  const [error, setError] = useState<string | null>(null);
  const [currentSortBy, setCurrentSortBy] = useState<SortColumn>(sortBy);
  const [currentSortDirection, setCurrentSortDirection] = useState<SortDirection>(sortDirection);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [customFieldFilters, setCustomFieldFilters] = useState<Record<string, Set<string>>>({});
  const posthog = usePostHog();

  // Inline editing state
  const [editingCell, setEditingCell] = useState<{ itemId: string; field: 'status' | 'priority' | 'title' } | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Focus title input when editing starts
  useEffect(() => {
    if (editingCell?.field === 'title' && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [editingCell]);

  const handleFieldUpdate = useCallback(async (item: TrackerItem, field: string, value: string) => {
    // Only database-created items (no module) can be edited inline
    if (item.module) return;

    try {
      const electronAPI = (window as any).electronAPI;
      if (!electronAPI?.documentService?.updateTrackerItem) return;

      // Get sync mode from tracker type definition
      const tracker = globalRegistry.get(item.type);
      const syncMode = tracker?.sync?.mode || 'local';

      await electronAPI.documentService.updateTrackerItem({
        itemId: item.id,
        updates: { [field]: value },
        syncMode,
      });
    } catch (err) {
      console.error('[TrackerTable] Failed to update item:', err);
    }
    setEditingCell(null);
  }, []);

  // Reset filters when tracker type changes (different types have different fields/statuses)
  useEffect(() => {
    setStatusFilter('all');
    setCustomFieldFilters({});
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
          compareValue = a.lastIndexed.getTime() - b.lastIndexed.getTime();
          break;
        default: {
          // Sort by custom field
          const aVal = a.customFields?.[sortColumn];
          const bVal = b.customFields?.[sortColumn];
          if (aVal == null && bVal == null) { compareValue = 0; break; }
          if (aVal == null) { compareValue = 1; break; }
          if (bVal == null) { compareValue = -1; break; }
          if (aVal instanceof Date && bVal instanceof Date) { compareValue = aVal.getTime() - bVal.getTime(); break; }
          if (typeof aVal === 'number' && typeof bVal === 'number') { compareValue = aVal - bVal; break; }
          compareValue = String(aVal).localeCompare(String(bVal));
          break;
        }
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

      // Apply custom field filters
      for (const [fieldKey, selectedValues] of Object.entries(customFieldFilters)) {
        if (selectedValues.size === 0) continue;
        const value = item.customFields?.[fieldKey];
        if (Array.isArray(value)) {
          // For array fields (e.g. tags), pass if any selected value is in the array
          if (!value.some(v => selectedValues.has(String(v)))) return false;
        } else {
          const strVal = value != null ? String(value) : '';
          if (!selectedValues.has(strVal)) return false;
        }
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

    // If onItemSelect is provided (Tracker Mode), open detail panel instead
    if (onItemSelect && item.id) {
      onItemSelect(item.id);
      return;
    }

    // Database-created items (no module) - start editing title inline
    if (!item.module) {
      setEditingTitle(item.title);
      setEditingCell({ itemId: item.id, field: 'title' });
      return;
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

  // Build status options from the active tracker model's field definition
  // (must be before early returns to maintain consistent hook order)
  const statusOptions = useMemo(() => {
    const allOption = { value: 'all', label: 'All' };

    if (activeTypeFilter && activeTypeFilter !== 'all') {
      const model = globalRegistry.get(activeTypeFilter);
      if (model) {
        const statusField = model.fields.find(f => f.name === 'status');
        if (statusField?.options && statusField.options.length > 0) {
          return [
            allOption,
            ...statusField.options.map(o => ({
              value: o.value,
              label: o.label,
            })),
          ];
        }
      }
    }

    // Fallback for built-in types or 'all' view
    return [
      allOption,
      { value: 'to-do', label: 'To Do' },
      { value: 'in-progress', label: 'In Progress' },
      { value: 'in-review', label: 'In Review' },
      { value: 'done', label: 'Done' },
      { value: 'blocked', label: 'Blocked' },
    ];
  }, [activeTypeFilter]);

  // Derive extra columns from the tracker model's tableView.defaultColumns
  const extraColumns = useMemo(() => {
    const builtinColumns = new Set(['title', 'status', 'priority', 'progress']);
    if (activeTypeFilter && activeTypeFilter !== 'all') {
      const model = globalRegistry.get(activeTypeFilter);
      if (model?.tableView?.defaultColumns) {
        return model.tableView.defaultColumns
          .filter(col => !builtinColumns.has(col))
          .map(col => {
            const field = model.fields.find(f => f.name === col);
            // Convert camelCase to display label (e.g. publishDate -> Publish Date)
            const label = field?.name
              ? field.name.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())
              : col;
            return { key: col, label, type: field?.type || 'string' };
          });
      }
    }
    return [];
  }, [activeTypeFilter]);

  // Collect unique values for filterable extra columns (string, user, array types)
  const extraColumnValues = useMemo(() => {
    const filterableTypes = new Set(['string', 'user', 'select', 'array']);
    const result: Record<string, string[]> = {};
    for (const col of extraColumns) {
      if (!filterableTypes.has(col.type)) continue;
      const valSet = new Set<string>();
      for (const item of items) {
        const val = item.customFields?.[col.key];
        if (val == null) continue;
        if (Array.isArray(val)) {
          val.forEach(v => valSet.add(String(v)));
        } else {
          valSet.add(String(val));
        }
      }
      if (valSet.size > 0) {
        result[col.key] = Array.from(valSet).sort();
      }
    }
    return result;
  }, [extraColumns, items]);

  // Only show full-page loading spinner if we have no items yet
  if (loading && items.length === 0) {
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
    <div className="tracker-table-wrapper flex flex-col h-full w-full bg-[var(--nim-bg)]" data-testid="tracker-table">
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

      <div className="tracker-table-container flex-1 overflow-auto pb-1">
        <table className="tracker-table w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th
                className="tracker-table-header type sticky top-0 bg-[var(--nim-bg-secondary)] py-1 px-2 text-left text-[11px] font-semibold text-[var(--nim-text-faint)] uppercase tracking-[0.5px] border-b border-[var(--nim-border)] z-10 select-none"
              >
                <span className="header-content inline-flex items-center gap-1 whitespace-nowrap">
                  {/* Show + New button when a specific type is selected and onNewItem is provided */}
                  {onNewItem && activeTypeFilter !== 'all' ? (
                    <button
                      className="tracker-new-button inline-flex items-center gap-0.5 px-1.5 py-px rounded text-[10px] font-semibold border-none cursor-pointer transition-all duration-150 hover:opacity-90"
                      style={{
                        backgroundColor: `${getTypeColor(activeTypeFilter as TrackerItemType)}15`,
                        color: getTypeColor(activeTypeFilter as TrackerItemType),
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onNewItem(activeTypeFilter as TrackerItemType);
                      }}
                      title={`Create new ${activeTypeFilter}`}
                    >
                      <span className="material-symbols-outlined text-xs">add</span>
                      <span>New</span>
                    </button>
                  ) : (
                    <>
                      <span
                        className="cursor-pointer hover:text-[var(--nim-text)]"
                        onClick={() => handleColumnClick('type')}
                      >
                        TYPE
                      </span>
                      <span
                        className="cursor-pointer"
                        onClick={() => handleColumnClick('type')}
                      >
                        {getSortIndicator('type')}
                      </span>
                    </>
                  )}
                </span>
              </th>
              <th
                className="tracker-table-header title sortable sticky top-0 bg-[var(--nim-bg-secondary)] py-1 px-2 text-left text-[11px] font-semibold text-[var(--nim-text-faint)] uppercase tracking-[0.5px] border-b border-[var(--nim-border)] z-10 cursor-pointer select-none hover:bg-[var(--nim-bg-hover)]"
                onClick={() => handleColumnClick('title')}
              >
                <span className="header-content inline-flex items-center gap-1 whitespace-nowrap">
                  <span>TITLE</span>
                  {getSortIndicator('title')}
                </span>
              </th>
              <th
                className="tracker-table-header status sortable sticky top-0 bg-[var(--nim-bg-secondary)] py-1 px-2 text-left text-[11px] font-semibold text-[var(--nim-text-faint)] uppercase tracking-[0.5px] border-b border-[var(--nim-border)] z-10 cursor-pointer select-none hover:bg-[var(--nim-bg-hover)]"
                onClick={() => handleColumnClick('status')}
              >
                <span className="header-content inline-flex items-center gap-1 whitespace-nowrap">
                  <span>STATUS</span>
                  {getSortIndicator('status')}
                </span>
              </th>
              <th
                className="tracker-table-header priority sortable sticky top-0 bg-[var(--nim-bg-secondary)] py-1 px-2 text-left text-[11px] font-semibold text-[var(--nim-text-faint)] uppercase tracking-[0.5px] border-b border-[var(--nim-border)] z-10 cursor-pointer select-none hover:bg-[var(--nim-bg-hover)]"
                onClick={() => handleColumnClick('priority')}
              >
                <span className="header-content inline-flex items-center gap-1 whitespace-nowrap">
                  <span>PRIORITY</span>
                  {getSortIndicator('priority')}
                </span>
              </th>
              <th
                className="tracker-table-header progress sortable sticky top-0 bg-[var(--nim-bg-secondary)] py-1 px-2 text-left text-[11px] font-semibold text-[var(--nim-text-faint)] uppercase tracking-[0.5px] border-b border-[var(--nim-border)] z-10 cursor-pointer select-none hover:bg-[var(--nim-bg-hover)]"
                onClick={() => handleColumnClick('progress')}
              >
                <span className="header-content inline-flex items-center gap-1 whitespace-nowrap">
                  <span>PROGRESS</span>
                  {getSortIndicator('progress')}
                </span>
              </th>
              {extraColumns.map(col => (
                <th
                  key={col.key}
                  className="tracker-table-header sortable sticky top-0 bg-[var(--nim-bg-secondary)] py-1 px-2 text-left text-[11px] font-semibold text-[var(--nim-text-faint)] uppercase tracking-[0.5px] border-b border-[var(--nim-border)] z-10 cursor-pointer select-none hover:bg-[var(--nim-bg-hover)]"
                  onClick={() => handleColumnClick(col.key as SortColumn)}
                >
                  <span className="header-content inline-flex items-center gap-1 whitespace-nowrap">
                    <span>{col.label.toUpperCase()}</span>
                    {getSortIndicator(col.key as SortColumn)}
                  </span>
                </th>
              ))}
              <th
                className="tracker-table-header module sortable sticky top-0 bg-[var(--nim-bg-secondary)] py-1 px-2 text-left text-[11px] font-semibold text-[var(--nim-text-faint)] uppercase tracking-[0.5px] border-b border-[var(--nim-border)] z-10 cursor-pointer select-none hover:bg-[var(--nim-bg-hover)]"
                onClick={() => handleColumnClick('module')}
              >
                <span className="header-content inline-flex items-center gap-1 whitespace-nowrap">
                  <span>MODULE</span>
                  {getSortIndicator('module')}
                </span>
              </th>
              <th
                className="tracker-table-header updated sortable sticky top-0 bg-[var(--nim-bg-secondary)] py-1 px-2 text-left text-[11px] font-semibold text-[var(--nim-text-faint)] uppercase tracking-[0.5px] border-b border-[var(--nim-border)] z-10 cursor-pointer select-none hover:bg-[var(--nim-bg-hover)]"
                onClick={() => handleColumnClick('lastIndexed')}
              >
                <span className="header-content inline-flex items-center gap-1 whitespace-nowrap">
                  <span>UPDATED</span>
                  {getSortIndicator('lastIndexed')}
                </span>
              </th>
            </tr>
            {/* Only show filter row when there are items to filter */}
            {items.length > 0 && (
              <tr className="filter-row">
                <th className="tracker-table-header filter-cell py-1 px-2 bg-[var(--nim-bg)]"></th>
                <th className="tracker-table-header filter-cell py-1 px-2 bg-[var(--nim-bg)]">
                  <input
                    type="text"
                    className="filter-input w-full py-1 px-1.5 bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] rounded text-[var(--nim-text)] text-xs focus:outline-none focus:border-[var(--nim-primary)]"
                    placeholder="Search..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </th>
                <th className="tracker-table-header filter-cell py-1 px-2 bg-[var(--nim-bg)]">
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
                <th className="tracker-table-header filter-cell py-1 px-2 bg-[var(--nim-bg)]">
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
                <th className="tracker-table-header filter-cell py-1 px-2 bg-[var(--nim-bg)]"></th>
                {extraColumns.map(col => (
                  <th key={col.key} className="tracker-table-header filter-cell py-1 px-2 bg-[var(--nim-bg)]">
                    {extraColumnValues[col.key] && (
                      <MultiSelectFilter
                        values={extraColumnValues[col.key]}
                        selected={customFieldFilters[col.key] || new Set()}
                        onChange={(selected) => setCustomFieldFilters(prev => ({
                          ...prev,
                          [col.key]: selected,
                        }))}
                      />
                    )}
                  </th>
                ))}
                <th className="tracker-table-header filter-cell py-1 px-2 bg-[var(--nim-bg)]"></th>
                <th className="tracker-table-header filter-cell py-1 px-2 bg-[var(--nim-bg)]"></th>
              </tr>
            )}
          </thead>
          <tbody>
          {sortedItems.length === 0 ? (
            <tr>
              <td colSpan={7 + extraColumns.length} className="tracker-table-empty-cell !p-0 !border-none">
                {loading ? (
                  // Still loading - show loading indicator instead of empty state
                  <div className="tracker-table-loading flex items-center justify-center gap-3 py-6 px-6 text-[var(--nim-text-muted)]">
                    <div className="w-5 h-5 border-2 border-[var(--nim-border)] border-t-[var(--nim-primary)] rounded-full animate-spin"></div>
                    <span className="text-sm">Loading...</span>
                  </div>
                ) : activeTypeFilter !== 'all' ? (
                  // Type-specific educational empty state - horizontal layout
                  (() => {
                    const typeInfo = getTypeDescription(activeTypeFilter as TrackerItemType);
                    const typeColor = getTypeColor(activeTypeFilter as TrackerItemType);
                    const typeIcon = getTypeIcon(activeTypeFilter as TrackerItemType);
                    return (
                      <div className="tracker-table-empty flex items-center gap-4 py-4 px-6">
                        {/* Icon */}
                        <div
                          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                          style={{ backgroundColor: `${typeColor}12` }}
                        >
                          <span
                            className="material-symbols-outlined text-lg"
                            style={{ color: typeColor }}
                          >
                            {typeIcon}
                          </span>
                        </div>

                        {/* Description and hints */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-[var(--nim-text-muted)] m-0">
                            {typeInfo.description}
                          </p>
                          <p className="text-xs text-[var(--nim-text-faint)] m-0 mt-1">
                            {activeTypeFilter === 'plan' ? (
                              <>Use <code className="px-1 py-0.5 bg-[var(--nim-bg-secondary)] rounded text-[10px]">/plan</code> in chat to create a new plan</>
                            ) : (
                              <>Type <code className="px-1 py-0.5 bg-[var(--nim-bg-secondary)] rounded text-[10px]">#{activeTypeFilter}</code> in markdown or use <code className="px-1 py-0.5 bg-[var(--nim-bg-secondary)] rounded text-[10px]">/track {activeTypeFilter}</code> in chat</>
                            )}
                          </p>
                        </div>

                        {/* New button */}
                        {onNewItem && (
                          <button
                            className="shrink-0 px-3 py-1.5 rounded-md text-xs font-medium text-white border-none cursor-pointer transition-all duration-150 hover:opacity-90"
                            style={{ backgroundColor: typeColor }}
                            onClick={() => onNewItem(activeTypeFilter as TrackerItemType)}
                          >
                            <span className="flex items-center gap-1">
                              <span className="material-symbols-outlined text-sm">add</span>
                              New {activeTypeFilter.charAt(0).toUpperCase() + activeTypeFilter.slice(1)}
                            </span>
                          </button>
                        )}
                      </div>
                    );
                  })()
                ) : (
                  // Generic empty state for "all" filter
                  <div className="tracker-table-empty flex items-center justify-center gap-2 py-4 px-6">
                    <p className="text-sm text-[var(--nim-text-muted)] m-0">No tracker items found</p>
                    <p className="text-xs text-[var(--nim-text-faint)] m-0">Create items using #bug, #task, #plan, or #idea in any markdown file</p>
                  </div>
                )}
              </td>
            </tr>
          ) : (
            sortedItems.map((item, index) => (
              <tr
                key={index}
                className={`tracker-table-row border-b border-[var(--nim-border)] cursor-pointer transition-colors duration-100 hover:bg-[var(--nim-bg-secondary)] ${
                  selectedItemId && item.id === selectedItemId ? 'bg-[var(--nim-bg-secondary)]' : ''
                }`}
                data-testid="tracker-table-row"
                data-item-id={item.id}
                data-item-title={item.title}
                onClick={() => handleRowClick(item)}
              >
                <td className="tracker-table-cell type pl-2 pr-1 py-1 text-[var(--nim-text)] align-middle w-[28px]">
                  <span className={`type-icon type-${item.type} flex items-center justify-center w-5 h-5 rounded ${
                    item.type === 'bug' ? 'text-[#dc2626]' :
                    item.type === 'task' ? 'text-[#2563eb]' :
                    item.type === 'plan' ? 'text-[#7c3aed]' :
                    item.type === 'idea' ? 'text-[#ca8a04]' :
                    'bg-[var(--nim-bg-tertiary)]'
                  }`}>
                    <span className="material-symbols-outlined text-sm">{getTypeIcon(item.type)}</span>
                  </span>
                </td>
                <td className="tracker-table-cell title pl-1 pr-2 py-1 text-[var(--nim-text)] align-middle min-w-[200px]">
                  <div className="title-info flex flex-col gap-0.5">
                    {editingCell !== null && editingCell.itemId === item.id && editingCell.field === 'title' ? (
                      <input
                        ref={titleInputRef}
                        type="text"
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onBlur={() => {
                          if (editingTitle.trim() && editingTitle !== item.title) {
                            handleFieldUpdate(item, 'title', editingTitle.trim());
                          } else {
                            setEditingCell(null);
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            if (editingTitle.trim() && editingTitle !== item.title) {
                              handleFieldUpdate(item, 'title', editingTitle.trim());
                            } else {
                              setEditingCell(null);
                            }
                          } else if (e.key === 'Escape') {
                            setEditingCell(null);
                          }
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="w-full bg-[var(--nim-bg-secondary)] border border-[var(--nim-primary)] rounded px-1 py-0.5 text-[var(--nim-text)] font-medium outline-none"
                      />
                    ) : (
                      <div className="title-text font-medium text-[var(--nim-text)]">{item.title}</div>
                    )}
                  </div>
                </td>
                <td className="tracker-table-cell status p-[5px] text-[var(--nim-text)] align-middle w-[120px]">
                  {!item.module && editingCell !== null && editingCell.itemId === item.id && editingCell.field === 'status' ? (
                    <select
                      autoFocus
                      value={item.status}
                      onChange={(e) => {
                        handleFieldUpdate(item, 'status', e.target.value);
                      }}
                      onBlur={() => setEditingCell(null)}
                      onClick={(e) => e.stopPropagation()}
                      className="bg-[var(--nim-bg-secondary)] border border-[var(--nim-primary)] rounded text-[11px] text-[var(--nim-text)] px-1 py-0.5 outline-none"
                    >
                      {(() => {
                        const tracker = globalRegistry.get(item.type);
                        const statusField = tracker?.fields.find(f => f.name === 'status');
                        const rawOptions = statusField?.options || ['to-do', 'in-progress', 'done', 'blocked'];
                        return rawOptions.map(opt => {
                          const val = typeof opt === 'string' ? opt : opt.value;
                          const label = typeof opt === 'string' ? opt.split('-').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : opt.label;
                          return <option key={val} value={val}>{label}</option>;
                        });
                      })()}
                    </select>
                  ) : (
                    <span
                      className={`status-badge inline-block py-0.5 px-2 rounded-[10px] text-[11px] font-medium border ${!item.module ? 'cursor-pointer hover:opacity-80' : ''}`}
                      style={{
                        backgroundColor: `${getStatusColor(item.status, item.type)}20`,
                        color: getStatusColor(item.status, item.type),
                        borderColor: getStatusColor(item.status, item.type)
                      }}
                      onClick={(e) => {
                        if (!item.module) {
                          e.stopPropagation();
                          setEditingCell({ itemId: item.id, field: 'status' });
                        }
                      }}
                    >
                      {item.status.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                    </span>
                  )}
                </td>
                <td className="tracker-table-cell priority p-[5px] text-[var(--nim-text)] align-middle w-[100px]">
                  {!item.module && editingCell !== null && editingCell.itemId === item.id && editingCell.field === 'priority' ? (
                    <select
                      autoFocus
                      value={item.priority || 'medium'}
                      onChange={(e) => {
                        handleFieldUpdate(item, 'priority', e.target.value);
                      }}
                      onBlur={() => setEditingCell(null)}
                      onClick={(e) => e.stopPropagation()}
                      className="bg-[var(--nim-bg-secondary)] border border-[var(--nim-primary)] rounded text-xs text-[var(--nim-text)] px-1 py-0.5 outline-none"
                    >
                      {['low', 'medium', 'high', 'critical'].map(p => (
                        <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                      ))}
                    </select>
                  ) : (
                    <span
                      className={`priority-badge font-semibold text-xs ${!item.module ? 'cursor-pointer hover:opacity-80' : ''}`}
                      style={{ color: getPriorityColor(item.priority || 'medium') }}
                      onClick={(e) => {
                        if (!item.module) {
                          e.stopPropagation();
                          setEditingCell({ itemId: item.id, field: 'priority' });
                        }
                      }}
                    >
                      {(item.priority || 'medium').charAt(0).toUpperCase() + (item.priority || 'medium').slice(1)}
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
                {extraColumns.map(col => {
                  const value = item.customFields?.[col.key];
                  let display = '';
                  if (value == null) {
                    // leave empty
                  } else if (value instanceof Date) {
                    display = value.toLocaleDateString();
                  } else if (Array.isArray(value)) {
                    display = value.join(', ');
                  } else {
                    display = String(value);
                  }
                  return (
                    <td key={col.key} className="tracker-table-cell p-[5px] text-[var(--nim-text)] align-middle">
                      <span className="text-[var(--nim-text-muted)] text-xs">{display}</span>
                    </td>
                  );
                })}
                <td className="tracker-table-cell module p-[5px] text-[var(--nim-text)] align-middle min-w-[150px] max-w-[250px]">
                  <span className="module-text text-[var(--nim-text-muted)] text-xs font-mono whitespace-nowrap overflow-hidden text-ellipsis block">{item.module || '\u2014'}</span>
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
