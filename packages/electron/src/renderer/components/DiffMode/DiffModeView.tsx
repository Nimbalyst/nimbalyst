import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { DiffFileTabs } from './DiffFileTabs';
import { DiffContent } from './DiffContent';
import { ChangesPanel } from './ChangesPanel';
import './DiffModeView.css';

export interface ChangedFile {
  path: string;
  status: 'added' | 'modified' | 'deleted';
  staged: boolean;
}

export interface CommitInfo {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: Date;
  files: string[];
}

interface DiffModeViewProps {
  worktreePath: string;
  workspacePath: string;
  isActive: boolean;
}

export function DiffModeView({ worktreePath, workspacePath, isActive }: DiffModeViewProps) {
  const [changedFiles, setChangedFiles] = useState<ChangedFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  // Debug logging
  console.log('[DiffModeView] Render:', { worktreePath, workspacePath, isActive, selectedFile, changedFilesCount: changedFiles.length });
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rightPanelWidth, setRightPanelWidth] = useState(320);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [repoRootBranch, setRepoRootBranch] = useState<string | undefined>(undefined);
  const [commitsBehind, setCommitsBehind] = useState(0);
  const [isRebasing, setIsRebasing] = useState(false);
  const isResizingRef = useRef(false);

  // Load changed files from the worktree
  const loadChangedFiles = useCallback(async () => {
    if (!worktreePath) return;

    try {
      const result = await window.electronAPI.invoke('worktree:get-changed-files', worktreePath);
      if (result?.success && Array.isArray(result.files)) {
        const files: ChangedFile[] = result.files.map((f: { path: string; status: string }) => ({
          path: f.path,
          status: f.status as 'added' | 'modified' | 'deleted',
          staged: true, // Default all to staged
        }));
        setChangedFiles(files);

        // Select first file if none selected
        if (files.length > 0 && !selectedFile) {
          setSelectedFile(files[0].path);
        }
      }
    } catch (err) {
      console.error('[DiffModeView] Failed to load changed files:', err);
      setError('Failed to load changed files');
    }
  }, [worktreePath, selectedFile]);

  // Load commits
  const loadCommits = useCallback(async () => {
    if (!worktreePath) return;

    try {
      const result = await window.electronAPI.invoke('worktree:get-commits', worktreePath);
      if (result?.success && Array.isArray(result.commits)) {
        setCommits(result.commits.map((c: any) => ({
          ...c,
          date: new Date(c.date),
        })));
      }
    } catch (err) {
      console.error('[DiffModeView] Failed to load commits:', err);
    }
  }, [worktreePath]);

  // Load repo root's current branch
  const loadRepoRootBranch = useCallback(async () => {
    if (!workspacePath) return;

    try {
      const result = await window.electronAPI.invoke('worktree:get-repo-current-branch', workspacePath);
      if (result?.success && result.branch) {
        setRepoRootBranch(result.branch);
      }
    } catch (err) {
      console.error('[DiffModeView] Failed to load repo root branch:', err);
    }
  }, [workspacePath]);

  // Load worktree status (commits behind)
  const loadWorktreeStatus = useCallback(async () => {
    if (!worktreePath) return;

    try {
      const result = await window.electronAPI.worktreeGetStatus(worktreePath);
      if (result?.success && result.status) {
        setCommitsBehind(result.status.commitsBehind || 0);
      }
    } catch (err) {
      console.error('[DiffModeView] Failed to load worktree status:', err);
    }
  }, [worktreePath]);

  // Initial load
  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      setError(null);
      await Promise.all([loadChangedFiles(), loadCommits(), loadRepoRootBranch(), loadWorktreeStatus()]);
      setIsLoading(false);
    };
    load();
  }, [loadChangedFiles, loadCommits, loadRepoRootBranch, loadWorktreeStatus]);

  // Toggle file staged state
  const handleToggleStaged = useCallback((filePath: string) => {
    setChangedFiles(prev =>
      prev.map(f =>
        f.path === filePath ? { ...f, staged: !f.staged } : f
      )
    );
  }, []);

  // Toggle all files staged state
  const handleToggleAllStaged = useCallback((staged: boolean) => {
    setChangedFiles(prev =>
      prev.map(f => ({ ...f, staged }))
    );
  }, []);

  // Commit changes
  const handleCommit = useCallback(async (message: string) => {
    const stagedFiles = changedFiles.filter(f => f.staged).map(f => f.path);
    if (stagedFiles.length === 0) {
      setError('No files staged for commit');
      return;
    }

    try {
      const result = await window.electronAPI.invoke('worktree:commit', worktreePath, message, stagedFiles);
      if (result?.success) {
        // Reload files and commits
        await Promise.all([loadChangedFiles(), loadCommits()]);
      } else {
        setError(result?.error || 'Failed to commit changes');
      }
    } catch (err) {
      console.error('[DiffModeView] Failed to commit:', err);
      setError('Failed to commit changes');
    }
  }, [changedFiles, worktreePath, loadChangedFiles, loadCommits]);

  // Merge to main
  const handleMerge = useCallback(async () => {
    try {
      const result = await window.electronAPI.invoke('worktree:merge', worktreePath, workspacePath);
      if (result?.success) {
        // Reload files and commits
        await Promise.all([loadChangedFiles(), loadCommits(), loadWorktreeStatus()]);
      } else {
        setError(result?.error || result?.message || 'Failed to merge');
      }
    } catch (err) {
      console.error('[DiffModeView] Failed to merge:', err);
      setError('Failed to merge to main');
    }
  }, [worktreePath, workspacePath, loadChangedFiles, loadCommits, loadWorktreeStatus]);

  // Rebase from base branch
  const handleRebase = useCallback(async () => {
    setIsRebasing(true);
    try {
      const result = await window.electronAPI.worktreeRebase(worktreePath);
      if (result?.success) {
        // Reload files, commits, and status
        await Promise.all([loadChangedFiles(), loadCommits(), loadWorktreeStatus()]);
      } else {
        setError(result?.error || result?.message || 'Failed to rebase');
      }
    } catch (err) {
      console.error('[DiffModeView] Failed to rebase:', err);
      setError('Failed to rebase from base branch');
    } finally {
      setIsRebasing(false);
    }
  }, [worktreePath, loadChangedFiles, loadCommits, loadWorktreeStatus]);

  // Handle resize
  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return;
      const newWidth = Math.min(Math.max(280, window.innerWidth - e.clientX), window.innerWidth * 0.6);
      setRightPanelWidth(newWidth);
    };

    const handleMouseUp = () => {
      if (!isResizingRef.current) return;
      isResizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // Derive staged files
  const stagedFiles = useMemo(() => changedFiles.filter(f => f.staged), [changedFiles]);

  if (!isActive) {
    return null;
  }

  return (
    <div className="diff-mode-view">
      {/* Left side: diff content */}
      <div className="diff-mode-main">
        {changedFiles.length > 0 ? (
          <>
            <DiffFileTabs
              files={changedFiles}
              selectedFile={selectedFile}
              onSelectFile={setSelectedFile}
              onCloseFile={(path) => {
                // Just deselect - file removal would require discarding changes
                if (selectedFile === path) {
                  const remaining = changedFiles.filter(f => f.path !== path);
                  setSelectedFile(remaining.length > 0 ? remaining[0].path : null);
                }
              }}
            />
            {selectedFile ? (
              <DiffContent
                worktreePath={worktreePath}
                filePath={selectedFile}
              />
            ) : (
              <div className="diff-mode-empty">
                <p>Select a file to view its diff</p>
              </div>
            )}
          </>
        ) : isLoading ? (
          <div className="diff-mode-empty">
            <p>Loading changes...</p>
          </div>
        ) : (
          <div className="diff-mode-empty">
            <p>No changes in this worktree</p>
          </div>
        )}
      </div>

      {/* Resize handle */}
      <div
        className={`diff-mode-resize-handle ${panelCollapsed ? 'is-hidden' : ''}`}
        onMouseDown={handleResizeMouseDown}
      >
        <div className="diff-mode-resize-handle-inner" />
      </div>

      {/* Right side: changes panel */}
      <div
        className={`diff-mode-panel ${panelCollapsed ? 'collapsed' : ''}`}
        style={{ width: panelCollapsed ? 48 : rightPanelWidth }}
      >
        <ChangesPanel
          files={changedFiles}
          stagedFiles={stagedFiles}
          commits={commits}
          onToggleStaged={handleToggleStaged}
          onToggleAllStaged={handleToggleAllStaged}
          onCommit={handleCommit}
          onMerge={handleMerge}
          onRebase={handleRebase}
          onSelectFile={setSelectedFile}
          onRefresh={() => Promise.all([loadChangedFiles(), loadCommits(), loadRepoRootBranch(), loadWorktreeStatus()])}
          onCollapse={() => setPanelCollapsed(prev => !prev)}
          collapsed={panelCollapsed}
          error={error}
          onDismissError={() => setError(null)}
          workspacePath={workspacePath}
          worktreePath={worktreePath}
          repoRootBranch={repoRootBranch}
          commitsBehind={commitsBehind}
          isRebasing={isRebasing}
        />
      </div>
    </div>
  );
}

export default DiffModeView;
