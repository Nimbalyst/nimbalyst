import React, { useCallback, useEffect, useState, useMemo, useRef } from 'react';

// Access the generic Electron IPC invoke
const ipc = (window as unknown as {
  electronAPI: {
    invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
  };
}).electronAPI;

interface WorkingFile {
  path: string;
  status: string; // M, A, D, ?
}

interface WorkingChangesResult {
  staged: Array<{ path: string; status: string }>;
  unstaged: Array<{ path: string; status: string }>;
  untracked: Array<{ path: string }>;
  conflicted: Array<{ path: string }>;
}

interface ChangesTabProps {
  workspacePath: string;
  /** Callback to wrap operations with logging */
  withLog: <T>(
    command: string,
    operation: () => Promise<T>,
    opts?: {
      formatOutput?: (result: T) => string | undefined;
      isError?: (result: T) => boolean;
      getError?: (result: T) => string | undefined;
      formatSuggestion?: (result: T) => string | undefined;
    }
  ) => Promise<T>;
  onWorkspaceEvent: (event: string, handler: () => void) => (() => void);
  /** Switch to the Output tab to show operation details */
  onShowOutput: () => void;
}

interface SuccessResult {
  success: boolean;
  error?: string;
  commitHash?: string;
}

const statusLabels: Record<string, string> = {
  M: 'Modified',
  A: 'Added',
  D: 'Deleted',
  '?': 'Untracked',
};

function StatusBadge({ status }: { status: string }) {
  const className =
    status === 'A' ? 'git-changes-badge--added' :
    status === 'D' ? 'git-changes-badge--deleted' :
    status === 'M' ? 'git-changes-badge--modified' :
    'git-changes-badge--untracked';

  return (
    <span className={`git-changes-badge ${className}`} title={statusLabels[status] ?? status}>
      {status}
    </span>
  );
}

// --- Directory tree with path collapsing (matches FileEditsSidebar / CommitDetailContent) ---

interface DirNode {
  path: string;
  displayPath: string;
  files: WorkingFile[];
  subdirectories: Map<string, DirNode>;
}

function buildDirTree(files: WorkingFile[]): DirNode {
  const root: DirNode = { path: '', displayPath: '', files: [], subdirectories: new Map() };
  for (const file of files) {
    const parts = file.path.split('/');
    if (parts.length === 1) { root.files.push(file); continue; }
    let current = root;
    parts.slice(0, -1).forEach((part, index) => {
      const pathSoFar = parts.slice(0, index + 1).join('/');
      if (!current.subdirectories.has(part)) {
        current.subdirectories.set(part, { path: pathSoFar, displayPath: part, files: [], subdirectories: new Map() });
      }
      current = current.subdirectories.get(part)!;
    });
    current.files.push(file);
  }
  return collapseDirTree(root);
}

function collapseDirTree(node: DirNode): DirNode {
  node.subdirectories.forEach((subdir, key) => {
    node.subdirectories.set(key, collapseDirTree(subdir));
  });
  if (node.subdirectories.size === 1 && node.files.length === 0) {
    const [, child] = Array.from(node.subdirectories.entries())[0];
    return { ...child, displayPath: node.displayPath ? `${node.displayPath}/${child.displayPath}` : child.displayPath };
  }
  return node;
}

function FileActions({
  file,
  group,
  onStage,
  onUnstage,
  onDiscard,
  loading,
}: {
  file: WorkingFile;
  group: 'staged' | 'unstaged' | 'untracked' | 'conflicted';
  onStage: (path: string) => void;
  onUnstage: (path: string) => void;
  onDiscard: (path: string) => void;
  loading: boolean;
}) {
  if (group === 'conflicted') {
    return <span className="git-changes-conflict-label">Resolve in editor</span>;
  }
  if (group === 'staged') {
    return (
      <button className="git-changes-action-btn" onClick={() => onUnstage(file.path)} disabled={loading} title="Unstage">
        &minus;
      </button>
    );
  }
  return (
    <>
      <button className="git-changes-action-btn" onClick={() => onStage(file.path)} disabled={loading} title="Stage">
        +
      </button>
      {group === 'unstaged' && (
        <button className="git-changes-action-btn git-changes-action-btn--danger" onClick={() => onDiscard(file.path)} disabled={loading} title="Discard changes">
          &#10005;
        </button>
      )}
    </>
  );
}

function renderFileTree(
  node: DirNode,
  depth: number,
  group: 'staged' | 'unstaged' | 'untracked' | 'conflicted',
  handlers: {
    onStage: (path: string) => void;
    onUnstage: (path: string) => void;
    onDiscard: (path: string) => void;
    loading: boolean;
  },
): React.ReactNode {
  const subdirs = Array.from(node.subdirectories.values()).sort((a, b) => a.displayPath.localeCompare(b.displayPath));
  const sortedFiles = [...node.files].sort((a, b) => a.path.localeCompare(b.path));
  const childDepth = node.displayPath ? depth + 1 : depth;
  return (
    <>
      {node.displayPath && (
        <div className="git-changes-dir-row" style={{ paddingLeft: depth * 12 + 8 }}>
          <span className="git-changes-dir-name">{node.displayPath}/</span>
        </div>
      )}
      {subdirs.map(sub => (
        <React.Fragment key={sub.path}>{renderFileTree(sub, childDepth, group, handlers)}</React.Fragment>
      ))}
      {sortedFiles.map(file => {
        const name = file.path.split('/').pop() ?? file.path;
        return (
          <div
            key={file.path}
            className={`git-changes-file-row${group === 'conflicted' ? ' git-changes-file-row--conflict' : ''}`}
            style={{ paddingLeft: childDepth * 12 + 8 }}
          >
            <StatusBadge status={file.status} />
            <span className="git-changes-file-name">{name}</span>
            <span className="git-changes-file-actions">
              <FileActions file={file} group={group} {...handlers} />
            </span>
          </div>
        );
      })}
    </>
  );
}

export function ChangesTab({ workspacePath, withLog, onWorkspaceEvent, onShowOutput }: ChangesTabProps) {
  const [staged, setStaged] = useState<WorkingFile[]>([]);
  const [unstaged, setUnstaged] = useState<WorkingFile[]>([]);
  const [untracked, setUntracked] = useState<WorkingFile[]>([]);
  const [conflicted, setConflicted] = useState<WorkingFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [operationLoading, setOperationLoading] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [commitDescription, setCommitDescription] = useState('');
  const [isCommitting, setIsCommitting] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [statusMessage, setStatusMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);

  const loadChanges = useCallback(async () => {
    try {
      const result = await ipc.invoke('git:working-changes', workspacePath) as WorkingChangesResult;
      setStaged(result.staged.map(f => ({ path: f.path, status: f.status })));
      setUnstaged(result.unstaged.map(f => ({ path: f.path, status: f.status })));
      setUntracked(result.untracked.map(f => ({ path: f.path, status: '?' })));
      setConflicted(result.conflicted.map(f => ({ path: f.path, status: 'C' })));
      setLoadError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[ChangesTab] Failed to load changes:', message);
      setLoadError(message);
    } finally {
      setLoading(false);
    }
  }, [workspacePath]);

  useEffect(() => {
    loadChanges();
  }, [loadChanges]);

  // Auto-refresh when git status changes
  useEffect(() => {
    return onWorkspaceEvent('git:status-changed', () => {
      loadChanges();
    });
  }, [onWorkspaceEvent, loadChanges]);

  const showStatus = useCallback((text: string, isError = false) => {
    setStatusMessage({ text, isError });
    if (!isError) {
      setTimeout(() => setStatusMessage(null), 3000);
    }
  }, []);

  const handleStage = useCallback(async (filePath: string) => {
    setOperationLoading(true);
    try {
      const result = await withLog(
        `git add ${filePath}`,
        () => ipc.invoke('git:stage', workspacePath, [filePath]) as Promise<SuccessResult>,
        { isError: (r) => !r.success, getError: (r) => r.error }
      );
      if (!result.success) {
        showStatus(result.error || 'Failed to stage file', true);
      }
      await loadChanges();
    } catch (err) {
      showStatus(err instanceof Error ? err.message : 'Stage failed', true);
    } finally {
      setOperationLoading(false);
    }
  }, [workspacePath, loadChanges, showStatus, withLog]);

  const handleUnstage = useCallback(async (filePath: string) => {
    setOperationLoading(true);
    try {
      const result = await withLog(
        `git reset HEAD -- ${filePath}`,
        () => ipc.invoke('git:unstage', workspacePath, [filePath]) as Promise<SuccessResult>,
        { isError: (r) => !r.success, getError: (r) => r.error }
      );
      if (!result.success) {
        showStatus(result.error || 'Failed to unstage file', true);
      }
      await loadChanges();
    } catch (err) {
      showStatus(err instanceof Error ? err.message : 'Unstage failed', true);
    } finally {
      setOperationLoading(false);
    }
  }, [workspacePath, loadChanges, showStatus, withLog]);

  const handleStageAll = useCallback(async (files: WorkingFile[]) => {
    setOperationLoading(true);
    try {
      const paths = files.map(f => f.path);
      const result = await withLog(
        `git add ${paths.length} file${paths.length !== 1 ? 's' : ''}`,
        () => ipc.invoke('git:stage', workspacePath, paths) as Promise<SuccessResult>,
        { isError: (r) => !r.success, getError: (r) => r.error }
      );
      if (!result.success) {
        showStatus(result.error || 'Failed to stage files', true);
      }
      await loadChanges();
    } catch (err) {
      showStatus(err instanceof Error ? err.message : 'Stage all failed', true);
    } finally {
      setOperationLoading(false);
    }
  }, [workspacePath, loadChanges, showStatus, withLog]);

  const handleUnstageAll = useCallback(async () => {
    setOperationLoading(true);
    try {
      const paths = staged.map(f => f.path);
      const result = await withLog(
        `git reset HEAD -- ${paths.length} file${paths.length !== 1 ? 's' : ''}`,
        () => ipc.invoke('git:unstage', workspacePath, paths) as Promise<SuccessResult>,
        { isError: (r) => !r.success, getError: (r) => r.error }
      );
      if (!result.success) {
        showStatus(result.error || 'Failed to unstage files', true);
      }
      await loadChanges();
    } catch (err) {
      showStatus(err instanceof Error ? err.message : 'Unstage all failed', true);
    } finally {
      setOperationLoading(false);
    }
  }, [workspacePath, staged, loadChanges, showStatus, withLog]);

  const handleDiscard = useCallback(async (filePath: string) => {
    // Confirmation via window.confirm for now (extension can't use host dialogs easily)
    if (!window.confirm(`Discard all changes to ${filePath}? This cannot be undone.`)) {
      return;
    }
    setOperationLoading(true);
    try {
      const result = await withLog(
        `git checkout -- ${filePath}`,
        () => ipc.invoke('git:discard-changes', workspacePath, [filePath]) as Promise<SuccessResult>,
        { isError: (r) => !r.success, getError: (r) => r.error }
      );
      if (!result.success) {
        showStatus(result.error || 'Failed to discard changes', true);
      }
      await loadChanges();
    } catch (err) {
      showStatus(err instanceof Error ? err.message : 'Discard failed', true);
    } finally {
      setOperationLoading(false);
    }
  }, [workspacePath, loadChanges, showStatus, withLog]);

  const handleCommit = useCallback(async () => {
    const fullMessage = commitDescription
      ? `${commitMessage}\n\n${commitDescription}`
      : commitMessage;

    if (!fullMessage.trim()) {
      showStatus('Commit message is required', true);
      messageRef.current?.focus();
      return;
    }

    if (staged.length === 0) {
      showStatus('No files staged for commit', true);
      return;
    }

    setIsCommitting(true);
    try {
      // Pass empty filesToStage to use the "index-as-is" commit path.
      // The user has already staged files via git:stage, so we commit
      // exactly what's in the index without resetting/restaging.
      const result = await withLog(
        `git commit -m "${commitMessage}"`,
        () => ipc.invoke('git:commit', workspacePath, fullMessage, []) as Promise<SuccessResult>,
        {
          isError: (r) => !r.success,
          getError: (r) => r.error,
          formatOutput: (r) => r.commitHash ? `Committed: ${r.commitHash}` : undefined,
        }
      );

      if (result.success) {
        setCommitMessage('');
        setCommitDescription('');
        showStatus(`Committed ${staged.length} file${staged.length !== 1 ? 's' : ''}`);
      } else {
        showStatus(result.error || 'Commit failed', true);
      }
      await loadChanges();
    } catch (err) {
      showStatus(err instanceof Error ? err.message : 'Commit failed', true);
    } finally {
      setIsCommitting(false);
    }
  }, [workspacePath, commitMessage, commitDescription, staged, loadChanges, showStatus, withLog]);

  const toggleGroup = useCallback((group: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(group)) {
        next.delete(group);
      } else {
        next.add(group);
      }
      return next;
    });
  }, []);

  const totalChanges = staged.length + unstaged.length + untracked.length + conflicted.length;
  const isAnyLoading = operationLoading || isCommitting;

  // Build collapsed directory trees for each group
  const stagedTree = useMemo(() => buildDirTree(staged), [staged]);
  const unstagedTree = useMemo(() => buildDirTree(unstaged), [unstaged]);
  const untrackedTree = useMemo(() => buildDirTree(untracked), [untracked]);
  const conflictedTree = useMemo(() => buildDirTree(conflicted), [conflicted]);

  const fileHandlers = useMemo(() => ({
    onStage: handleStage,
    onUnstage: handleUnstage,
    onDiscard: handleDiscard,
    loading: isAnyLoading,
  }), [handleStage, handleUnstage, handleDiscard, isAnyLoading]);

  if (loading) {
    return <div className="git-log-empty">Loading changes...</div>;
  }

  if (loadError) {
    return (
      <div className="git-changes-empty">
        <span className="git-changes-error-title">Failed to load changes</span>
        <span className="git-changes-empty-hint">{loadError}</span>
        <button className="git-changes-retry-btn" onClick={loadChanges}>
          Retry
        </button>
      </div>
    );
  }

  if (totalChanges === 0) {
    return (
      <div className="git-changes-empty">
        <span>No changes</span>
        <span className="git-changes-empty-hint">Working tree is clean.</span>
      </div>
    );
  }

  return (
    <div className="git-changes-tab">
      {/* Status message */}
      {statusMessage && (
        <div
          className={`git-log-status-bar ${statusMessage.isError ? 'error' : 'success'}`}
          onClick={() => !statusMessage.isError && setStatusMessage(null)}
        >
          {statusMessage.text}
          {statusMessage.isError && (
            <>
              <button
                className="git-log-status-details-btn"
                onClick={onShowOutput}
              >
                Show Details
              </button>
              <button
                className="git-changes-dismiss-btn"
                onClick={() => setStatusMessage(null)}
              >
                &#10005;
              </button>
            </>
          )}
        </div>
      )}

      <div className="git-changes-body">
        {/* File list */}
        <div className="git-changes-files">
          {/* Conflicted */}
          {conflicted.length > 0 && (
            <div className="git-changes-group">
              <div className="git-changes-group-header git-changes-group-header--conflict" onClick={() => toggleGroup('conflicted')}>
                <span className="git-changes-group-chevron">{collapsedGroups.has('conflicted') ? '\u25B6' : '\u25BC'}</span>
                <span className="git-changes-group-label">Conflicts ({conflicted.length})</span>
              </div>
              {!collapsedGroups.has('conflicted') && renderFileTree(conflictedTree, 0, 'conflicted', fileHandlers)}
            </div>
          )}

          {/* Staged */}
          {staged.length > 0 && (
            <div className="git-changes-group">
              <div className="git-changes-group-header" onClick={() => toggleGroup('staged')}>
                <span className="git-changes-group-chevron">{collapsedGroups.has('staged') ? '\u25B6' : '\u25BC'}</span>
                <span className="git-changes-group-label">Staged Changes ({staged.length})</span>
                <button
                  className="git-changes-group-action"
                  onClick={(e) => { e.stopPropagation(); handleUnstageAll(); }}
                  disabled={isAnyLoading}
                >
                  &minus; Unstage All
                </button>
              </div>
              {!collapsedGroups.has('staged') && renderFileTree(stagedTree, 0, 'staged', fileHandlers)}
            </div>
          )}

          {/* Unstaged */}
          {unstaged.length > 0 && (
            <div className="git-changes-group">
              <div className="git-changes-group-header" onClick={() => toggleGroup('unstaged')}>
                <span className="git-changes-group-chevron">{collapsedGroups.has('unstaged') ? '\u25B6' : '\u25BC'}</span>
                <span className="git-changes-group-label">Changes ({unstaged.length})</span>
                <button
                  className="git-changes-group-action"
                  onClick={(e) => { e.stopPropagation(); handleStageAll(unstaged); }}
                  disabled={isAnyLoading}
                >
                  + Stage All
                </button>
              </div>
              {!collapsedGroups.has('unstaged') && renderFileTree(unstagedTree, 0, 'unstaged', fileHandlers)}
            </div>
          )}

          {/* Untracked */}
          {untracked.length > 0 && (
            <div className="git-changes-group">
              <div className="git-changes-group-header" onClick={() => toggleGroup('untracked')}>
                <span className="git-changes-group-chevron">{collapsedGroups.has('untracked') ? '\u25B6' : '\u25BC'}</span>
                <span className="git-changes-group-label">Untracked ({untracked.length})</span>
                <button
                  className="git-changes-group-action"
                  onClick={(e) => { e.stopPropagation(); handleStageAll(untracked); }}
                  disabled={isAnyLoading}
                >
                  + Track All
                </button>
              </div>
              {!collapsedGroups.has('untracked') && renderFileTree(untrackedTree, 0, 'untracked', fileHandlers)}
            </div>
          )}
        </div>

        {/* Commit area */}
        <div className="git-changes-commit">
          <div className="git-changes-commit-label">COMMIT MESSAGE</div>
          <textarea
            ref={messageRef}
            className="git-changes-commit-input"
            placeholder="Summary (required)"
            value={commitMessage}
            onChange={e => setCommitMessage(e.target.value)}
            rows={2}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleCommit();
              }
            }}
          />
          <textarea
            className="git-changes-commit-input git-changes-commit-description"
            placeholder="Description"
            value={commitDescription}
            onChange={e => setCommitDescription(e.target.value)}
            rows={2}
          />
          <div className="git-changes-commit-actions">
            <button
              className="git-changes-commit-btn"
              onClick={handleCommit}
              disabled={isCommitting || staged.length === 0 || !commitMessage.trim()}
            >
              {isCommitting ? 'Committing...' : 'Commit'}
            </button>
          </div>
          <div className="git-changes-commit-summary">
            {staged.length > 0 ? `${staged.length} file${staged.length !== 1 ? 's' : ''} staged` : 'No files staged'}
          </div>
        </div>
      </div>
    </div>
  );
}
