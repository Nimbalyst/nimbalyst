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
} from '../../core/DocumentService';
import './TrackerTable.css';

export type SortColumn = 'title' | 'type' | 'status' | 'priority' | 'module' | 'lastIndexed';
export type SortDirection = 'asc' | 'desc';

interface TrackerTableProps {
  filterType?: TrackerItemType | 'all';
  sortBy?: SortColumn;
  sortDirection?: SortDirection;
  onSortChange?: (column: SortColumn, direction: SortDirection) => void;
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
    'idea': 'lightbulb'
  };
  return icons[type];
}

function formatDate(date: Date): string {
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

export function TrackerTable({
  filterType = 'all',
  sortBy = 'lastIndexed',
  sortDirection = 'desc',
  onSortChange,
}: TrackerTableProps): JSX.Element {
  const [items, setItems] = useState<TrackerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentSortBy, setCurrentSortBy] = useState<SortColumn>(sortBy);
  const [currentSortDirection, setCurrentSortDirection] = useState<SortDirection>(sortDirection);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<TrackerItemType | 'all'>(filterType);

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;

    async function loadItems() {
      try {
        const documentService = (window as any).documentService;

        if (!documentService) {
          console.log('[TrackerTable] Document service not available yet');
          setError('Document service not available');
          setLoading(false);
          return;
        }

        if (!documentService.listTrackerItems) {
          setError('Tracker items not supported');
          setLoading(false);
          return;
        }

        // Load initial items
        const trackerItems = typeFilter !== 'all' && documentService.getTrackerItemsByType
          ? await documentService.getTrackerItemsByType(typeFilter)
          : await documentService.listTrackerItems();

        setItems(trackerItems || []);
        setLoading(false);

        // Subscribe to changes
        if (documentService.watchTrackerItems) {
          unsubscribe = documentService.watchTrackerItems((change: TrackerItemChangeEvent) => {
            // Re-fetch all items on change for simplicity
            const fetchItems = typeFilter !== 'all' && documentService.getTrackerItemsByType
              ? () => documentService.getTrackerItemsByType(typeFilter)
              : () => documentService.listTrackerItems();

            fetchItems().then((updatedItems: TrackerItem[]) => {
              setItems(updatedItems);
            });
          });
        }
      } catch (err) {
        console.error('Failed to load tracker items:', err);
        setError('Failed to load tracker items');
        setLoading(false);
      }
    }

    loadItems();

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [typeFilter]);

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
      if (typeFilter !== 'all' && item.type !== typeFilter) {
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

  const sortedItems = sortItems(filteredItems, currentSortBy, currentSortDirection);

  const handleRowClick = (item: TrackerItem) => {
    // Open the document at the specific line
    const documentService = (window as any).documentService;
    if (documentService && documentService.openDocument) {
      documentService.getDocumentByPath(item.module).then((doc: any) => {
        if (doc) {
          documentService.openDocument(doc.id);
          // TODO: Scroll to line number (item.lineNumber)
        }
      });
    }
  };

  const handleColumnClick = (column: SortColumn) => {
    const newDirection = currentSortBy === column && currentSortDirection === 'desc' ? 'asc' : 'desc';
    setCurrentSortBy(column);
    setCurrentSortDirection(newDirection);

    if (onSortChange) {
      onSortChange(column, newDirection);
    }
  };

  const getSortIndicator = (column: SortColumn) => {
    if (currentSortBy !== column) {
      return <span className="sort-indicator">⇅</span>;
    }
    return currentSortDirection === 'desc'
      ? <span className="sort-indicator active">↓</span>
      : <span className="sort-indicator active">↑</span>;
  };

  if (loading) {
    return (
      <div className="tracker-table-loading">
        <div className="spinner"></div>
        <span>Loading tracker items...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="tracker-table-error">
        <span>⚠️ {error}</span>
      </div>
    );
  }

  if (sortedItems.length === 0) {
    return (
      <div className="tracker-table-empty">
        <span>No tracker items found</span>
        <p>Create tracker items using @bug, @task, @plan, or @idea in any markdown file</p>
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
  ];

  return (
    <div className="tracker-table-wrapper">
      {/* Type filter tabs */}
      <div className="tracker-type-tabs">
        {typeOptions.map(option => (
          <button
            key={option.value}
            className={`tracker-type-tab ${typeFilter === option.value ? 'active' : ''}`}
            onClick={() => setTypeFilter(option.value as TrackerItemType | 'all')}
          >
            <span className="material-symbols-outlined">{option.icon}</span>
            <span>{option.label}</span>
            {option.value === 'all' && <span className="count">{items.length}</span>}
            {option.value !== 'all' && (
              <span className="count">{items.filter(i => i.type === option.value).length}</span>
            )}
          </button>
        ))}
      </div>

      <div className="tracker-table-container">
        <table className="tracker-table">
          <thead>
            <tr>
              <th
                className="tracker-table-header type sortable"
                onClick={() => handleColumnClick('type')}
              >
                <span>TYPE</span>
                {getSortIndicator('type')}
              </th>
              <th
                className="tracker-table-header title sortable"
                onClick={() => handleColumnClick('title')}
              >
                <span>TITLE</span>
                {getSortIndicator('title')}
              </th>
              <th
                className="tracker-table-header status sortable"
                onClick={() => handleColumnClick('status')}
              >
                <span>STATUS</span>
                {getSortIndicator('status')}
              </th>
              <th
                className="tracker-table-header priority sortable"
                onClick={() => handleColumnClick('priority')}
              >
                <span>PRIORITY</span>
                {getSortIndicator('priority')}
              </th>
              <th
                className="tracker-table-header module sortable"
                onClick={() => handleColumnClick('module')}
              >
                <span>MODULE</span>
                {getSortIndicator('module')}
              </th>
              <th
                className="tracker-table-header updated sortable"
                onClick={() => handleColumnClick('lastIndexed')}
              >
                <span>UPDATED</span>
                {getSortIndicator('lastIndexed')}
              </th>
            </tr>
            <tr className="filter-row">
              <th className="tracker-table-header filter-cell"></th>
              <th className="tracker-table-header filter-cell">
                <input
                  type="text"
                  className="filter-input"
                  placeholder="Search..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </th>
              <th className="tracker-table-header filter-cell">
                <select
                  className="filter-select"
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
              <th className="tracker-table-header filter-cell">
                <select
                  className="filter-select"
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
              <th className="tracker-table-header filter-cell"></th>
              <th className="tracker-table-header filter-cell"></th>
            </tr>
          </thead>
          <tbody>
          {sortedItems.map((item, index) => (
            <tr
              key={index}
              className="tracker-table-row"
              onClick={() => handleRowClick(item)}
            >
              <td className="tracker-table-cell type">
                <span className={`type-icon type-${item.type}`}>
                  <span className="material-symbols-outlined">{getTypeIcon(item.type)}</span>
                </span>
              </td>
              <td className="tracker-table-cell title">
                <div className="title-info">
                  <div className="title-text">{item.title}</div>
                  {item.tags && item.tags.length > 0 && (
                    <div className="tags">
                      {item.tags.map((tag, i) => (
                        <span key={i} className="tag">{tag}</span>
                      ))}
                    </div>
                  )}
                </div>
              </td>
              <td className="tracker-table-cell status">
                <span
                  className="status-badge"
                  style={{
                    backgroundColor: `${getStatusColor(item.status)}20`,
                    color: getStatusColor(item.status),
                    borderColor: getStatusColor(item.status)
                  }}
                >
                  {item.status.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                </span>
              </td>
              <td className="tracker-table-cell priority">
                {item.priority && (
                  <span
                    className="priority-badge"
                    style={{ color: getPriorityColor(item.priority) }}
                  >
                    {item.priority.charAt(0).toUpperCase() + item.priority.slice(1)}
                  </span>
                )}
              </td>
              <td className="tracker-table-cell module">
                <span className="module-text">{item.module}</span>
              </td>
              <td className="tracker-table-cell updated">
                <span className="updated-text">{formatDate(item.lastIndexed)}</span>
              </td>
            </tr>
          ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
