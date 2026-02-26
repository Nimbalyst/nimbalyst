/**
 * TrackerItemDetail - Detail/edit panel for a selected tracker item.
 * Shows all model-defined fields with real editors, description area,
 * and metadata. Appears as a right-side panel in TrackerMainView.
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';
import type { TrackerItem, TrackerItemType } from '@nimbalyst/runtime';
import { globalRegistry } from '@nimbalyst/runtime/plugins/TrackerPlugin/models';
import type { FieldDefinition } from '@nimbalyst/runtime/plugins/TrackerPlugin/models/TrackerDataModel';
import { TrackerFieldEditor } from '@nimbalyst/runtime/plugins/TrackerPlugin/components/TrackerFieldEditor';

interface TrackerItemDetailProps {
  item: TrackerItem;
  onClose: () => void;
  onSwitchToFilesMode?: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  'to-do': '#6b7280',
  'in-progress': '#eab308',
  'in-review': '#8b5cf6',
  'done': '#22c55e',
  'blocked': '#ef4444',
};

const PRIORITY_COLORS: Record<string, string> = {
  critical: '#dc2626',
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

function getTypeIcon(type: string): string {
  const icons: Record<string, string> = {
    bug: 'bug_report',
    task: 'check_box',
    plan: 'assignment',
    idea: 'lightbulb',
    decision: 'gavel',
  };
  return icons[type] || 'label';
}

function formatTimestamp(value: string | Date | number | undefined): string {
  if (!value) return '\u2014';
  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime()) || date.getTime() === 0) return '\u2014';
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Whether this item is stored in PGLite (editable) vs parsed from frontmatter (read-only metadata) */
function isDbItem(item: TrackerItem): boolean {
  return !item.module;
}

export const TrackerItemDetail: React.FC<TrackerItemDetailProps> = ({
  item,
  onClose,
  onSwitchToFilesMode,
}) => {
  const model = useMemo(() => globalRegistry.get(item.type), [item.type]);
  const typeColor = TYPE_COLORS[item.type] || '#6b7280';
  const icon = model?.icon || getTypeIcon(item.type);

  // Local state for text fields (debounced save)
  const [localTitle, setLocalTitle] = useState(item.title);
  const [localDescription, setLocalDescription] = useState(item.description || '');
  const [localCustomFields, setLocalCustomFields] = useState<Record<string, any>>(item.customFields || {});
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editable = isDbItem(item);

  // Sync local state from atom-driven item prop.
  // Skip the sync while a debounced save is pending - the user is actively editing
  // and resetting local state would clobber their in-progress text.
  useEffect(() => {
    if (debounceTimerRef.current) return; // user is typing, don't clobber
    setLocalTitle(item.title);
    setLocalDescription(item.description || '');
    setLocalCustomFields(item.customFields || {});
  }, [item.id, item.title, item.description, item.customFields]);

  // Escape to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const syncMode = useMemo(() => {
    const tracker = globalRegistry.get(item.type);
    return tracker?.sync?.mode || 'local';
  }, [item.type]);

  /** Save a field update to PGLite via IPC */
  const saveField = useCallback(async (updates: Record<string, any>) => {
    if (!editable) return;
    console.log('[TrackerItemDetail] saveField called:', { itemId: item.id, syncMode, updates: Object.keys(updates) });
    try {
      const result = await window.electronAPI.documentService.updateTrackerItem({
        itemId: item.id,
        updates,
        syncMode,
      });
      console.log('[TrackerItemDetail] saveField result:', result);
    } catch (err) {
      console.error('[TrackerItemDetail] Failed to save field:', err);
    }
  }, [item.id, editable, syncMode]);

  /** Debounced save for text fields */
  const debouncedSave = useCallback((updates: Record<string, any>) => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => saveField(updates), 500);
  }, [saveField]);

  // Cleanup debounce timer
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, []);

  /** Handle immediate field change (selects, checkboxes) */
  const handleImmediateFieldChange = useCallback((fieldName: string, value: any) => {
    saveField({ [fieldName]: value });
  }, [saveField]);

  /** Handle debounced text field change */
  const handleTextFieldChange = useCallback((fieldName: string, value: any) => {
    if (fieldName === 'title') {
      setLocalTitle(value);
    } else if (fieldName === 'description') {
      setLocalDescription(value);
    } else {
      setLocalCustomFields(prev => ({ ...prev, [fieldName]: value }));
    }
    debouncedSave({ [fieldName]: value });
  }, [debouncedSave]);

  /** Open the source document in Files mode */
  const handleOpenDocument = useCallback(() => {
    if (!item.module) return;
    const documentService = (window as any).documentService;
    if (!documentService?.openDocument || !documentService?.getDocumentByPath) return;

    if (onSwitchToFilesMode) onSwitchToFilesMode();

    documentService.getDocumentByPath(item.module).then((doc: any) => {
      if (doc) {
        documentService.openDocument(doc.id);
      }
    });
  }, [item.module, onSwitchToFilesMode]);

  // Separate fields into categories for layout
  const { primaryFields, customFields } = useMemo(() => {
    if (!model) return { primaryFields: [] as FieldDefinition[], customFields: [] as FieldDefinition[] };

    const builtinNames = new Set(['title', 'description', 'created', 'updated']);
    const primary: FieldDefinition[] = [];
    const custom: FieldDefinition[] = [];

    for (const field of model.fields) {
      if (builtinNames.has(field.name)) continue;
      // Status, priority, owner go in primary grid
      if (field.name === 'status' || field.name === 'priority' || field.name === 'owner') {
        primary.push(field);
      } else {
        custom.push(field);
      }
    }

    return { primaryFields: primary, customFields: custom };
  }, [model]);

  /** Get field value -- check top-level item properties first, then customFields */
  const getFieldValue = useCallback((fieldName: string): any => {
    // Top-level TrackerItem fields
    if (fieldName === 'status') return item.status;
    if (fieldName === 'priority') return item.priority;
    if (fieldName === 'owner') return item.owner;
    if (fieldName === 'tags') return item.tags;
    if (fieldName === 'progress') return item.progress;
    if (fieldName === 'dueDate') return item.dueDate;
    // Custom fields (use local state for text fields)
    return localCustomFields[fieldName] ?? item.customFields?.[fieldName];
  }, [item, localCustomFields]);

  /** Determine whether a field change should be immediate or debounced */
  const handleFieldChange = useCallback((field: FieldDefinition, value: any) => {
    const isTextLike = field.type === 'string' || field.type === 'text' || field.type === 'user';
    if (isTextLike) {
      handleTextFieldChange(field.name, value);
    } else {
      handleImmediateFieldChange(field.name, value);
    }
  }, [handleTextFieldChange, handleImmediateFieldChange]);

  return (
    <div
      className="tracker-item-detail flex flex-col h-full bg-nim overflow-hidden"
      data-testid="tracker-item-detail"
    >
      {/* Header */}
      <div className="flex items-start gap-2 px-4 pt-4 pb-3 border-b border-nim shrink-0">
        <span className="mt-1 shrink-0" style={{ color: typeColor }}>
          <MaterialSymbol icon={icon} size={20} />
        </span>
        <div className="flex-1 min-w-0">
          {editable ? (
            <input
              type="text"
              value={localTitle}
              onChange={(e) => handleTextFieldChange('title', e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              className="w-full bg-transparent border-none outline-none text-base font-semibold text-nim placeholder:text-nim-faint p-0"
              placeholder="Item title..."
              data-testid="tracker-detail-title"
            />
          ) : (
            <h3 className="text-base font-semibold text-nim m-0 leading-snug">{item.title}</h3>
          )}
          <div className="flex items-center gap-2 mt-1">
            <span
              className="text-[10px] font-medium px-1.5 py-0.5 rounded"
              style={{
                color: typeColor,
                backgroundColor: `${typeColor}20`,
              }}
            >
              {model?.displayName || item.type}
            </span>
            {item.id && (
              <span className="text-[10px] text-nim-faint font-mono">{item.id}</span>
            )}
          </div>
        </div>
        <button
          className="p-1 rounded hover:bg-nim-tertiary text-nim-muted shrink-0"
          onClick={onClose}
          title="Close (Esc)"
        >
          <MaterialSymbol icon="close" size={18} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {/* Primary fields grid (status, priority, owner) */}
        {primaryFields.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            {primaryFields.map((field) => (
              <div key={field.name}>
                {editable ? (
                  <TrackerFieldEditor
                    field={field}
                    value={getFieldValue(field.name)}
                    onChange={(value) => handleFieldChange(field, value)}
                  />
                ) : (
                  <ReadOnlyField
                    field={field}
                    value={getFieldValue(field.name)}
                  />
                )}
              </div>
            ))}
          </div>
        )}

        {/* Custom fields */}
        {customFields.length > 0 && (
          <div className="space-y-3 pt-1 border-t border-nim">
            {customFields.map((field) => (
              <div key={field.name}>
                {editable ? (
                  <TrackerFieldEditor
                    field={field}
                    value={getFieldValue(field.name)}
                    onChange={(value) => handleFieldChange(field, value)}
                  />
                ) : (
                  <ReadOnlyField
                    field={field}
                    value={getFieldValue(field.name)}
                  />
                )}
              </div>
            ))}
          </div>
        )}

        {/* Description */}
        <div className="pt-1 border-t border-nim">
          <label className="text-[11px] font-medium text-nim-muted uppercase tracking-[0.5px] block mb-1">
            Description
          </label>
          {editable ? (
            <textarea
              value={localDescription}
              onChange={(e) => handleTextFieldChange('description', e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              className="w-full min-h-[120px] py-2 px-2 border border-nim rounded bg-nim text-nim text-[13px] resize-y focus:outline-none focus:border-[var(--nim-primary)]"
              placeholder="Add a description..."
              data-testid="tracker-detail-description"
            />
          ) : item.module ? (
            <div className="flex items-center gap-2 py-2">
              <span className="text-sm text-nim-muted flex-1 truncate font-mono">
                {item.module}
              </span>
              <button
                className="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded border border-nim text-nim-muted hover:text-nim hover:bg-nim-tertiary transition-colors"
                onClick={handleOpenDocument}
              >
                <MaterialSymbol icon="open_in_new" size={14} />
                Open in Editor
              </button>
            </div>
          ) : (
            <p className="text-sm text-nim-faint m-0">No description</p>
          )}
        </div>

        {/* Metadata footer */}
        <div className="pt-1 border-t border-nim">
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div>
              <span className="text-nim-faint">Created</span>
              <div className="text-nim-muted">{formatTimestamp(item.created)}</div>
            </div>
            <div>
              <span className="text-nim-faint">Updated</span>
              <div className="text-nim-muted">{formatTimestamp(item.updated || item.lastIndexed)}</div>
            </div>
            {item.syncStatus && (
              <div>
                <span className="text-nim-faint">Sync</span>
                <div className="text-nim-muted">
                  <span
                    className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium"
                    style={{
                      backgroundColor: item.syncStatus === 'synced' ? '#22c55e20' : item.syncStatus === 'pending' ? '#eab30820' : '#6b728020',
                      color: item.syncStatus === 'synced' ? '#22c55e' : item.syncStatus === 'pending' ? '#eab308' : '#6b7280',
                    }}
                  >
                    {item.syncStatus}
                  </span>
                </div>
              </div>
            )}
            {item.module && (
              <div className="col-span-2">
                <span className="text-nim-faint">Source</span>
                <div className="text-nim-muted font-mono truncate">{item.module}</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

/** Read-only field display for non-editable items (frontmatter-based) */
const ReadOnlyField: React.FC<{ field: FieldDefinition; value: any }> = ({ field, value }) => {
  const label = field.name
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, s => s.toUpperCase())
    .trim();

  let displayValue: string;
  if (value == null || value === '') {
    displayValue = '\u2014';
  } else if (Array.isArray(value)) {
    displayValue = value.join(', ') || '\u2014';
  } else if (value instanceof Date) {
    displayValue = value.toLocaleDateString();
  } else if (typeof value === 'boolean') {
    displayValue = value ? 'Yes' : 'No';
  } else {
    displayValue = String(value);
  }

  // For select fields, show the label not the raw value
  if (field.type === 'select' && field.options && value) {
    const option = field.options.find(o => o.value === value);
    if (option) {
      const color = option.color || STATUS_COLORS[value] || PRIORITY_COLORS[value] || '#6b7280';
      return (
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-[var(--nim-text-muted)] uppercase tracking-[0.5px]">{label}</span>
          <span
            className="inline-block self-start px-2 py-0.5 rounded-[10px] text-[11px] font-medium border"
            style={{
              backgroundColor: `${color}20`,
              color,
              borderColor: color,
            }}
          >
            {option.label}
          </span>
        </div>
      );
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-[var(--nim-text-muted)] uppercase tracking-[0.5px]">{label}</span>
      <span className="text-[13px] text-[var(--nim-text)]">{displayValue}</span>
    </div>
  );
};
