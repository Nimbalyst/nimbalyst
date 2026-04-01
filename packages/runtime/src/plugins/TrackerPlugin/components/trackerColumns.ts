/**
 * Column registry for the tracker table.
 * Defines all available columns, their rendering behavior, and default visibility.
 * Column configs are per-type and persisted to workspace state.
 */

import type { TrackerItem, TrackerItemType, TrackerItemStatus, TrackerItemPriority } from '../../../core/DocumentService';
import { globalRegistry } from '../models';

// ============================================================================
// Types
// ============================================================================

export type ColumnRenderType = 'badge' | 'text' | 'date' | 'avatar' | 'progress' | 'tags' | 'type-icon' | 'module';

export interface TrackerColumnDef {
  /** Unique column ID (e.g. 'status', 'priority', 'owner') */
  id: string;
  /** Display label in header and settings */
  label: string;
  /** Default width in px, or 'auto' for flex */
  width: number | 'auto';
  /** Minimum width in px */
  minWidth?: number;
  /** Whether the column is sortable */
  sortable: boolean;
  /** How to render the cell value */
  render: ColumnRenderType;
  /** Whether this column is visible by default */
  defaultVisible: boolean;
  /** Sort key (if different from id) */
  sortKey?: string;
  /** Whether this is a built-in column (not removable from registry) */
  builtin: boolean;
}

/** Per-type column configuration (persisted) */
export interface TypeColumnConfig {
  /** Ordered list of visible column IDs */
  visibleColumns: string[];
  /** Custom column widths (overrides defaults) */
  columnWidths: Record<string, number>;
  /** Grouping field (null = no grouping) */
  groupBy: string | null;
}

// ============================================================================
// Built-in Column Definitions
// ============================================================================

export const BUILTIN_COLUMNS: TrackerColumnDef[] = [
  { id: 'type', label: 'Type', width: 28, sortable: true, render: 'type-icon', defaultVisible: true, builtin: true },
  { id: 'title', label: 'Title', width: 'auto', minWidth: 200, sortable: true, render: 'text', defaultVisible: true, builtin: true },
  { id: 'status', label: 'Status', width: 120, sortable: true, render: 'badge', defaultVisible: true, builtin: true },
  { id: 'priority', label: 'Priority', width: 100, sortable: true, render: 'badge', defaultVisible: true, builtin: true },
  { id: 'owner', label: 'Owner', width: 120, minWidth: 36, sortable: true, render: 'avatar', defaultVisible: true, builtin: true },
  { id: 'assignee', label: 'Assignee', width: 120, minWidth: 36, sortable: true, render: 'avatar', defaultVisible: false, builtin: true },
  { id: 'progress', label: 'Progress', width: 60, sortable: true, render: 'progress', defaultVisible: false, builtin: true },
  { id: 'labels', label: 'Labels', width: 120, sortable: false, render: 'tags', defaultVisible: false, builtin: true },
  { id: 'created', label: 'Created', width: 100, sortable: true, render: 'date', defaultVisible: false, builtin: true },
  { id: 'updated', label: 'Updated', width: 100, sortable: true, render: 'date', defaultVisible: true, sortKey: 'lastIndexed', builtin: true },
  { id: 'module', label: 'Source', width: 150, minWidth: 100, sortable: true, render: 'module', defaultVisible: false, builtin: true },
];

/** Default visible column order */
export const DEFAULT_VISIBLE_COLUMNS = ['type', 'title', 'status', 'priority', 'owner', 'updated'];

/**
 * Get the default column config for a type.
 * Uses DEFAULT_VISIBLE_COLUMNS unless the type's model defines tableView.defaultColumns.
 */
export function getDefaultColumnConfig(type: string): TypeColumnConfig {
  const model = globalRegistry.get(type);
  let visibleColumns = [...DEFAULT_VISIBLE_COLUMNS];

  // If the model defines tableView.defaultColumns, merge them in
  if (model?.tableView?.defaultColumns) {
    const builtinIds = new Set(BUILTIN_COLUMNS.map(c => c.id));
    const customCols = model.tableView.defaultColumns.filter(
      (col: string) => !builtinIds.has(col) && !visibleColumns.includes(col)
    );
    // Insert custom columns before 'updated'
    const updatedIdx = visibleColumns.indexOf('updated');
    if (updatedIdx >= 0) {
      visibleColumns.splice(updatedIdx, 0, ...customCols);
    } else {
      visibleColumns.push(...customCols);
    }
  }

  return {
    visibleColumns,
    columnWidths: {},
    groupBy: null,
  };
}

/**
 * Resolve the full list of TrackerColumnDef for a given type,
 * including custom fields from the tracker model.
 */
export function resolveColumnsForType(type: string): TrackerColumnDef[] {
  const columns = [...BUILTIN_COLUMNS];
  const model = globalRegistry.get(type);
  if (!model) return columns;

  const builtinIds = new Set(BUILTIN_COLUMNS.map(c => c.id));
  const builtinFieldNames = new Set(['title', 'status', 'priority', 'owner', 'description', 'tags', 'created', 'updated']);

  for (const field of model.fields) {
    if (builtinIds.has(field.name) || builtinFieldNames.has(field.name)) continue;

    const label = field.name.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
    const render: ColumnRenderType = field.type === 'date' || field.type === 'datetime' ? 'date'
      : field.type === 'array' ? 'tags'
      : field.type === 'user' ? 'avatar'
      : field.type === 'number' ? 'text'
      : 'text';

    columns.push({
      id: field.name,
      label,
      width: 120,
      sortable: true,
      render,
      defaultVisible: model.tableView?.defaultColumns?.includes(field.name) ?? false,
      builtin: false,
    });
  }

  return columns;
}

// ============================================================================
// Color and formatting helpers (extracted from TrackerTable.tsx)
// ============================================================================

export const BUILTIN_STATUS_COLORS: Record<string, string> = {
  'to-do': '#6b7280',
  'in-progress': '#eab308',
  'in-review': '#8b5cf6',
  'done': '#22c55e',
  'blocked': '#ef4444',
};

export function getStatusColor(status: TrackerItemStatus, trackerType?: string): string {
  if (BUILTIN_STATUS_COLORS[status]) return BUILTIN_STATUS_COLORS[status];
  if (trackerType) {
    const model = globalRegistry.get(trackerType);
    if (model) {
      const statusField = model.fields.find(f => f.name === 'status');
      if (statusField?.options) {
        const option = statusField.options.find(o => o.value === status);
        if (option?.color) return option.color;
      }
    }
  }
  return '#6b7280';
}

export function getPriorityColor(priority: TrackerItemPriority | string | undefined): string {
  if (!priority) return '#6b7280';
  const colors: Record<string, string> = { critical: '#dc2626', high: '#ef4444', medium: '#f59e0b', low: '#6b7280' };
  return colors[priority] || '#6b7280';
}

export function getTypeColor(type: TrackerItemType | string): string {
  const colors: Record<string, string> = {
    bug: '#dc2626', task: '#2563eb', plan: '#7c3aed', idea: '#ca8a04',
    decision: '#8b5cf6', automation: '#60a5fa', feature: '#10b981',
  };
  return colors[type] || '#6b7280';
}

export function getTypeIcon(type: TrackerItemType | string): string {
  const icons: Record<string, string> = {
    bug: 'bug_report', task: 'check_box', plan: 'assignment', idea: 'lightbulb',
    decision: 'gavel', automation: 'auto_mode', feature: 'rocket_launch',
  };
  return icons[type] || 'label';
}

export function formatRelativeDate(date: Date): string {
  if (!date || date.getTime() === 0 || isNaN(date.getTime())) return '';
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
 * Get the cell value for a column from a tracker item.
 */
export function getCellValue(item: TrackerItem, columnId: string): any {
  switch (columnId) {
    case 'type': return item.type;
    case 'title': return item.title;
    case 'status': return item.status;
    case 'priority': return item.priority;
    case 'owner': return item.authorIdentity || item.owner;
    case 'assignee': return item.assigneeEmail;
    case 'progress': return item.progress;
    case 'labels': return item.labels;
    case 'created': return item.created;
    case 'updated': return item.lastIndexed;
    case 'module': return item.module;
    default: return item.customFields?.[columnId];
  }
}

/**
 * Get initials from a display name (for avatar rendering).
 */
export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.substring(0, 2).toUpperCase();
}

/**
 * Generate a stable color from a string (for avatar background).
 */
export function stringToColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colors = ['#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6'];
  return colors[Math.abs(hash) % colors.length];
}
