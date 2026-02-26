import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';
import type { TrackerItem, TrackerItemStatus } from '@nimbalyst/runtime';
import type { TrackerItemType } from '@nimbalyst/runtime/plugins/TrackerPlugin';
import { globalRegistry } from '@nimbalyst/runtime/plugins/TrackerPlugin/models';
import { editorRegistry } from '@nimbalyst/runtime/ai/EditorRegistry';

interface KanbanBoardProps {
  filterType: TrackerItemType | 'all';
  searchQuery?: string;
  onSwitchToFilesMode?: () => void;
  /** Callback when user clicks a card to select an item (opens detail panel) */
  onItemSelect?: (itemId: string) => void;
  /** Currently selected item ID for card highlighting */
  selectedItemId?: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  'to-do': '#6b7280',
  'in-progress': '#eab308',
  'in-review': '#8b5cf6',
  'done': '#22c55e',
  'blocked': '#ef4444',
  "won't-fix": '#6b7280',
  'wont-fix': '#6b7280',
};

const PRIORITY_COLORS: Record<string, string> = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#eab308',
  low: '#6b7280',
};

const TYPE_COLORS: Record<string, string> = {
  bug: '#dc2626',
  task: '#2563eb',
  plan: '#7c3aed',
  idea: '#ca8a04',
  decision: '#8b5cf6',
};

function getStatusColumns(filterType: TrackerItemType | 'all'): { value: string; label: string }[] {
  if (filterType !== 'all') {
    const model = globalRegistry.get(filterType);
    if (model) {
      const statusField = model.fields.find(f => f.name === 'status');
      if (statusField?.options) {
        return statusField.options.map(o => ({ value: o.value, label: o.label }));
      }
    }
  }
  // Default columns
  return [
    { value: 'to-do', label: 'To Do' },
    { value: 'in-progress', label: 'In Progress' },
    { value: 'in-review', label: 'In Review' },
    { value: 'done', label: 'Done' },
  ];
}

export const KanbanBoard: React.FC<KanbanBoardProps> = ({
  filterType,
  searchQuery,
  onSwitchToFilesMode,
  onItemSelect,
  selectedItemId,
}) => {
  const [items, setItems] = useState<TrackerItem[]>([]);
  const [fullDocItems, setFullDocItems] = useState<TrackerItem[]>([]);

  // Load items
  useEffect(() => {
    let mounted = true;

    async function loadItems() {
      const documentService = (window as any).documentService;
      if (!documentService) return;

      try {
        // Inline items
        const inlineItems = await documentService.listTrackerItems();
        if (!mounted) return;

        const filtered = filterType === 'all'
          ? inlineItems
          : inlineItems.filter((i: TrackerItem) => i.type === filterType);
        setItems(filtered);

        // Full document items from metadata
        if (documentService.listDocumentMetadata) {
          const metadata = await documentService.listDocumentMetadata();
          const docItems: TrackerItem[] = [];

          for (const doc of metadata) {
            if (!doc.frontmatter) continue;

            // Check for tracker frontmatter
            const trackerTypes = globalRegistry.getAll();
            for (const tracker of trackerTypes) {
              if (!tracker.modes?.fullDocument) continue;
              const specificKey = `${tracker.type}Status`;
              const block = doc.frontmatter[specificKey] || doc.frontmatter.trackerStatus;
              if (!block || typeof block !== 'object') continue;
              if (doc.frontmatter.trackerStatus && block.type !== tracker.type && !doc.frontmatter[specificKey]) continue;

              if (filterType !== 'all' && tracker.type !== filterType) continue;

              docItems.push({
                id: block.planId || block.id || doc.id,
                type: tracker.type as TrackerItemType,
                title: block.title || doc.path.split('/').pop()?.replace(/\.\w+$/, '') || 'Untitled',
                status: (doc.frontmatter.status || block.status || 'to-do') as TrackerItemStatus,
                priority: block.priority || 'medium',
                module: doc.path,
                workspace: doc.workspace || '',
                tags: block.tags || [],
                lastIndexed: doc.lastIndexed || new Date(),
              });
            }
          }

          if (mounted) setFullDocItems(docItems);
        }
      } catch (error) {
        console.error('[KanbanBoard] Failed to load items:', error);
      }
    }

    loadItems();

    // Watch for changes
    const documentService = (window as any).documentService;
    const unsubs: (() => void)[] = [];
    if (documentService?.watchTrackerItems) {
      unsubs.push(documentService.watchTrackerItems(() => mounted && loadItems()));
    }
    if (documentService?.watchDocumentMetadata) {
      unsubs.push(documentService.watchDocumentMetadata(() => mounted && loadItems()));
    }

    return () => {
      mounted = false;
      unsubs.forEach(fn => fn());
    };
  }, [filterType]);

  const allItems = useMemo(() => {
    const combined = [...items, ...fullDocItems];
    if (!searchQuery) return combined;
    const q = searchQuery.toLowerCase();
    return combined.filter(
      item =>
        item.title.toLowerCase().includes(q) ||
        item.module?.toLowerCase().includes(q)
    );
  }, [items, fullDocItems, searchQuery]);

  const columns = useMemo(() => getStatusColumns(filterType), [filterType]);

  const itemsByStatus = useMemo(() => {
    const grouped: Record<string, TrackerItem[]> = {};
    for (const col of columns) {
      grouped[col.value] = [];
    }
    // Catch-all for items with statuses not in the column list
    grouped['__other__'] = [];

    for (const item of allItems) {
      const status = (item.status || 'to-do').toLowerCase();
      if (grouped[status]) {
        grouped[status].push(item);
      } else {
        grouped['__other__'].push(item);
      }
    }
    return grouped;
  }, [allItems, columns]);

  const handleCardClick = useCallback((item: TrackerItem) => {
    // If onItemSelect is provided (Tracker Mode), open detail panel
    if (onItemSelect && item.id) {
      onItemSelect(item.id);
      return;
    }
    // Fallback: open source document
    if (item.module) {
      editorRegistry.scrollToTrackerItem?.(item.id, item.module);
      onSwitchToFilesMode?.();
    }
  }, [onSwitchToFilesMode, onItemSelect]);

  if (allItems.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-nim-muted">
        <div className="text-center">
          <MaterialSymbol icon="view_kanban" size={48} className="opacity-30" />
          <p className="mt-2 text-sm">No items to display</p>
        </div>
      </div>
    );
  }

  return (
    <div className="tracker-kanban-board flex-1 flex gap-3 p-3 overflow-x-auto overflow-y-hidden">
      {columns.map((col) => {
        const colItems = itemsByStatus[col.value] || [];
        const color = STATUS_COLORS[col.value] || '#6b7280';

        return (
          <div
            key={col.value}
            className="tracker-kanban-column flex flex-col min-w-[260px] max-w-[320px] flex-1 rounded-lg bg-nim-secondary"
          >
            {/* Column header */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-nim">
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: color }}
              />
              <span className="text-xs font-semibold text-nim truncate">
                {col.label}
              </span>
              <span className="text-[10px] font-semibold text-nim-faint ml-auto">
                {colItems.length}
              </span>
            </div>

            {/* Column cards */}
            <div className="flex-1 overflow-y-auto p-1.5 space-y-1.5">
              {colItems.map((item) => (
                <button
                  key={item.id}
                  className={`tracker-kanban-card w-full text-left p-2.5 rounded-md bg-nim hover:bg-nim-tertiary border transition-colors cursor-pointer ${
                    selectedItemId && item.id === selectedItemId
                      ? 'border-[var(--nim-primary)]'
                      : 'border-nim'
                  }`}
                  onClick={() => handleCardClick(item)}
                >
                  <div className="flex items-start gap-2">
                    {/* Priority dot */}
                    <span
                      className="w-2 h-2 rounded-full mt-1.5 shrink-0"
                      style={{ backgroundColor: PRIORITY_COLORS[item.priority || 'medium'] || '#6b7280' }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-nim leading-snug line-clamp-2">
                        {item.title}
                      </div>
                      <div className="flex items-center gap-1.5 mt-1.5">
                        {/* Type badge */}
                        <span
                          className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                          style={{
                            color: TYPE_COLORS[item.type] || '#6b7280',
                            backgroundColor: `${TYPE_COLORS[item.type] || '#6b7280'}20`,
                          }}
                        >
                          {item.type}
                        </span>
                        {/* Priority label */}
                        {item.priority && item.priority !== 'medium' && (
                          <span
                            className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                            style={{
                              color: PRIORITY_COLORS[item.priority] || '#6b7280',
                              backgroundColor: `${PRIORITY_COLORS[item.priority] || '#6b7280'}20`,
                            }}
                          >
                            {item.priority}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};
