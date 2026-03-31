import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useFloating, offset, flip, shift, FloatingPortal } from '@floating-ui/react';
import { MaterialSymbol } from '@nimbalyst/runtime';
import type { TrackerItem, TrackerItemStatus } from '@nimbalyst/runtime';
import type { TrackerItemType } from '@nimbalyst/runtime/plugins/TrackerPlugin';
import { globalRegistry } from '@nimbalyst/runtime/plugins/TrackerPlugin/models';

interface KanbanBoardProps {
  filterType: TrackerItemType | 'all';
  searchQuery?: string;
  onSwitchToFilesMode?: () => void;
  /** Callback when user clicks a card to select an item (opens detail panel) */
  onItemSelect?: (itemId: string) => void;
  /** Currently selected item ID for card highlighting */
  selectedItemId?: string | null;
  /** Override items instead of loading from documentService (used for filtered views) */
  overrideItems?: TrackerItem[];
  /** Callback for bulk/single archive action */
  onArchiveItems?: (itemIds: string[], archive: boolean) => void;
  /** Callback for bulk/single delete action */
  onDeleteItems?: (itemIds: string[]) => void;
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
  feature: '#10b981',
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
  overrideItems,
  onArchiveItems,
  onDeleteItems,
}) => {
  const [items, setItems] = useState<TrackerItem[]>([]);
  const [fullDocItems, setFullDocItems] = useState<TrackerItem[]>([]);

  // Load items from documentService (skipped when overrideItems is provided)
  useEffect(() => {
    if (overrideItems) return;

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
  }, [filterType, overrideItems]);

  const allItems = useMemo(() => {
    // Use overrideItems when provided (filtered views from sidebar chips)
    const source = overrideItems ?? [...items, ...fullDocItems];
    if (!searchQuery) return source;
    const q = searchQuery.toLowerCase();
    return source.filter(
      item =>
        item.title.toLowerCase().includes(q) ||
        item.module?.toLowerCase().includes(q)
    );
  }, [items, fullDocItems, searchQuery, overrideItems]);

  // Drag-and-drop state
  const [dragItemId, setDragItemId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const dragItemRef = useRef<TrackerItem | null>(null);

  /** Update an item's status via the appropriate API based on its source */
  const updateItemStatus = useCallback(async (item: TrackerItem, newStatus: string) => {
    try {
      if (item.source === 'frontmatter' || item.source === 'import' || item.source === 'inline') {
        // File-backed items: update in source file
        await window.electronAPI.documentService.updateTrackerItemInFile({
          itemId: item.id,
          updates: { status: newStatus },
        });
      } else if (!item.module || item.source === 'native') {
        const tracker = globalRegistry.get(item.type);
        const syncMode = tracker?.sync?.mode || 'local';
        await window.electronAPI.documentService.updateTrackerItem({
          itemId: item.id,
          updates: { status: newStatus },
          syncMode,
        });
      }
    } catch (err) {
      console.error('[KanbanBoard] Failed to update item status:', err);
    }
  }, []);

  const handleDragStart = useCallback((e: React.DragEvent, item: TrackerItem) => {
    setDragItemId(item.id);
    dragItemRef.current = item;
    e.dataTransfer.effectAllowed = 'move';
    // Set minimal drag data
    e.dataTransfer.setData('text/plain', item.id);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, columnValue: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverColumn(columnValue);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear if leaving the column entirely (not entering a child)
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverColumn(null);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetStatus: string) => {
    e.preventDefault();
    setDragOverColumn(null);
    setDragItemId(null);

    const item = dragItemRef.current;
    dragItemRef.current = null;
    if (!item) return;

    // No-op if dropped on the same column
    const currentStatus = (item.status || 'to-do').toLowerCase();
    if (currentStatus === targetStatus) return;

    updateItemStatus(item, targetStatus);
  }, [updateItemStatus]);

  const handleDragEnd = useCallback(() => {
    setDragItemId(null);
    setDragOverColumn(null);
    dragItemRef.current = null;
  }, []);

  // Multi-select state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [contextAnchor, setContextAnchor] = useState<DOMRect | null>(null);
  const allItemsRef = useRef<TrackerItem[]>([]);

  // Floating context menu
  const { refs: contextRefs, floatingStyles: contextFloatingStyles } = useFloating({
    placement: 'right-start',
    middleware: [offset(2), flip({ padding: 8 }), shift({ padding: 8 })],
  });
  useEffect(() => {
    if (contextAnchor) {
      contextRefs.setReference({ getBoundingClientRect: () => contextAnchor });
    }
  }, [contextAnchor, contextRefs]);

  // Keep ref in sync
  useEffect(() => { allItemsRef.current = allItems; }, [allItems]);

  const handleCardSelect = useCallback((e: React.MouseEvent, item: TrackerItem) => {
    e.stopPropagation();
    if (e.metaKey || e.ctrlKey) {
      // Toggle individual
      setSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(item.id)) next.delete(item.id);
        else next.add(item.id);
        return next;
      });
    } else {
      // Replace selection and open detail
      setSelectedIds(new Set([item.id]));
      if (onItemSelect && item.id) {
        onItemSelect(item.id);
      }
    }
  }, [onItemSelect]);

  const handleCardContextMenu = useCallback((e: React.MouseEvent, item: TrackerItem) => {
    e.preventDefault();
    e.stopPropagation();
    // If right-clicking an unselected item, select just that item
    if (!selectedIds.has(item.id)) {
      setSelectedIds(new Set([item.id]));
    }
    setContextAnchor(DOMRect.fromRect({ x: e.clientX, y: e.clientY, width: 0, height: 0 }));
  }, [selectedIds]);

  const closeContextMenu = useCallback(() => setContextAnchor(null), []);

  // Close context menu on outside click
  useEffect(() => {
    if (!contextAnchor) return;
    const handler = () => setContextAnchor(null);
    document.addEventListener('click', handler);
    document.addEventListener('contextmenu', handler);
    return () => {
      document.removeEventListener('click', handler);
      document.removeEventListener('contextmenu', handler);
    };
  }, [contextAnchor]);

  // Clear selection on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedIds(new Set());
        closeContextMenu();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [closeContextMenu]);

  /** Bulk status change from context menu */
  const handleBulkStatusUpdate = useCallback(async (newStatus: string) => {
    closeContextMenu();
    const items = allItemsRef.current.filter(i => selectedIds.has(i.id));
    for (const item of items) {
      await updateItemStatus(item, newStatus);
    }
  }, [selectedIds, closeContextMenu, updateItemStatus]);

  /** Bulk priority change from context menu */
  const handleBulkPriorityUpdate = useCallback(async (newPriority: string) => {
    closeContextMenu();
    const items = allItemsRef.current.filter(i => selectedIds.has(i.id));
    for (const item of items) {
      try {
        if (item.source === 'frontmatter' || item.source === 'import' || item.source === 'inline') {
          await window.electronAPI.documentService.updateTrackerItemInFile({
            itemId: item.id,
            updates: { priority: newPriority },
          });
        } else if (!item.module || item.source === 'native') {
          const tracker = globalRegistry.get(item.type);
          const syncMode = tracker?.sync?.mode || 'local';
          await window.electronAPI.documentService.updateTrackerItem({
            itemId: item.id,
            updates: { priority: newPriority },
            syncMode,
          });
        }
      } catch (err) {
        console.error('[KanbanBoard] Failed to update priority:', err);
      }
    }
  }, [selectedIds, closeContextMenu]);

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
    <div className="tracker-kanban-board h-full flex flex-col overflow-hidden relative">
    <div className="flex-1 flex gap-3 p-3 overflow-x-auto overflow-y-hidden min-h-0">
      {columns.map((col) => {
        const colItems = itemsByStatus[col.value] || [];
        const color = STATUS_COLORS[col.value] || '#6b7280';

        return (
          <div
            key={col.value}
            className={`tracker-kanban-column flex flex-col min-w-[260px] max-w-[320px] flex-1 min-h-0 rounded-lg transition-colors bg-nim-secondary ${
              dragOverColumn === col.value ? 'ring-1 ring-[var(--nim-primary)]' : ''
            }`}
            onDragOver={(e) => handleDragOver(e, col.value)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, col.value)}
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
                  draggable
                  onDragStart={(e) => handleDragStart(e, item)}
                  onDragEnd={handleDragEnd}
                  className={`tracker-kanban-card w-full text-left p-2.5 rounded-md bg-nim hover:bg-nim-tertiary border transition-colors cursor-grab active:cursor-grabbing ${
                    dragItemId === item.id ? 'opacity-40' : ''
                  } ${
                    selectedIds.has(item.id) || (selectedItemId && item.id === selectedItemId)
                      ? 'border-[var(--nim-primary)]'
                      : 'border-nim'
                  }`}
                  onClick={(e) => handleCardSelect(e, item)}
                  onContextMenu={(e) => handleCardContextMenu(e, item)}
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
                        {/* Secondary type tags */}
                        {(item.typeTags ?? [])
                          .filter(tag => tag !== item.type)
                          .map(tag => (
                            <span
                              key={tag}
                              className="text-[9px] font-medium px-1 py-0.5 rounded"
                              style={{
                                color: TYPE_COLORS[tag] || '#6b7280',
                                backgroundColor: `${TYPE_COLORS[tag] || '#6b7280'}12`,
                                border: `1px solid ${TYPE_COLORS[tag] || '#6b7280'}30`,
                              }}
                            >
                              {tag}
                            </span>
                          ))}
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
      {/* Context menu */}
      {contextAnchor && selectedIds.size > 0 && (
        <FloatingPortal>
        <div
          ref={contextRefs.setFloating}
          className="z-50 min-w-[180px] bg-nim-secondary border border-nim rounded-md shadow-lg py-1 text-[13px]"
          style={contextFloatingStyles}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-1 text-[11px] text-nim-faint font-medium">
            {selectedIds.size} item{selectedIds.size > 1 ? 's' : ''} selected
          </div>
          <div className="border-b border-nim my-1" />

          {/* Set Status */}
          <KanbanContextSubmenu label="Set Status" icon="swap_horiz">
            {columns.map(col => (
              <button
                key={col.value}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-nim hover:bg-nim-tertiary cursor-pointer"
                onClick={() => handleBulkStatusUpdate(col.value)}
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: STATUS_COLORS[col.value] || '#6b7280' }}
                />
                {col.label}
              </button>
            ))}
          </KanbanContextSubmenu>

          {/* Set Priority */}
          <KanbanContextSubmenu label="Set Priority" icon="flag">
            {(['critical', 'high', 'medium', 'low'] as const).map(p => (
              <button
                key={p}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-nim hover:bg-nim-tertiary cursor-pointer"
                onClick={() => handleBulkPriorityUpdate(p)}
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: PRIORITY_COLORS[p] || '#6b7280' }}
                />
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
          </KanbanContextSubmenu>

          <div className="border-b border-nim my-1" />

          {onArchiveItems && (
            <button
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-nim hover:bg-nim-tertiary cursor-pointer"
              onClick={() => {
                closeContextMenu();
                onArchiveItems(Array.from(selectedIds), true);
                setSelectedIds(new Set());
              }}
            >
              <MaterialSymbol icon="archive" size={16} />
              Archive
            </button>
          )}

          {onDeleteItems && (
            <button
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[#ef4444] hover:bg-nim-tertiary cursor-pointer"
              onClick={() => {
                closeContextMenu();
                const ids = Array.from(selectedIds);
                if (window.confirm(`Delete ${ids.length} item${ids.length > 1 ? 's' : ''}? This cannot be undone.`)) {
                  onDeleteItems(ids);
                  setSelectedIds(new Set());
                }
              }}
            >
              <MaterialSymbol icon="delete" size={16} />
              Delete
            </button>
          )}
        </div>
        </FloatingPortal>
      )}
    </div>
  );
};

/** Context submenu with hover-expand for KanbanBoard */
const KanbanContextSubmenu: React.FC<{
  label: string;
  icon: string;
  children: React.ReactNode;
}> = ({ label, icon, children }) => {
  const [open, setOpen] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { refs, floatingStyles } = useFloating({
    placement: 'right-start',
    middleware: [offset(2), flip({ padding: 8 }), shift({ padding: 8 })],
  });

  return (
    <div
      ref={refs.setReference as React.RefCallback<HTMLDivElement>}
      onMouseEnter={() => { if (timeoutRef.current) clearTimeout(timeoutRef.current); setOpen(true); }}
      onMouseLeave={() => { timeoutRef.current = setTimeout(() => setOpen(false), 150); }}
    >
      <div className="flex items-center gap-2 px-3 py-1.5 text-nim hover:bg-nim-tertiary cursor-pointer">
        <MaterialSymbol icon={icon} size={16} />
        <span className="flex-1">{label}</span>
        <MaterialSymbol icon="chevron_right" size={14} className="text-nim-faint" />
      </div>
      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            className="min-w-[140px] bg-nim-secondary border border-nim rounded-md shadow-lg py-1 z-[60]"
            style={floatingStyles}
            onMouseEnter={() => { if (timeoutRef.current) clearTimeout(timeoutRef.current); setOpen(true); }}
            onMouseLeave={() => { timeoutRef.current = setTimeout(() => setOpen(false), 150); }}
          >
            {children}
          </div>
        </FloatingPortal>
      )}
    </div>
  );
};
