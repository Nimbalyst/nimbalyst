import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { DiffFileTabs } from './DiffFileTabs';
import { DiffContent } from './DiffContent';
import { ChangesPanel } from './ChangesPanel';
import { MergeConflictDialog } from './MergeConflictDialog';
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
  worktreeId?: string;
  isActive: boolean;
}

export function DiffModeView({ worktreePath, workspacePath, worktreeId, isActive }: DiffModeViewProps) {
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
  const [isMerged, setIsMerged] = useState(false);
  const [isRebasing, setIsRebasing] = useState(false);
  const [mergeConflictFiles, setMergeConflictFiles] = useState<string[] | null>(null);
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

  // Load worktree status (commits behind, isMerged)
  const loadWorktreeStatus = useCallback(async () => {
    if (!worktreePath) return;

    try {
      const result = await window.electronAPI.worktreeGetStatus(worktreePath);
      if (result?.success && result.status) {
        setCommitsBehind(result.status.commitsBehind || 0);
        setIsMerged(result.status.isMerged || false);
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
        // Reload files, commits, and status (new commit changes isMerged state)
        await Promise.all([loadChangedFiles(), loadCommits(), loadWorktreeStatus()]);
      } else {
        setError(result?.error || 'Failed to commit changes');
      }
    } catch (err) {
      console.error('[DiffModeView] Failed to commit:', err);
      setError('Failed to commit changes');
    }
  }, [changedFiles, worktreePath, loadChangedFiles, loadCommits, loadWorktreeStatus]);

  // Merge to main
  const handleMerge = useCallback(async () => {
    try {
      const result = await window.electronAPI.invoke('worktree:merge', worktreePath, workspacePath);
      if (result?.success) {
        // Reload files and commits
        await Promise.all([loadChangedFiles(), loadCommits(), loadWorktreeStatus()]);
      } else {
        // Check if this is a merge conflict error (detected before merge started)
        if ((result?.message === 'merge-conflict-detected' || result?.message === 'merge-conflict-in-main') && result?.conflictedFiles) {
          // Show merge conflict dialog
          setMergeConflictFiles(result.conflictedFiles);
        } else {
          setError(result?.error || result?.message || 'Failed to merge');
        }
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

  // Squash commits
  const handleSquash = useCallback(async (commitHashes: string[], message: string) => {
    try {
      const result = await window.electronAPI.invoke('worktree:squash-commits', worktreePath, commitHashes, message);
      if (result?.success) {
        // Reload commits, files, and status
        await Promise.all([loadCommits(), loadChangedFiles(), loadWorktreeStatus()]);
      } else {
        setError(result?.error || 'Failed to squash commits');
      }
    } catch (err) {
      console.error('[DiffModeView] Failed to squash commits:', err);
      setError('Failed to squash commits');
    }
  }, [worktreePath, loadCommits, loadChangedFiles, loadWorktreeStatus]);

  // Resolve merge conflicts with Claude Agent
  const handleResolveConflictsWithAgent = useCallback(async () => {
    if (!mergeConflictFiles || mergeConflictFiles.length === 0) return;

    console.log('[DiffModeView] Resolving conflicts with agent', { mergeConflictFiles, workspacePath });

    // Close the dialog
    setMergeConflictFiles(null);

    try {
      // Get the worktree branch name from the path
      const worktreeName = worktreePath.split('/').pop() || 'unknown';
      const worktreeBranch = `worktree/${worktreeName}`;
      const mainBranch = repoRootBranch || 'main';

      // Create a very specific prompt for resolving the merge conflicts
      const conflictFilesList = mergeConflictFiles.map(f => `  - ${f}`).join('\n');
      const draftMessage = `I need to merge the worktree branch into main, preserving both committed and uncommitted changes.

**Context:**
- Main repository: ${workspacePath}
- Main branch: ${mainBranch}
- Worktree location: ${worktreePath}
- Worktree branch: ${worktreeBranch}

**The Situation:**
I'm trying to merge commits from ${worktreeBranch} into ${mainBranch}. These files have both uncommitted changes in main AND committed changes in the worktree:
${conflictFilesList}

**IMPORTANT - The desired end state:**
For each file, the final result should have:
1. The committed changes from ${worktreeBranch} (merged and committed)
2. The uncommitted changes from ${mainBranch} (still unstaged, on top of the merged version)

**What you need to do:**

**Step 1: Stash the uncommitted changes**
\`\`\`bash
cd ${workspacePath}
git stash push -m "Uncommitted changes before worktree merge"
\`\`\`

**Step 2: Merge the worktree branch**
\`\`\`bash
git merge --no-ff ${worktreeBranch}
\`\`\`
This applies the committed changes from the worktree.

**Step 3: Reapply the uncommitted changes**
\`\`\`bash
git stash pop
\`\`\`

**Step 4: Resolve conflicts from stash pop**
The \`git stash pop\` will likely create conflicts in ${mergeConflictFiles.join(', ')} because both the merge and the stash modified these files.

For each conflicted file:
- Open the file and look for conflict markers (\`<<<<<<< Updated upstream\`, \`=======\`, \`>>>>>>> Stashed changes\`)
- Between \`<<<<<<< Updated upstream\` and \`=======\` is the newly merged version (this is what we want to keep as the base)
- Between \`=======\` and \`>>>>>>> Stashed changes\` is the uncommitted changes (this is what we want on top)
- **Merge both sections**: Keep the merged version as the base, then apply the uncommitted changes on top
- Remove all conflict markers
- The file should now have both the merged changes AND the uncommitted changes

**Step 5: Verify the result**
\`\`\`bash
git status
\`\`\`
Should show the files as modified (uncommitted). The working directory should have:
- The committed changes from ${worktreeBranch} (in the last commit)
- The uncommitted changes (as unstaged modifications)

**DO NOT** stage or commit these changes - they should remain uncommitted.

Please proceed with this strategy.`;

      console.log('[DiffModeView] Creating AI session in main repo workspace...');
      // Create the session in the MAIN REPO workspace (so it appears in session list)
      // but associate it with the worktree via worktreeId
      const sessionResult = await window.electronAPI.aiCreateSession(
        'claude-code',
        undefined, // documentContext
        workspacePath, // workspacePath (main repo - so session appears in main session list)
        undefined, // modelId (use default)
        'coding', // sessionType
        worktreeId  // worktreeId (associate with the worktree)
      );

      console.log('[DiffModeView] Session result:', sessionResult);

      // The session result uses 'id' not 'sessionId'
      if (sessionResult?.id) {
        const sessionId = sessionResult.id;

        // Load the session data first (use workspacePath since session was created in main repo workspace)
        console.log('[DiffModeView] Loading session...', sessionId);
        const sessionData = await window.electronAPI.aiLoadSession(sessionId, workspacePath);
        console.log('[DiffModeView] Session data:', sessionData);

        if (sessionData) {
          // Save the draft input so it appears in the text box but isn't sent yet
          console.log('[DiffModeView] Saving draft input...');
          await window.electronAPI.aiSaveDraftInput(
            sessionId,
            draftMessage,
            workspacePath
          );

          // Dispatch a custom event to notify the AgenticPanel to open this session
          // Use workspacePath since that's where the session was created
          console.log('[DiffModeView] Dispatching event...');
          window.dispatchEvent(new CustomEvent('open-ai-session', {
            detail: {
              sessionId,
              workspacePath: workspacePath,
              draftInput: draftMessage
            }
          }));
          console.log('[DiffModeView] Event dispatched successfully');
        }
      }
    } catch (err) {
      console.error('[DiffModeView] Failed to create agent session for conflict resolution:', err);
      setError('Failed to create Claude Agent session for conflict resolution');
    }
  }, [workspacePath, worktreePath, worktreeId, repoRootBranch, mergeConflictFiles]);

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
          onSquash={handleSquash}
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
          isMerged={isMerged}
          isRebasing={isRebasing}
        />
      </div>

      {/* Merge conflict dialog */}
      {mergeConflictFiles && mergeConflictFiles.length > 0 && (
        <MergeConflictDialog
          workspacePath={workspacePath}
          conflictedFiles={mergeConflictFiles}
          onResolveWithAgent={handleResolveConflictsWithAgent}
          onCancel={() => setMergeConflictFiles(null)}
        />
      )}
    </div>
  );
}

export default DiffModeView;
