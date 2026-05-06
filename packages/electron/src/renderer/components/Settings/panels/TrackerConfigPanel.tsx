import React, { useState, useEffect, useCallback } from 'react';
import { useAtomValue } from 'jotai';
import {
  MaterialSymbol,
  globalRegistry,
  parseTrackerYAML,
  type TrackerDataModel,
  type TrackerSyncMode,
} from '@nimbalyst/runtime';
import { trackerItemCountByTypeAtom } from '@nimbalyst/runtime/plugins/TrackerPlugin';
import { AlphaBadge } from '../../common/AlphaBadge';
import { TrackerTypeCreator } from './TrackerTypeCreator';
import {
  loadLayout,
  saveLayout,
  loadLegacyState,
  buildLayoutFromLegacy,
  reconcileLayout,
  addFolder,
  renameFolder,
  deleteFolder,
  assignTypeToFolder,
  moveEntry,
  type TrackerSidebarLayout,
} from '../../../services/TrackerSidebarLayout';

// ============================================================================
// Types
// ============================================================================

interface TrackerConfigPanelProps {
  workspacePath?: string;
}

interface TrackerTypeConfig {
  model: TrackerDataModel;
  syncMode: TrackerSyncMode;
}

const ISSUE_KEY_PREFIX_REGEX = /^[A-Z]{2,5}$/;

// ============================================================================
// Sub-components
// ============================================================================

/** Small component so each row subscribes to its own count atom */
function TrackerTypeCount({ type }: { type: string }) {
  const count = useAtomValue(trackerItemCountByTypeAtom(type));
  return <>{count}</>;
}

/** Find the YAML file in .nimbalyst/trackers whose parsed `type` matches and delete it. */
async function deleteCustomTrackerYAML(workspacePath: string, type: string): Promise<boolean> {
  const api = (window as any).electronAPI;
  const trackersDir = `${workspacePath}/.nimbalyst/trackers`;
  let files: Array<{ type: string; name: string }> = [];
  try {
    files = await api.getFolderContents(trackersDir);
  } catch {
    return false;
  }
  const yamlFiles = files.filter(
    (f) => f.type === 'file' && (f.name.endsWith('.yaml') || f.name.endsWith('.yml'))
  );
  for (const file of yamlFiles) {
    const filePath = `${trackersDir}/${file.name}`;
    try {
      const result = await api.readFileContent(filePath);
      if (!result?.success || !result.content) continue;
      const model = parseTrackerYAML(result.content);
      if (model.type === type) {
        await api.deleteFile(filePath);
        return true;
      }
    } catch {
      // Skip unparseable files
    }
  }
  return false;
}

/**
 * Trash button that subscribes to the count atom so it can block deletion when items exist.
 * Rendered only for non-builtin tracker types.
 */
function DeleteTrackerTypeButton({
  model,
  workspacePath,
}: {
  model: TrackerDataModel;
  workspacePath?: string;
}) {
  const count = useAtomValue(trackerItemCountByTypeAtom(model.type));

  const handleClick = useCallback(async () => {
    if (!workspacePath) return;
    if (count > 0) {
      window.alert(
        `Cannot delete "${model.displayNamePlural}": ${count} item${count === 1 ? '' : 's'} of this type still exist. Delete those items first.`
      );
      return;
    }
    if (!window.confirm(`Delete tracker type "${model.displayNamePlural}"? This cannot be undone.`)) {
      return;
    }
    const fileDeleted = await deleteCustomTrackerYAML(workspacePath, model.type);
    if (!fileDeleted) {
      window.alert(
        `Could not find the source YAML file for "${model.displayNamePlural}" in .nimbalyst/trackers/. The tracker type was not deleted.`
      );
      return;
    }
    globalRegistry.unregister(model.type);
  }, [count, model.displayNamePlural, model.type, workspacePath]);

  return (
    <button
      onClick={handleClick}
      className="p-1 rounded text-[var(--nim-text-muted)] hover:text-[#ef4444] hover:bg-[var(--nim-bg-tertiary)] cursor-pointer"
      title={`Delete tracker type "${model.displayNamePlural}"`}
      data-testid={`delete-tracker-type-${model.type}`}
    >
      <MaterialSymbol icon="delete" size={14} />
    </button>
  );
}

function SyncModeToggle({ mode, onChange }: {
  mode: TrackerSyncMode;
  onChange: (mode: TrackerSyncMode) => void;
}) {
  const options: { value: TrackerSyncMode; label: string }[] = [
    { value: 'local', label: 'Local' },
    { value: 'shared', label: 'Shared' },
    { value: 'hybrid', label: 'Hybrid' },
  ];

  return (
    <div className="flex bg-[var(--nim-bg)] border border-[var(--nim-bg-tertiary)] rounded-md overflow-hidden">
      {options.map((opt) => {
        const isActive = mode === opt.value;
        let activeClass = '';
        if (isActive) {
          if (opt.value === 'local') activeClass = 'bg-[var(--nim-bg-tertiary)] text-[var(--nim-text-muted)]';
          else if (opt.value === 'shared') activeClass = 'bg-[rgba(96,165,250,0.2)] text-[var(--nim-primary)]';
          else activeClass = 'bg-[rgba(167,139,250,0.2)] text-[#a78bfa]';
        }

        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`px-2.5 py-1 text-[11px] font-medium cursor-pointer border-none whitespace-nowrap transition-all duration-150 ${
              isActive
                ? activeClass
                : 'bg-transparent text-[var(--nim-text-disabled)]'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function SyncBadge({ mode }: { mode: TrackerSyncMode }) {
  if (mode === 'shared') {
    return (
      <span className="inline-flex items-center gap-1 px-[7px] py-[2px] rounded-[10px] text-[10px] font-semibold bg-[rgba(96,165,250,0.15)] text-[var(--nim-primary)]">
        <MaterialSymbol icon="share" size={8} />
        Shared
      </span>
    );
  }
  if (mode === 'hybrid') {
    return (
      <span className="inline-flex items-center gap-1 px-[7px] py-[2px] rounded-[10px] text-[10px] font-semibold bg-[rgba(167,139,250,0.15)] text-[#a78bfa]">
        Hybrid
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-[7px] py-[2px] rounded-[10px] text-[10px] font-semibold bg-[rgba(180,180,180,0.1)] text-[var(--nim-text-faint)]">
      Local
    </span>
  );
}

function TrackerIcon({ color, icon }: { color: string; icon: string }) {
  return (
    <div
      className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
      style={{ background: `${color}20` }}
    >
      <MaterialSymbol icon={icon} size={16} style={{ color }} fill />
    </div>
  );
}

function getSyncMetaText(mode: TrackerSyncMode): string {
  switch (mode) {
    case 'shared': return 'Visible to all team members';
    case 'local': return 'Only visible to you';
    case 'hybrid': return 'Per-item sharing choice';
  }
}

// ============================================================================
// Issue Key Prefix Input
// ============================================================================

function IssueKeyPrefixInput({ value, onChange }: {
  value: string;
  onChange: (prefix: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState('');

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const handleBlur = useCallback(() => {
    const upper = draft.toUpperCase();
    if (!ISSUE_KEY_PREFIX_REGEX.test(upper)) {
      setError('Must be 2-5 uppercase letters');
      return;
    }
    setError('');
    if (upper !== value) {
      onChange(upper);
    }
  }, [draft, value, onChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur();
    }
  }, []);

  return (
    <div className="provider-panel-section py-4 mb-4 border-b border-[var(--nim-border)] last:border-b-0 last:mb-0 last:pb-0">
      <h4 className="provider-panel-section-title text-[15px] font-semibold mb-2 text-[var(--nim-text)]">
        Issue Key Prefix
      </h4>
      <p className="text-[13px] leading-relaxed text-[var(--nim-text-muted)] mb-3">
        New tracker items will use this prefix (e.g., <code className="text-[11px] text-[var(--nim-code-text)] bg-[var(--nim-code-bg)] px-1 py-[1px] rounded">{draft || 'NIM'}-42</code>).
      </p>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value.toUpperCase());
            setError('');
          }}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          maxLength={5}
          placeholder="NIM"
          className="w-24 px-2.5 py-1.5 text-[13px] font-mono bg-[var(--nim-bg)] border border-[var(--nim-border)] rounded-md text-[var(--nim-text)] outline-none focus:border-[var(--nim-primary)] transition-colors"
        />
        <span className="text-[13px] text-[var(--nim-text-faint)]">-123</span>
      </div>
      {error && (
        <p className="text-[11px] text-[var(--nim-error)] mt-1.5">{error}</p>
      )}
      <p className="text-[11px] text-[var(--nim-text-faint)] mt-2">
        Changing the prefix only affects new items. Existing items keep their current keys.
      </p>
    </div>
  );
}

// ============================================================================
// Folder Manager
// ============================================================================

function FolderManager({
  trackers,
  workspacePath,
  onRefresh,
}: {
  trackers: TrackerDataModel[];
  workspacePath?: string;
  onRefresh?: () => void;
}) {
  const [layout, setLayout] = useState<TrackerSidebarLayout>({ entries: [] });
  const [newFolderError, setNewFolderError] = useState('');

  const reload = useCallback(async () => {
    if (!workspacePath) return;
    let saved = await loadLayout(workspacePath);
    if (saved.entries.length === 0) {
      const legacy = await loadLegacyState(workspacePath);
      saved = buildLayoutFromLegacy(trackers, legacy.folders, legacy.overrides);
    }
    const reconciled = reconcileLayout(saved, trackers);
    setLayout(reconciled);
  }, [workspacePath, trackers]);

  useEffect(() => {
    reload();
    const unsubscribe = globalRegistry.onChange(reload);
    return () => { unsubscribe(); };
  }, [reload]);

  const persist = useCallback(async (next: TrackerSidebarLayout) => {
    if (!workspacePath) return;
    setLayout(next);
    await saveLayout(workspacePath, next);
    onRefresh?.();
  }, [workspacePath, onRefresh]);

  const handleAddFolder = useCallback(async () => {
    const name = 'New Folder';
    if (layout.entries.some((e) => e.kind === 'folder' && e.name === name)) {
      setNewFolderError('A folder named "New Folder" already exists. Rename it first.');
      return;
    }
    setNewFolderError('');
    await persist(addFolder(layout, name));
  }, [layout, persist]);

  const handleRenameFolder = useCallback(async (oldName: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) return;
    await persist(renameFolder(layout, oldName, trimmed));
  }, [layout, persist]);

  const handleDeleteFolder = useCallback(async (folderName: string) => {
    await persist(deleteFolder(layout, folderName));
  }, [layout, persist]);

  const handleReorder = useCallback(async (folderName: string, direction: 'up' | 'down') => {
    const folderIndices = layout.entries
      .map((e, i) => (e.kind === 'folder' ? i : -1))
      .filter((i) => i >= 0);
    const folderEntryIdx = layout.entries.findIndex(
      (e) => e.kind === 'folder' && e.name === folderName
    );
    if (folderEntryIdx < 0) return;
    const posInFolders = folderIndices.indexOf(folderEntryIdx);
    const swapPos = direction === 'up' ? posInFolders - 1 : posInFolders + 1;
    if (swapPos < 0 || swapPos >= folderIndices.length) return;
    const swapEntryIdx = folderIndices[swapPos];
    const drop: import('../../../services/TrackerSidebarLayout').DropLocation = {
      position: direction === 'up' ? 'before' : 'after',
      target: [swapEntryIdx],
    };
    const drag: import('../../../services/TrackerSidebarLayout').DragLocation = {
      kind: 'folder',
      id: folderName,
    };
    await persist(moveEntry(layout, drag, drop));
  }, [layout, persist]);

  const handleAssignFolder = useCallback(async (typeId: string, folderName: string | null) => {
    await persist(assignTypeToFolder(layout, typeId, folderName));
  }, [layout, persist]);

  const folderEntries = layout.entries.filter(
    (e): e is Extract<typeof e, { kind: 'folder' }> => e.kind === 'folder'
  );
  const folderNames = folderEntries.map((f) => f.name);

  const getEffectiveFolder = (model: TrackerDataModel): string | null => {
    for (const entry of layout.entries) {
      if (entry.kind === 'folder' && entry.types.includes(model.type)) {
        return entry.name;
      }
    }
    return null;
  };

  return (
    <div className="provider-panel-section py-4 mb-4 border-b border-[var(--nim-border)] last:border-b-0 last:mb-0 last:pb-0">
      <h4 className="provider-panel-section-title text-[15px] font-semibold mb-2 text-[var(--nim-text)]">
        Tracker Folders
      </h4>
      <p className="text-[13px] leading-relaxed text-[var(--nim-text-muted)] mb-3">
        Group tracker types into collapsible folders in the sidebar. Folders are per-workspace and do not affect your data.
      </p>

      {/* Folder list */}
      {folderEntries.length > 0 && (
        <div className="bg-[var(--nim-bg-secondary)] rounded-lg overflow-hidden mb-3">
          {folderEntries.map((folder, idx) => (
            <FolderRow
              key={folder.name}
              folderName={folder.name}
              isFirst={idx === 0}
              isLast={idx === folderEntries.length - 1}
              onRename={(newName) => handleRenameFolder(folder.name, newName)}
              onDelete={() => handleDeleteFolder(folder.name)}
              onMoveUp={() => handleReorder(folder.name, 'up')}
              onMoveDown={() => handleReorder(folder.name, 'down')}
            />
          ))}
        </div>
      )}

      <button
        onClick={handleAddFolder}
        className="inline-flex items-center gap-1 px-2.5 py-1 bg-transparent border border-[var(--nim-border)] rounded text-[var(--nim-text-muted)] text-[11px] cursor-pointer hover:bg-[var(--nim-bg-hover)] mb-3"
      >
        <MaterialSymbol icon="create_new_folder" size={12} />
        Add Folder
      </button>
      {newFolderError && (
        <p className="text-[11px] text-[#ef4444] mb-3">{newFolderError}</p>
      )}

      {/* Per-type folder assignment */}
      {trackers.length > 0 && (
        <>
          <h5 className="text-[12px] font-semibold text-[var(--nim-text-muted)] uppercase tracking-wide mb-2">
            Assign Types to Folders
          </h5>
          <div className="bg-[var(--nim-bg-secondary)] rounded-lg overflow-hidden">
            {trackers.map((model) => {
              const currentFolder = getEffectiveFolder(model);
              return (
                <div
                  key={model.type}
                  className="flex items-center gap-2.5 px-3.5 py-2 border-b border-[var(--nim-bg)] last:border-b-0"
                >
                  <TrackerIcon color={model.color} icon={model.icon} />
                  <span className="flex-1 text-[13px] text-[var(--nim-text)] truncate">
                    {model.displayNamePlural}
                  </span>
                  <select
                    value={currentFolder ?? ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      handleAssignFolder(model.type, val === '' ? null : val);
                    }}
                    className="px-2 py-1 text-[12px] bg-[var(--nim-bg)] border border-[var(--nim-border)] rounded text-[var(--nim-text)] outline-none focus:border-[var(--nim-primary)] cursor-pointer"
                  >
                    <option value="">(no folder)</option>
                    {folderNames.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function FolderRow({
  folderName,
  isFirst,
  isLast,
  onRename,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  folderName: string;
  isFirst: boolean;
  isLast: boolean;
  onRename: (name: string) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const [draft, setDraft] = useState(folderName);

  useEffect(() => {
    setDraft(folderName);
  }, [folderName]);

  const handleBlur = () => {
    onRename(draft);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
    if (e.key === 'Escape') {
      setDraft(folderName);
      (e.target as HTMLInputElement).blur();
    }
  };

  return (
    <div className="flex items-center gap-2 px-3.5 py-2 border-b border-[var(--nim-bg)] last:border-b-0">
      <MaterialSymbol icon="folder" size={14} className="text-[var(--nim-text-faint)] shrink-0" />
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        className="flex-1 px-1.5 py-0.5 text-[13px] bg-[var(--nim-bg)] border border-transparent rounded focus:border-[var(--nim-border)] text-[var(--nim-text)] outline-none transition-colors"
      />
      <div className="flex items-center gap-0.5 shrink-0">
        <button
          onClick={onMoveUp}
          disabled={isFirst}
          title="Move up"
          className="p-1 rounded text-[var(--nim-text-faint)] hover:text-[var(--nim-text-muted)] hover:bg-[var(--nim-bg-tertiary)] cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <MaterialSymbol icon="arrow_upward" size={12} />
        </button>
        <button
          onClick={onMoveDown}
          disabled={isLast}
          title="Move down"
          className="p-1 rounded text-[var(--nim-text-faint)] hover:text-[var(--nim-text-muted)] hover:bg-[var(--nim-bg-tertiary)] cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <MaterialSymbol icon="arrow_downward" size={12} />
        </button>
        <button
          onClick={onDelete}
          title="Delete folder"
          className="p-1 rounded text-[var(--nim-text-faint)] hover:text-[#ef4444] hover:bg-[var(--nim-bg-tertiary)] cursor-pointer transition-colors"
        >
          <MaterialSymbol icon="delete" size={12} />
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Admin View
// ============================================================================

function AdminView({ trackers, onSyncModeChange, workspacePath, onAddCustomTracker }: {
  trackers: TrackerTypeConfig[];
  onSyncModeChange: (type: string, mode: TrackerSyncMode) => void;
  workspacePath?: string;
  onAddCustomTracker: () => void;
}) {
  const models = trackers.map((t) => t.model);

  return (
    <>
      {/* Team Sync Policy Section */}
      <div className="provider-panel-section py-4 mb-4 border-b border-[var(--nim-border)] last:border-b-0 last:mb-0 last:pb-0">
        <h4 className="provider-panel-section-title text-[15px] font-semibold mb-2 text-[var(--nim-text)] flex items-center gap-2">
          Team Sync Policy
          <span className="px-[7px] py-[2px] rounded-[10px] text-[10px] font-semibold bg-[rgba(96,165,250,0.15)] text-[var(--nim-primary)]">
            Admin
          </span>
        </h4>
        <p className="text-[13px] leading-relaxed text-[var(--nim-text-muted)] mb-3">
          Control how each tracker type syncs with the team. Changes apply to all members.
        </p>

        {/* Info Banner */}
        <div className="flex items-start gap-2.5 p-3 bg-[rgba(96,165,250,0.08)] border border-[rgba(96,165,250,0.2)] rounded-lg mb-3">
          <MaterialSymbol icon="info" size={14} className="text-[var(--nim-primary)] shrink-0 mt-0.5" />
          <div className="text-[12px] text-[var(--nim-text-muted)] leading-relaxed">
            <strong className="text-[var(--nim-primary)] font-semibold">Shared</strong> items sync to all team members in real time.{' '}
            <strong className="text-[var(--nim-text-muted)] font-semibold">Local</strong> items stay on your machine only.{' '}
            <strong className="text-[#a78bfa] font-semibold">Hybrid</strong> lets each item be shared or local individually.
          </div>
        </div>

        {/* Tracker Type List */}
        <div className="bg-[var(--nim-bg-secondary)] rounded-lg overflow-hidden">
          {trackers.map((tracker) => (
            <div
              key={tracker.model.type}
              className="flex items-center gap-2.5 px-3.5 py-2.5 border-b border-[var(--nim-bg)] last:border-b-0"
            >
              <TrackerIcon color={tracker.model.color} icon={tracker.model.icon} />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-[var(--nim-text)] flex items-center gap-1.5">
                  {tracker.model.displayNamePlural}
                  <span className="px-1.5 py-[1px] rounded bg-[var(--nim-bg-tertiary)] text-[var(--nim-text-muted)] text-[10px] font-semibold">
                    <TrackerTypeCount type={tracker.model.type} />
                  </span>
                </div>
                <div className="text-[11px] text-[var(--nim-text-faint)]">
                  {getSyncMetaText(tracker.syncMode)}
                </div>
              </div>
              <div className="shrink-0 flex items-center gap-1">
                <SyncModeToggle
                  mode={tracker.syncMode}
                  onChange={(mode) => onSyncModeChange(tracker.model.type, mode)}
                />
                {!globalRegistry.isBuiltin(tracker.model.type) && (
                  <DeleteTrackerTypeButton model={tracker.model} workspacePath={workspacePath} />
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-3">
          <button
            onClick={onAddCustomTracker}
            className="inline-flex items-center gap-1 px-2.5 py-1 bg-transparent border border-[var(--nim-border)] rounded text-[var(--nim-text-muted)] text-[11px] cursor-pointer hover:bg-[var(--nim-bg-hover)]"
          >
            <MaterialSymbol icon="add" size={12} />
            Add Custom Tracker
          </button>
        </div>
      </div>

      {/* Inline Note */}
      <div className="provider-panel-section py-4 mb-4 border-b border-[var(--nim-border)] last:border-b-0 last:mb-0 last:pb-0">
        <div className="flex items-start gap-1.5 p-2.5 bg-[var(--nim-bg-secondary)] rounded-md text-[11px] text-[var(--nim-text-faint)] leading-relaxed">
          <MaterialSymbol icon="info" size={14} className="shrink-0 mt-0.5" />
          <span>
            Inline trackers (<code className="text-[11px] text-[var(--nim-code-text)] bg-[var(--nim-code-bg)] px-1 py-[1px] rounded">#bug[...]</code>) are always local, regardless of sync policy. Only tracked items created from the panel participate in sync.
          </span>
        </div>
      </div>

      {/* Promote Banner */}
      <div className="provider-panel-section py-4 mb-4 border-b border-[var(--nim-border)] last:border-b-0 last:mb-0 last:pb-0">
        <div className="flex items-center gap-2 p-3 bg-[rgba(167,139,250,0.08)] border border-[rgba(167,139,250,0.15)] rounded-lg">
          <MaterialSymbol icon="arrow_upward" size={16} className="text-[#a78bfa] shrink-0" />
          <div className="flex-1 text-[12px] text-[var(--nim-text-muted)] leading-snug">
            <strong className="text-[#a78bfa]">Promote inline items</strong> to tracked items to share them with the team. Right-click any inline tracker and select "Promote to Tracked Item."
          </div>
        </div>
      </div>

      <FolderManager trackers={models} workspacePath={workspacePath} />
    </>
  );
}

// ============================================================================
// Member View
// ============================================================================

function MemberView({ trackers, workspacePath, onAddCustomTracker }: { trackers: TrackerTypeConfig[]; workspacePath?: string; onAddCustomTracker: () => void }) {
  const sharedTrackers = trackers.filter((t) => t.syncMode !== 'local');
  const localTrackers = trackers.filter((t) => t.syncMode === 'local');
  const models = trackers.map((t) => t.model);

  return (
    <>
      {/* Team Trackers (read-only) */}
      <div className="provider-panel-section py-4 mb-4 border-b border-[var(--nim-border)] last:border-b-0 last:mb-0 last:pb-0">
        <h4 className="provider-panel-section-title text-[15px] font-semibold mb-2 text-[var(--nim-text)] flex items-center gap-2">
          Team Trackers
          <span className="text-[11px] font-normal text-[var(--nim-text-faint)]">Managed by admin</span>
        </h4>
        <p className="text-[13px] leading-relaxed text-[var(--nim-text-muted)] mb-3">
          These tracker types are configured by your team admin. Shared items sync in real time.
        </p>

        <div className="bg-[var(--nim-bg-secondary)] rounded-lg overflow-hidden">
          {sharedTrackers.map((tracker) => (
            <div
              key={tracker.model.type}
              className="flex items-center gap-2.5 px-3.5 py-2.5 border-b border-[var(--nim-bg)] last:border-b-0"
            >
              <TrackerIcon color={tracker.model.color} icon={tracker.model.icon} />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-[var(--nim-text)]">
                  {tracker.model.displayNamePlural}
                </div>
                <div className="text-[11px] text-[var(--nim-text-faint)]">
                  <TrackerTypeCount type={tracker.model.type} /> items synced with team
                </div>
              </div>
              <div className="shrink-0">
                <SyncBadge mode={tracker.syncMode} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Local Trackers */}
      <div className="provider-panel-section py-4 mb-4 border-b border-[var(--nim-border)] last:border-b-0 last:mb-0 last:pb-0">
        <h4 className="provider-panel-section-title text-[15px] font-semibold mb-2 text-[var(--nim-text)] flex items-center gap-2">
          Your Local Trackers
          <span className="text-[11px] font-normal text-[var(--nim-text-faint)]">Only on this machine</span>
        </h4>
        <p className="text-[13px] leading-relaxed text-[var(--nim-text-muted)] mb-3">
          These tracker types are local to your workspace. They never sync and are not visible to your team.
        </p>

        {localTrackers.length > 0 ? (
          <div className="bg-[var(--nim-bg-secondary)] rounded-lg overflow-hidden">
            {localTrackers.map((tracker) => (
              <div
                key={tracker.model.type}
                className="flex items-center gap-2.5 px-3.5 py-2.5 border-b border-[var(--nim-bg)] last:border-b-0"
              >
                <TrackerIcon color={tracker.model.color} icon={tracker.model.icon} />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium text-[var(--nim-text)]">
                    {tracker.model.displayNamePlural}
                  </div>
                  <div className="text-[11px] text-[var(--nim-text-faint)]">
                    <TrackerTypeCount type={tracker.model.type} /> items, local only
                  </div>
                </div>
                <div className="shrink-0 flex items-center gap-1">
                  <SyncBadge mode="local" />
                  {!globalRegistry.isBuiltin(tracker.model.type) && (
                    <DeleteTrackerTypeButton model={tracker.model} workspacePath={workspacePath} />
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-[var(--nim-bg-secondary)] rounded-lg px-3.5 py-3 text-[12px] text-[var(--nim-text-faint)] italic">
            No local tracker types yet.
          </div>
        )}

        <div className="mt-3">
          <button
            onClick={onAddCustomTracker}
            className="inline-flex items-center gap-1 px-2.5 py-1 bg-transparent border border-[var(--nim-border)] rounded text-[var(--nim-text-muted)] text-[11px] cursor-pointer hover:bg-[var(--nim-bg-hover)]"
          >
            <MaterialSymbol icon="add" size={12} />
            Add Custom Tracker
          </button>
        </div>
      </div>

      {/* Inline Note */}
      <div className="provider-panel-section py-4 mb-4 border-b border-[var(--nim-border)] last:border-b-0 last:mb-0 last:pb-0">
        <div className="flex items-start gap-1.5 p-2.5 bg-[var(--nim-bg-secondary)] rounded-md text-[11px] text-[var(--nim-text-faint)] leading-relaxed">
          <MaterialSymbol icon="info" size={14} className="shrink-0 mt-0.5" />
          <span>
            Inline trackers (<code className="text-[11px] text-[var(--nim-code-text)] bg-[var(--nim-code-bg)] px-1 py-[1px] rounded">#bug[...]</code>) in your documents are always local. Promote them to tracked items to share with the team.
          </span>
        </div>
      </div>

      <FolderManager trackers={models} workspacePath={workspacePath} />
    </>
  );
}

// ============================================================================
// TrackerConfigPanel
// ============================================================================

export function TrackerConfigPanel({ workspacePath }: TrackerConfigPanelProps) {
  const [trackers, setTrackers] = useState<TrackerTypeConfig[]>([]);
  const [isAdmin, setIsAdmin] = useState(true);
  const [issueKeyPrefix, setIssueKeyPrefix] = useState('NIM');
  const [isSyncConnected, setIsSyncConnected] = useState(false);
  const [showCreator, setShowCreator] = useState(false);

  useEffect(() => {
    // Load saved sync policies from workspace state, then merge with registry
    const loadPolicies = async () => {
      let savedPolicies: Record<string, TrackerSyncMode> = {};
      if (workspacePath) {
        try {
          const state = await (window as any).electronAPI.invoke('workspace:get-state', workspacePath);
          savedPolicies = state?.trackerSyncPolicies ?? {};
          if (state?.issueKeyPrefix) {
            setIssueKeyPrefix(state.issueKeyPrefix);
          }
        } catch {
          // Workspace state not available
        }

        // Check team role (per-workspace lookup)
        try {
          const teamResult = await (window as any).electronAPI.team.findForWorkspace(workspacePath);
          if (teamResult.success && teamResult.team) {
            setIsAdmin(teamResult.team.role === 'admin');
          }
        } catch {
          // No team or error
        }

        // Check if tracker sync is connected (for determining where to save prefix)
        try {
          const syncStatus = await (window as any).electronAPI.invoke('tracker-sync:get-status', { workspacePath });
          setIsSyncConnected(syncStatus?.active ?? false);
        } catch {
          // Not connected
        }
      }

      const models = globalRegistry.getAll();
      const configs: TrackerTypeConfig[] = models.map((model) => ({
        model,
        syncMode: savedPolicies[model.type] ?? model.sync?.mode ?? 'local',
      }));
      setTrackers(configs);
    };

    loadPolicies();

    // Listen for config changes from sync
    const handleConfigChanged = (_event: any, data: { workspacePath: string; config: { issueKeyPrefix: string } }) => {
      if (data.workspacePath === workspacePath && data.config.issueKeyPrefix) {
        setIssueKeyPrefix(data.config.issueKeyPrefix);
      }
    };
    (window as any).electronAPI?.on?.('tracker-sync:config-changed', handleConfigChanged);

    // Subscribe to registry changes (e.g., custom trackers loaded later)
    const unsubscribe = globalRegistry.onChange(() => {
      const updatedModels = globalRegistry.getAll();
      setTrackers((prev) => {
        const existingModes = new Map(prev.map((t) => [t.model.type, t.syncMode]));
        return updatedModels.map((model) => ({
          model,
          syncMode: existingModes.get(model.type) ?? model.sync?.mode ?? 'local',
        }));
      });
    });

    return () => {
      unsubscribe();
      (window as any).electronAPI?.off?.('tracker-sync:config-changed', handleConfigChanged);
    };
  }, [workspacePath]);

  const handlePrefixChange = useCallback((prefix: string) => {
    setIssueKeyPrefix(prefix);
    if (workspacePath) {
      // Always persist to workspace settings (used for local-only trackers)
      (window as any).electronAPI.invoke('workspace:update-state', workspacePath, {
        issueKeyPrefix: prefix,
      });
      // If sync is connected, also send to server
      if (isSyncConnected) {
        (window as any).electronAPI.invoke('tracker-sync:set-config', {
          workspacePath,
          key: 'issueKeyPrefix',
          value: prefix,
        });
      }
    }
  }, [workspacePath, isSyncConnected]);

  const handleSyncModeChange = (type: string, mode: TrackerSyncMode) => {
    setTrackers((prev) =>
      prev.map((t) =>
        t.model.type === type ? { ...t, syncMode: mode } : t
      )
    );

    // Persist to workspace state
    if (workspacePath) {
      (window as any).electronAPI.invoke('workspace:update-state', workspacePath, {
        trackerSyncPolicies: { [type]: mode },
      });
    }
  };

  return (
    <div className="provider-panel flex flex-col">
      {/* Header */}
      <div className="provider-panel-header mb-5 pb-4 border-b border-[var(--nim-border)]">
        <h3 className="provider-panel-title text-xl font-semibold leading-tight mb-1.5 text-[var(--nim-text)] flex items-center gap-2">
          Trackers
          <AlphaBadge size="sm" />
        </h3>
        <p className="provider-panel-description text-[13px] leading-relaxed text-[var(--nim-text-muted)]">
          {isAdmin
            ? 'Configure which tracker types are shared with the team and manage local-only trackers.'
            : 'View team-shared tracker types and manage your local trackers.'}
        </p>
      </div>

      <IssueKeyPrefixInput
        value={issueKeyPrefix}
        onChange={handlePrefixChange}
      />

      {isAdmin ? (
        <AdminView
          trackers={trackers}
          onSyncModeChange={handleSyncModeChange}
          workspacePath={workspacePath}
          onAddCustomTracker={() => setShowCreator(true)}
        />
      ) : (
        <MemberView
          trackers={trackers}
          workspacePath={workspacePath}
          onAddCustomTracker={() => setShowCreator(true)}
        />
      )}

      {showCreator && workspacePath && (
        <TrackerTypeCreator
          workspacePath={workspacePath}
          onClose={() => setShowCreator(false)}
          onCreated={() => setShowCreator(false)}
        />
      )}
    </div>
  );
}
