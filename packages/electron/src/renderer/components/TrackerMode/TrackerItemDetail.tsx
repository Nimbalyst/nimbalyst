/**
 * TrackerItemDetail - Detail/edit panel for a selected tracker item.
 * Shows all model-defined fields with real editors, description area,
 * and metadata. Appears as a right-side panel in TrackerMainView.
 *
 * For native (database-stored) items, includes an embedded Lexical editor
 * for rich content editing with debounced saves to PGLite.
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { StravuEditor, MaterialSymbol, ProviderIcon } from '@nimbalyst/runtime';
import type { EditorConfig } from '@nimbalyst/runtime/editor';
import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import { globalRegistry } from '@nimbalyst/runtime/plugins/TrackerPlugin/models';
import type { FieldDefinition } from '@nimbalyst/runtime/plugins/TrackerPlugin/models/TrackerDataModel';
import { getRecordTitle, getRecordStatus, getRecordPriority, getRecordField } from '@nimbalyst/runtime/plugins/TrackerPlugin/trackerRecordAccessors';
import { TrackerFieldEditor, type TeamMemberOption } from '@nimbalyst/runtime/plugins/TrackerPlugin/components/TrackerFieldEditor';
import { UserAvatar } from '@nimbalyst/runtime/plugins/TrackerPlugin/components/UserAvatar';
import { trackerItemByIdAtom } from '@nimbalyst/runtime/plugins/TrackerPlugin/trackerDataAtoms';
import { sessionRegistryAtom, type SessionMeta } from '../../store/atoms/sessions';
import { getRelativeTimeString } from '../../utils/dateFormatting';

interface TrackerItemDetailProps {
  itemId: string;
  workspacePath?: string;
  onClose: () => void;
  onSwitchToFilesMode?: () => void;
  onSwitchToAgentMode?: (sessionId: string) => void;
  onLaunchSession?: (trackerItemId: string) => void;
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
  feature: '#10b981',
};

function getTypeIcon(type: string): string {
  const icons: Record<string, string> = {
    bug: 'bug_report',
    task: 'check_box',
    plan: 'assignment',
    idea: 'lightbulb',
    decision: 'gavel',
    feature: 'rocket_launch',
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

/** Whether this record is a native DB item (no file backing) */
function isNativeItem(record: TrackerRecord): boolean {
  return record.source === 'native' || !record.system.documentPath;
}

/** Whether this record's metadata fields are editable */
function isEditable(record: TrackerRecord): boolean {
  return isNativeItem(record) || record.source === 'frontmatter' || record.source === 'import' || record.source === 'inline';
}

/** Source label for the metadata footer */
function getSourceLabel(record: TrackerRecord): string | null {
  if (!record.source || record.source === 'native') return 'Database (no file backing)';
  if (record.source === 'inline') return `Inline marker${record.sourceRef ? ` in ${record.sourceRef}` : ''}`;
  if (record.source === 'frontmatter') return `Frontmatter${record.sourceRef ? ` in ${record.sourceRef}` : ''}`;
  if (record.source === 'import') return `Imported${record.sourceRef ? ` from ${record.sourceRef}` : ''}`;
  return null;
}

/** Inline editor for adding/removing secondary type tags */
const TypeTagsEditor: React.FC<{
  typeTags: string[];
  primaryType: string;
  onUpdate: (tags: string[]) => void;
}> = ({ typeTags, primaryType, onUpdate }) => {
  const [isOpen, setIsOpen] = useState(false);
  const allModels = globalRegistry.getAll().filter(m => m.primaryCapable !== false && m.creatable !== false);
  const secondaryTags = typeTags.filter(t => t !== primaryType);
  const availableTypes = allModels.filter(m => m.type !== primaryType && !typeTags.includes(m.type));

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-nim-faint font-medium uppercase tracking-wider">Type Tags</span>
        <button
          className="text-[10px] text-nim-muted hover:text-nim px-1 py-0.5 rounded hover:bg-nim-tertiary"
          onClick={() => setIsOpen(!isOpen)}
        >
          {isOpen ? 'Done' : '+ Add'}
        </button>
      </div>
      {secondaryTags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {secondaryTags.map(tag => {
            const tagModel = globalRegistry.get(tag);
            const tagColor = TYPE_COLORS[tag] || '#6b7280';
            return (
              <span
                key={tag}
                className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded cursor-pointer group"
                style={{ color: tagColor, backgroundColor: `${tagColor}15`, border: `1px solid ${tagColor}30` }}
                onClick={() => onUpdate(typeTags.filter(t => t !== tag))}
                title={`Remove ${tagModel?.displayName || tag} tag`}
              >
                {tagModel?.displayName || tag}
                <span className="opacity-0 group-hover:opacity-100 text-[9px]">&times;</span>
              </span>
            );
          })}
        </div>
      )}
      {isOpen && availableTypes.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-1">
          {availableTypes.map(m => {
            const tagColor = TYPE_COLORS[m.type] || '#6b7280';
            return (
              <button
                key={m.type}
                className="text-[10px] font-medium px-1.5 py-0.5 rounded hover:opacity-80"
                style={{ color: tagColor, backgroundColor: `${tagColor}10`, border: `1px dashed ${tagColor}40` }}
                onClick={() => {
                  onUpdate([...typeTags, m.type]);
                }}
              >
                + {m.displayName}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export const TrackerItemDetail: React.FC<TrackerItemDetailProps> = ({
  itemId,
  workspacePath,
  onClose,
  onSwitchToFilesMode,
  onSwitchToAgentMode,
  onLaunchSession,
  onArchive,
  onDelete,
}) => {
  // Read directly from per-item atom -- only re-renders when THIS item changes,
  // not when any other item in the workspace updates.
  const item = useAtomValue(trackerItemByIdAtom(itemId));
  const sessionRegistry = useAtomValue(sessionRegistryAtom);

  const model = useMemo(() => globalRegistry.get(item?.primaryType ?? ''), [item?.primaryType]);

  // Fetch team members for user picker dropdowns via IPC
  const [teamMembers, setTeamMembers] = useState<TeamMemberOption[]>([]);
  useEffect(() => {
    if (!workspacePath) return;
    (async () => {
      try {
        const teamResult = await window.electronAPI.invoke('team:find-for-workspace', workspacePath);
        if (!teamResult?.success || !teamResult.team?.orgId) return;
        const membersResult = await window.electronAPI.invoke('team:list-members', teamResult.team.orgId);
        if (!membersResult?.success || !membersResult.members) return;
        setTeamMembers(
          membersResult.members
            .filter((m: any) => m.email)
            .map((m: any) => ({ email: m.email, name: m.name || undefined }))
        );
      } catch {
        // Not in a team context -- no dropdown
      }
    })();
  }, [workspacePath]);
  const typeColor = TYPE_COLORS[item?.primaryType ?? ''] || '#6b7280';
  const icon = model?.icon || getTypeIcon(item?.primaryType ?? '');

  // Resolve linked sessions from registry (silently filter deleted ones)
  // Two sources: 1) tracker item's linkedSessions[] (forward link from DB items)
  //              2) sessions whose linkedTrackerItemIds contains this item's ID or file path (reverse link)
  const linkedSessions = useMemo(() => {
    const sessionSet = new Set<string>();

    // Forward: tracker record stores session IDs in system
    const forwardIds: string[] = item?.system?.linkedSessions || [];
    for (const id of forwardIds) sessionSet.add(id);

    // Reverse: sessions that link to this item by ID or by file path
    const trackerItemId = item?.id;
    const filePath = item?.system?.documentPath;
    const fileRef = filePath ? `file:${filePath}` : null;

    // console.log('[TrackerItemDetail] reverse lookup:', { trackerItemId, filePath, fileRef });

    sessionRegistry.forEach((session, sessionId) => {
      const linked = session.linkedTrackerItemIds;
      if (!linked) return;
      if (trackerItemId && linked.includes(trackerItemId)) sessionSet.add(sessionId);
      if (fileRef && linked.includes(fileRef)) sessionSet.add(sessionId);
    });

    if (sessionSet.size === 0) return [];
    return Array.from(sessionSet)
      .map(id => sessionRegistry.get(id))
      .filter((s): s is SessionMeta => s != null)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [item, sessionRegistry]);

  // Local state for text fields (debounced save)
  const [localTitle, setLocalTitle] = useState(item ? getRecordTitle(item) : '');
  const [localDescription, setLocalDescription] = useState(item ? (item.fields.description as string ?? '') : '');
  const [localCustomFields, setLocalCustomFields] = useState<Record<string, any>>({});
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editable = item ? isEditable(item) : false;
  const hasRichContent = item ? isNativeItem(item) : false; // Only native items have embedded Lexical content

  // Rich content editor state
  const [contentMarkdown, setContentMarkdown] = useState<string | null>(null);
  const [contentLoaded, setContentLoaded] = useState(false);
  const getContentFnRef = useRef<(() => string) | null>(null);
  const contentSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track local content saves to skip refetch (prevents cursor loss)
  const lastLocalContentSaveRef = useRef<number>(0);
  const [contentFetchTrigger, setContentFetchTrigger] = useState(0);

  // Reset local editing state when navigating to a different item.
  // We don't sync on item data changes (saves) to avoid clobbering in-progress text.
  // TrackerItemDetail subscribes to trackerItemByIdAtom(itemId) directly, so it only
  // re-renders when its own item changes -- no prop-drilling churn from parent re-renders.
  useEffect(() => {
    if (!item) return;
    setLocalTitle(getRecordTitle(item));
    setLocalDescription(item.fields.description as string ?? '');
    setLocalCustomFields({});
    // Clear any stale debounce timer from the previous item
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, [itemId]); // itemId only -- not item fields

  // Load rich content from PGLite when item changes (only native items have embedded content).
  // Also re-fetches when updatedAt changes from a remote sync, but skips if we just saved locally
  // to prevent cursor loss / editor repaint.
  useEffect(() => {
    if (!hasRichContent) {
      setContentLoaded(true);
      return;
    }

    // Defer refetch if a local content save happened recently (prevents cursor loss).
    // Schedule a retry after the window expires so remote content updates aren't lost.
    const sinceLastSave = Date.now() - lastLocalContentSaveRef.current;
    if (contentLoaded && sinceLastSave < 3000) {
      const retryTimer = setTimeout(() => {
        lastLocalContentSaveRef.current = 0;
        setContentFetchTrigger(n => n + 1);
      }, 3000 - sinceLastSave + 100);
      return () => clearTimeout(retryTimer);
    }

    let cancelled = false;
    setContentLoaded(false);
    setContentMarkdown(null);
    getContentFnRef.current = null;

    window.electronAPI.documentService.getTrackerItemContent({ itemId: item!.id })
      .then((result) => {
        if (cancelled) return;
        if (result.success && result.content != null) {
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
  }, [item?.id, hasRichContent, item?.system?.updatedAt, contentFetchTrigger]);

  // Escape to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const syncMode = useMemo(() => {
    const tracker = globalRegistry.get(item?.primaryType ?? '');
    return tracker?.sync?.mode || 'local';
  }, [item?.primaryType]);

  /** Save a field update -- routes to file-based save for file-backed items, DB for native */
  const saveField = useCallback(async (updates: Record<string, any>) => {
    if (!editable || !item) return;
    try {
      if ((item.source === 'frontmatter' || item.source === 'import' || item.source === 'inline') && item.system.documentPath) {
        // File-backed items with a real document path: update in source file
        await window.electronAPI.documentService.updateTrackerItemInFile({
          itemId: item.id,
          updates,
        });
      } else {
        // Native DB items, or file-backed items whose document_path is missing/empty
        await window.electronAPI.documentService.updateTrackerItem({
          itemId: item.id,
          updates,
          syncMode,
        });
      }
    } catch (err) {
      console.error('[TrackerItemDetail] Failed to save field:', err);
    }
  }, [item?.id, item?.source, editable, syncMode]);

  /** Debounced save for text fields */
  const debouncedSave = useCallback((updates: Record<string, any>) => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      saveField(updates);
    }, 500);
  }, [saveField]);

  /** Debounced save for rich content */
  const saveContent = useCallback((markdown: string) => {
    if (contentSaveTimerRef.current) clearTimeout(contentSaveTimerRef.current);
    contentSaveTimerRef.current = setTimeout(async () => {
      try {
        lastLocalContentSaveRef.current = Date.now();
        await window.electronAPI.documentService.updateTrackerItemContent({
          itemId: item!.id,
          content: markdown,
        });
      } catch (err) {
        console.error('[TrackerItemDetail] Failed to save content:', err);
      }
    }, 800);
  }, [item?.id]);

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
          itemId: item!.id,
          content: markdown,
        }).catch(() => {});
      }
    };
  }, [item?.id]);

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
    if (!item?.system.documentPath) return;
    const documentService = (window as any).documentService;
    if (!documentService?.openDocument || !documentService?.getDocumentByPath) return;

    if (onSwitchToFilesMode) onSwitchToFilesMode();

    documentService.getDocumentByPath(item.system.documentPath).then((doc: any) => {
      if (doc) {
        documentService.openDocument(doc.id);
      }
    });
  }, [item?.system.documentPath, onSwitchToFilesMode]);

  // Separate fields into categories for layout
  const { primaryFields, customFields } = useMemo(() => {
    if (!model) return { primaryFields: [] as FieldDefinition[], customFields: [] as FieldDefinition[] };

    const builtinNames = new Set(['title', 'description', 'created', 'updated']);
    // Resolve primary field names from schema roles instead of hardcoding
    const primaryNames = new Set<string>();
    for (const role of ['workflowStatus', 'priority', 'assignee', 'reporter', 'dueDate'] as const) {
      const fieldName = model.roles?.[role];
      if (fieldName) primaryNames.add(fieldName);
    }
    // Fallback conventional names when roles aren't declared
    if (primaryNames.size === 0) {
      for (const name of ['status', 'priority', 'owner', 'assigneeEmail', 'reporterEmail', 'dueDate']) {
        if (model.fields.some(f => f.name === name)) primaryNames.add(name);
      }
    }
    const primary: FieldDefinition[] = [];
    const custom: FieldDefinition[] = [];

    for (const field of model.fields) {
      if (builtinNames.has(field.name)) continue;
      if (primaryNames.has(field.name)) {
        primary.push(field);
      } else {
        custom.push(field);
      }
    }

    return { primaryFields: primary, customFields: custom };
  }, [model]);

  /** Get field value -- use in-progress local state for text fields, atom for select/etc */
  const getFieldValue = useCallback((fieldName: string): any => {
    if (!item) return undefined;
    // For text-like fields being edited, localCustomFields holds the in-progress value.
    // handleTextFieldChange stores owner (and other string fields) in localCustomFields,
    // so we must check it first to avoid resetting input on each keystroke.
    if (fieldName in localCustomFields) return localCustomFields[fieldName];
    // All fields are now in record.fields (schema-driven)
    return item.fields[fieldName];
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

  // Item deleted while panel was open (or not yet in atom — brief loading state)
  if (!item) {
    return (
      <div
        className="tracker-item-detail flex flex-col h-full bg-nim overflow-hidden items-center justify-center text-nim-faint text-sm"
        data-testid="tracker-item-detail"
      >
        Item no longer exists
      </div>
    );
  }

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
            <h3 className="text-base font-semibold text-nim m-0 leading-snug">{getRecordTitle(item)}</h3>
          )}
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span
              className="text-[10px] font-medium px-1.5 py-0.5 rounded"
              style={{
                color: typeColor,
                backgroundColor: `${typeColor}20`,
              }}
            >
              {model?.displayName || item.primaryType}
            </span>
            {/* Secondary type tags */}
            {item.typeTags
              .filter(tag => tag !== item.primaryType)
              .map(tag => {
                const tagModel = globalRegistry.get(tag);
                const tagColor = TYPE_COLORS[tag] || '#6b7280';
                return (
                  <span
                    key={tag}
                    className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                    style={{
                      color: tagColor,
                      backgroundColor: `${tagColor}15`,
                      border: `1px solid ${tagColor}30`,
                    }}
                  >
                    {tagModel?.displayName || tag}
                  </span>
                );
              })}
            {isNativeItem(item) && (
              <span
                className="text-[10px] font-medium px-1.5 py-0.5 rounded flex items-center gap-0.5"
                style={{ backgroundColor: '#6b728020', color: '#9ca3af' }}
                title="Stored in database — not backed by a file"
                data-testid="tracker-source-db-badge"
              >
                <MaterialSymbol icon="storage" size={11} />
                Database
              </span>
            )}
            {(item.issueKey || item.id) && (
              <span className="text-[10px] text-nim-faint font-mono">{item.issueKey || item.id}</span>
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
                if (window.confirm(`Delete "${getRecordTitle(item)}"? This cannot be undone.`)) {
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
                    teamMembers={teamMembers}
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

        {/* Type tags editor (for native/editable items) */}
        {editable && (
          <TypeTagsEditor
            typeTags={item.typeTags}
            primaryType={item.primaryType}
            onUpdate={(newTags) => {
              // Save via IPC -- typeTags are stored in the DB column, not JSONB data
              window.electronAPI.documentService.updateTrackerItem({
                itemId: item.id,
                updates: { typeTags: newTags },
                syncMode,
              }).catch((err: any) => console.error('[TrackerItemDetail] Failed to save type tags:', err));
            }}
          />
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
                    teamMembers={teamMembers}
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
          ) : item.system.documentPath ? (
            <div className="flex items-center gap-2 py-2">
              <span className="text-sm text-nim-muted flex-1 truncate font-mono">
                {item.system.documentPath}
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

        {/* Linked Sessions */}
        {(linkedSessions.length > 0 || onLaunchSession) && (
          <div className="pt-1 border-t border-nim">
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[11px] font-medium text-nim-muted uppercase tracking-[0.5px]">
                Sessions{linkedSessions.length > 0 ? ` (${linkedSessions.length})` : ''}
              </label>
              {onLaunchSession && (
                <button
                  className="flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-medium rounded text-nim-muted hover:text-nim hover:bg-nim-tertiary transition-colors"
                  onClick={() => onLaunchSession(item.id)}
                  title="Launch a new AI session for this item"
                >
                  <MaterialSymbol icon="add" size={14} />
                  Launch Session
                </button>
              )}
            </div>
            {linkedSessions.length > 0 ? (
              <div className="space-y-1">
                {linkedSessions.map((session) => (
                  <button
                    key={session.id}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left hover:bg-nim-tertiary transition-colors group"
                    onClick={() => onSwitchToAgentMode?.(session.id)}
                    title={`Open session: ${session.title}`}
                  >
                    <ProviderIcon provider={session.provider || 'claude'} size={14} />
                    <span className="flex-1 text-xs text-nim truncate">
                      {session.title || 'Untitled session'}
                    </span>
                    <span className="text-[10px] text-nim-faint shrink-0">
                      {getRelativeTimeString(session.updatedAt)}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-nim-faint m-0">No linked sessions</p>
            )}
          </div>
        )}

        {/* Comments section */}
        {item.source !== 'inline' && item.source !== 'frontmatter' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-medium text-nim-muted uppercase tracking-wide">Comments</h4>
            </div>
            <CommentsSection itemId={item.id} comments={item.system.comments} />
          </div>
        )}

        {/* Activity log */}
        {item.system.activity && item.system.activity.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-nim-muted uppercase tracking-wide">Activity</h4>
            <div className="space-y-1">
              {item.system.activity.slice(-10).reverse().map((entry: any) => (
                <div key={entry.id} className="flex items-start gap-2 text-[11px]">
                  <span className="text-nim-muted shrink-0">{entry.authorIdentity?.displayName || 'Unknown'}</span>
                  <span className="text-nim-faint">
                    {entry.action === 'created' ? 'created this item' :
                     entry.action === 'commented' ? 'added a comment' :
                     entry.action === 'status_changed' ? `changed status to ${entry.newValue}` :
                     entry.action === 'archived' ? (entry.newValue === 'true' ? 'archived' : 'unarchived') :
                     entry.field ? `updated ${entry.field}` : entry.action}
                  </span>
                  <span className="text-nim-faint ml-auto shrink-0">{getRelativeTimeString(entry.timestamp)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Metadata footer */}
        <div className="pt-1 border-t border-nim">
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            {/* Author identity */}
            {item.system.authorIdentity && (
              <div className="col-span-2 flex items-center gap-1.5">
                <span className="text-nim-faint shrink-0">Created by</span>
                <UserAvatar identity={item.system.authorIdentity} showName size={16} />
                {item.system.createdByAgent && (
                  <span className="text-[10px] text-nim-faint bg-nim-tertiary px-1 py-0.5 rounded">via AI</span>
                )}
              </div>
            )}
            {/* Last modifier */}
            {item.system.lastModifiedBy && item.system.lastModifiedBy.displayName !== item.system.authorIdentity?.displayName && (
              <div className="col-span-2 flex items-center gap-1.5">
                <span className="text-nim-faint shrink-0">Modified by</span>
                <UserAvatar identity={item.system.lastModifiedBy} showName size={16} />
              </div>
            )}
            <div>
              <span className="text-nim-faint">Created</span>
              <div className="text-nim-muted">{formatTimestamp(item.system.createdAt)}</div>
            </div>
            <div>
              <span className="text-nim-faint">Updated</span>
              <div className="text-nim-muted">{formatTimestamp(item.system.updatedAt || item.system.lastIndexed)}</div>
            </div>
            {item.issueKey && (
              <div>
                <span className="text-nim-faint">Key</span>
                <div className="text-nim-muted font-mono">{item.issueKey}</div>
              </div>
            )}
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
            {item.system.documentPath && !sourceLabel && (
              <div className="col-span-2">
                <span className="text-nim-faint">Source</span>
                <div className="text-nim-muted font-mono truncate">{item.system.documentPath}</div>
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
  } else if (typeof value === 'object') {
    // Safety: format objects as JSON rather than [object Object]
    displayValue = JSON.stringify(value);
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

/** Inline comments section for tracker items */
const CommentsSection: React.FC<{ itemId: string; comments?: any[] }> = ({ itemId, comments }) => {
  const [newComment, setNewComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const visibleComments = (comments || []).filter((c: any) => !c.deleted);

  const handleSubmit = useCallback(async () => {
    if (!newComment.trim() || submitting) return;
    setSubmitting(true);
    try {
      await window.electronAPI.invoke('document-service:tracker-item-add-comment', {
        itemId,
        body: newComment.trim(),
      });
      setNewComment('');
    } catch (err) {
      console.error('Failed to add comment:', err);
    } finally {
      setSubmitting(false);
    }
  }, [itemId, newComment, submitting]);

  return (
    <div className="space-y-2">
      {visibleComments.map((comment: any) => (
        <div key={comment.id} className="rounded bg-nim-tertiary p-2 space-y-1">
          <div className="flex items-center gap-2 text-[11px]">
            <span className="font-medium text-nim-muted">{comment.authorIdentity?.displayName || 'Unknown'}</span>
            <span className="text-nim-faint">{getRelativeTimeString(comment.createdAt)}</span>
            {comment.updatedAt && <span className="text-nim-faint">(edited)</span>}
          </div>
          <p className="text-xs text-nim m-0 whitespace-pre-wrap">{comment.body}</p>
        </div>
      ))}
      <div className="flex gap-1">
        <input
          type="text"
          value={newComment}
          onChange={e => setNewComment(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
          placeholder="Add a comment..."
          className="flex-1 bg-nim-secondary border border-nim rounded px-2 py-1 text-xs text-nim placeholder:text-nim-faint outline-none focus:border-nim-primary"
        />
        <button
          onClick={handleSubmit}
          disabled={!newComment.trim() || submitting}
          className="px-2 py-1 rounded text-xs bg-nim-primary text-white disabled:opacity-40 hover:opacity-90 transition-opacity"
        >
          Post
        </button>
      </div>
    </div>
  );
};
