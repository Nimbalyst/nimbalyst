/**
 * TrackerItemDetail - Detail/edit panel for a selected tracker item.
 * Shows all model-defined fields with real editors, description area,
 * and metadata. Appears as a right-side panel in TrackerMainView.
 *
 * For native (database-stored) items, includes an embedded Lexical editor
 * for rich content editing with debounced saves to PGLite.
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { StravuEditor, MaterialSymbol } from '@nimbalyst/runtime';
import type { EditorConfig } from '@nimbalyst/runtime/editor';
import type { TrackerItem, TrackerItemType } from '@nimbalyst/runtime';
import { globalRegistry } from '@nimbalyst/runtime/plugins/TrackerPlugin/models';
import type { FieldDefinition } from '@nimbalyst/runtime/plugins/TrackerPlugin/models/TrackerDataModel';
import { TrackerFieldEditor } from '@nimbalyst/runtime/plugins/TrackerPlugin/components/TrackerFieldEditor';

interface TrackerItemDetailProps {
  item: TrackerItem;
  onClose: () => void;
  onSwitchToFilesMode?: () => void;
  onArchive?: (itemId: string, archive: boolean) => void;
  onDelete?: (itemId: string) => void;
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

/** Whether this item is a native DB item (no file backing) */
function isNativeItem(item: TrackerItem): boolean {
  return !item.module;
}

/** Whether this item's metadata fields are editable (native or frontmatter-backed) */
function isEditable(item: TrackerItem): boolean {
  return isNativeItem(item) || item.source === 'frontmatter' || item.source === 'import';
}

/** Source label for display */
function getSourceLabel(item: TrackerItem): string | null {
  if (!item.source || item.source === 'native') return null;
  if (item.source === 'inline') return `From inline marker${item.sourceRef ? ` in ${item.sourceRef}` : ''}`;
  if (item.source === 'frontmatter') return `From frontmatter${item.sourceRef ? ` in ${item.sourceRef}` : ''}`;
  if (item.source === 'import') return `Imported${item.sourceRef ? ` from ${item.sourceRef}` : ''}`;
  return null;
}

export const TrackerItemDetail: React.FC<TrackerItemDetailProps> = ({
  item,
  onClose,
  onSwitchToFilesMode,
  onArchive,
  onDelete,
}) => {
  const model = useMemo(() => globalRegistry.get(item.type), [item.type]);
  const typeColor = TYPE_COLORS[item.type] || '#6b7280';
  const icon = model?.icon || getTypeIcon(item.type);

  // Local state for text fields (debounced save)
  const [localTitle, setLocalTitle] = useState(item.title);
  const [localDescription, setLocalDescription] = useState(item.description || '');
  const [localCustomFields, setLocalCustomFields] = useState<Record<string, any>>(item.customFields || {});
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editable = isEditable(item);
  const hasRichContent = isNativeItem(item); // Only native items have embedded Lexical content

  // Rich content editor state
  const [contentMarkdown, setContentMarkdown] = useState<string | null>(null);
  const [contentLoaded, setContentLoaded] = useState(false);
  const getContentFnRef = useRef<(() => string) | null>(null);
  const contentSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync local state from atom-driven item prop.
  // Skip the sync while a debounced save is pending - the user is actively editing
  // and resetting local state would clobber their in-progress text.
  useEffect(() => {
    if (debounceTimerRef.current) return; // user is typing, don't clobber
    setLocalTitle(item.title);
    setLocalDescription(item.description || '');
    setLocalCustomFields(item.customFields || {});
  }, [item.id, item.title, item.description, item.customFields]);

  // Load rich content from PGLite when item changes (only native items have embedded content)
  useEffect(() => {
    if (!hasRichContent) {
      setContentLoaded(true);
      return;
    }

    let cancelled = false;
    setContentLoaded(false);
    setContentMarkdown(null);
    getContentFnRef.current = null;

    window.electronAPI.documentService.getTrackerItemContent({ itemId: item.id })
      .then((result) => {
        if (cancelled) return;
        if (result.success && result.content) {
          // Content is stored as markdown string in JSONB
          const markdown = typeof result.content === 'string'
            ? result.content
            : result.content?.markdown ?? '';
          setContentMarkdown(markdown);
        } else {
          setContentMarkdown('');
        }
        setContentLoaded(true);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('[TrackerItemDetail] Failed to load content:', err);
        setContentMarkdown('');
        setContentLoaded(true);
      });

    return () => { cancelled = true; };
  }, [item.id, hasRichContent]);

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

  /** Save a field update -- routes to file-based save for frontmatter items, DB for native */
  const saveField = useCallback(async (updates: Record<string, any>) => {
    if (!editable) return;
    try {
      if (item.source === 'frontmatter' || item.source === 'import') {
        await window.electronAPI.documentService.updateTrackerItemInFile({
          itemId: item.id,
          updates,
        });
      } else {
        await window.electronAPI.documentService.updateTrackerItem({
          itemId: item.id,
          updates,
          syncMode,
        });
      }
    } catch (err) {
      console.error('[TrackerItemDetail] Failed to save field:', err);
    }
  }, [item.id, item.source, editable, syncMode]);

  /** Debounced save for text fields */
  const debouncedSave = useCallback((updates: Record<string, any>) => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => saveField(updates), 500);
  }, [saveField]);

  /** Debounced save for rich content */
  const saveContent = useCallback((markdown: string) => {
    if (contentSaveTimerRef.current) clearTimeout(contentSaveTimerRef.current);
    contentSaveTimerRef.current = setTimeout(async () => {
      try {
        await window.electronAPI.documentService.updateTrackerItemContent({
          itemId: item.id,
          content: markdown,
        });
      } catch (err) {
        console.error('[TrackerItemDetail] Failed to save content:', err);
      }
    }, 800);
  }, [item.id]);

  // Cleanup timers
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      if (contentSaveTimerRef.current) clearTimeout(contentSaveTimerRef.current);
    };
  }, []);

  // Flush pending content save when item changes or component unmounts
  useEffect(() => {
    return () => {
      if (contentSaveTimerRef.current && getContentFnRef.current) {
        clearTimeout(contentSaveTimerRef.current);
        const markdown = getContentFnRef.current();
        // Fire-and-forget final save
        window.electronAPI.documentService.updateTrackerItemContent({
          itemId: item.id,
          content: markdown,
        }).catch(() => {});
      }
    };
  }, [item.id]);

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

  /** Editor config for embedded Lexical editor (native items only) */
  const editorConfig = useMemo((): EditorConfig | null => {
    if (!hasRichContent || !contentLoaded) return null;
    return {
      isRichText: true,
      editable: true,
      showToolbar: false,
      isCodeHighlighted: true,
      hasLinkAttributes: true,
      markdownOnly: true,
      initialContent: contentMarkdown || '',
      onGetContent: (getContentFn: () => string) => {
        getContentFnRef.current = getContentFn;
      },
      onDirtyChange: (isDirty: boolean) => {
        if (isDirty && getContentFnRef.current) {
          const markdown = getContentFnRef.current();
          saveContent(markdown);
        }
      },
    };
  }, [hasRichContent, contentLoaded, contentMarkdown, saveContent]);

  const sourceLabel = getSourceLabel(item);

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
            {item.archived && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-[#6b728020] text-nim-faint">
                Archived
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {onArchive && (
            <button
              className="p-1 rounded hover:bg-nim-tertiary text-nim-muted"
              onClick={() => onArchive(item.id, !item.archived)}
              title={item.archived ? 'Unarchive' : 'Archive'}
            >
              <MaterialSymbol icon={item.archived ? 'unarchive' : 'archive'} size={18} />
            </button>
          )}
          {onDelete && (
            <button
              className="p-1 rounded hover:bg-nim-tertiary text-nim-muted hover:text-[#ef4444]"
              onClick={() => {
                if (window.confirm(`Delete "${item.title}"? This cannot be undone.`)) {
                  onDelete(item.id);
                }
              }}
              title="Delete permanently"
            >
              <MaterialSymbol icon="delete" size={18} />
            </button>
          )}
          <button
            className="p-1 rounded hover:bg-nim-tertiary text-nim-muted"
            onClick={onClose}
            title="Close (Esc)"
          >
            <MaterialSymbol icon="close" size={18} />
          </button>
        </div>
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

        {/* Rich Content Editor / Description */}
        <div className="pt-1 border-t border-nim">
          <label className="text-[11px] font-medium text-nim-muted uppercase tracking-[0.5px] block mb-1">
            Content
          </label>
          {hasRichContent && editorConfig ? (
            <div
              className="tracker-content-editor border border-nim rounded bg-nim min-h-[200px] overflow-hidden"
              data-testid="tracker-detail-content-editor"
            >
              <StravuEditor key={item.id} config={editorConfig} />
            </div>
          ) : hasRichContent && !contentLoaded ? (
            <div className="text-sm text-nim-faint py-4 text-center">Loading...</div>
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
            <p className="text-sm text-nim-faint m-0">No content</p>
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
            {sourceLabel && (
              <div className="col-span-2">
                <span className="text-nim-faint">Source</span>
                <div className="text-nim-muted truncate">{sourceLabel}</div>
              </div>
            )}
            {item.module && !sourceLabel && (
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

/** Read-only field display for non-editable items (e.g. inline items) */
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
