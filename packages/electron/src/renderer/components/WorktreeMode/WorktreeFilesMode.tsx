import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  forwardRef
} from 'react';
import type { SessionData } from '@nimbalyst/runtime/ai/server/types';
import { MaterialSymbol } from '@nimbalyst/runtime';
import { TabsProvider, useTabsActions, useTabs } from '../../contexts/TabsContext';
import { useTheme } from '../../hooks/useTheme';
import { TabManager } from '../TabManager/TabManager';
import { TabContent } from '../TabContent/TabContent';
import { FileTree, type FileGitStatus } from '../FileTree';
import { FileTreeFilterMenu, type FileTreeFilter } from '../FileTreeFilterMenu';
import { InputModal } from '../InputModal';
import { createInitialFileContent } from '../../utils/fileUtils';
import { getFileName } from '../../utils/pathUtils';
import { WorktreeContentMode } from './WorktreeModeToggle';
import { DiffModeView } from '../DiffMode';

interface FileTreeItem {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeItem[];
}

export interface WorktreeFilesModeRef {
  openFile: (filePath: string) => void;
}

interface WorktreeFilesModeProps {
  sessionId: string;
  sessionData: SessionData;
  worktreePath: string;
  workspacePath: string;
  isActive: boolean;
  mode: WorktreeContentMode;
  chatPanel: React.ReactNode;
  onMounted?: (sessionId: string) => void;
  onMaximize?: () => void;
  onArchived?: () => void;
}

const SPECIAL_DIRECTORIES = ['nimbalyst-local'];
const CLAUDE_FILTERS: FileTreeFilter[] = ['ai-read', 'ai-written'];
const GIT_FILTERS: FileTreeFilter[] = ['git-uncommitted', 'git-worktree'];

function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, '/');
}

function normalizeFilePath(path: string): string {
  if (!path) return '';
  let normalized = normalizeSlashes(path);
  if (/^[a-zA-Z]:\/$/i.test(normalized)) {
    return normalized;
  }
  if (normalized !== '/' && normalized.endsWith('/')) {
    normalized = normalized.replace(/\/+$/, '');
  }
  return normalized;
}

function resolveSessionFilePath(filePath: string, basePath?: string): string | null {
  if (!filePath) return null;
  const sanitized = normalizeSlashes(filePath);
  if (sanitized.startsWith('/') || /^[a-zA-Z]:\//.test(sanitized)) {
    return normalizeFilePath(sanitized);
  }
  if (!basePath) {
    return normalizeFilePath(sanitized);
  }
  const base = normalizeFilePath(basePath);
  const relative = sanitized.replace(/^\.?\//, '');
  return normalizeFilePath(`${base}/${relative}`);
}

// Inner component that uses TabsContext
const WorktreeFilesModeInner = forwardRef<WorktreeFilesModeRef, WorktreeFilesModeProps>(function WorktreeFilesModeInner({
  sessionId,
  sessionData,
  worktreePath,
  workspacePath,
  isActive,
  mode,
  chatPanel,
  onMounted,
  onMaximize,
  onArchived
}, ref) {
  const { theme } = useTheme();
  const tabsActions = useTabsActions();
  const tabs = useTabs();
  const [fileTree, setFileTree] = useState<FileTreeItem[]>([]);
  const [fileTreeFilter, setFileTreeFilter] = useState<FileTreeFilter>('all');
  const [showFileIcons, setShowFileIcons] = useState(true);
  const [showGitStatus, setShowGitStatus] = useState(true);
  const [enableAutoScroll, setEnableAutoScroll] = useState(true);
  const [gitStatusMap, setGitStatusMap] = useState<Map<string, FileGitStatus>>(new Map());
  const [gitUncommittedPaths, setGitUncommittedPaths] = useState<Set<string>>(new Set());
  const [gitWorktreePaths, setGitWorktreePaths] = useState<Set<string>>(new Set());
  const [aiReadPaths, setAiReadPaths] = useState<Set<string>>(new Set());
  const [aiWrittenPaths, setAiWrittenPaths] = useState<Set<string>>(new Set());
  const [isGitRepo, setIsGitRepo] = useState(false);
  const [isGitWorktree, setIsGitWorktree] = useState(false);
  const [rightPanelTab, setRightPanelTab] = useState<'chat' | 'files'>('chat');
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [rightPanelWidth, setRightPanelWidth] = useState(320);
  const isResizingRef = useRef(false);
  const [isNewFileModalOpen, setIsNewFileModalOpen] = useState(false);
  const [newFileDirectory, setNewFileDirectory] = useState<string | null>(null);
  const [filterMenuPosition, setFilterMenuPosition] = useState({ x: 0, y: 0 });
  const [isFilterMenuOpen, setIsFilterMenuOpen] = useState(false);
  const filterButtonRef = useRef<HTMLButtonElement>(null);
  const mountedRef = useRef(false);
  const pendingFileQueue = useRef<string[]>([]);

  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);

  // Keep highlight in sync with active tab
  useEffect(() => {
    setActiveFilePath(tabs.activeTab?.filePath || null);
  }, [tabs.activeTab?.filePath]);

  const openFileInEditor = useCallback((filePath: string) => {
    console.log('[WorktreeFilesMode] openFileInEditor called with:', filePath);
    console.log('[WorktreeFilesMode] worktreePath:', worktreePath);
    console.log('[WorktreeFilesMode] workspacePath:', workspacePath);
    console.log('[WorktreeFilesMode] mounted:', mountedRef.current);

    if (!filePath) {
      console.warn('[WorktreeFilesMode] Cannot open file: filePath is empty');
      return;
    }

    // If component is not mounted yet, queue the file for later
    if (!mountedRef.current) {
      console.log('[WorktreeFilesMode] Component not mounted yet, queueing file:', filePath);
      pendingFileQueue.current.push(filePath);
      return;
    }

    // Resolve relative paths relative to worktree, not main workspace
    const resolved = resolveSessionFilePath(filePath, worktreePath);
    console.log('[WorktreeFilesMode] Resolved path:', resolved);

    if (!resolved) {
      console.error('[WorktreeFilesMode] Failed to resolve file path:', filePath);
      return;
    }

    const normalized = normalizeFilePath(resolved);
    console.log('[WorktreeFilesMode] Normalized path:', normalized);

    if (!normalized) {
      console.error('[WorktreeFilesMode] Failed to normalize file path:', resolved);
      return;
    }

    // Check if tab already exists
    const existing = tabsActions.findTabByPath(normalized);
    console.log('[WorktreeFilesMode] Existing tab:', existing);

    if (existing) {
      tabsActions.switchTab(existing.id);
      return;
    }

    // Add new tab
    try {
      console.log('[WorktreeFilesMode] Adding new tab for:', normalized);
      tabsActions.addTab(normalized, '', true);
    } catch (err) {
      console.error('[WorktreeFilesMode] Failed to open file in tab:', err);
    }
  }, [tabsActions, worktreePath, workspacePath]);

  useImperativeHandle(ref, () => ({
    openFile: openFileInEditor
  }), [openFileInEditor]);

  // Notify parent when component is mounted and ref is ready
  useEffect(() => {
    // Mark component as mounted
    mountedRef.current = true;

    // Process any pending file opens that were queued before mount
    if (pendingFileQueue.current.length > 0) {
      console.log('[WorktreeFilesMode] Processing pending file queue:', pendingFileQueue.current);
      const filesToOpen = [...pendingFileQueue.current];
      pendingFileQueue.current = [];

      // Open each file in the queue
      filesToOpen.forEach(filePath => {
        openFileInEditor(filePath);
      });
    }

    if (onMounted) {
      onMounted(sessionId);
    }

    // Cleanup: mark as unmounted when component unmounts
    return () => {
      mountedRef.current = false;
    };
  }, [onMounted, sessionId, openFileInEditor]);

  const refreshFileTree = useCallback(async () => {
    if (!worktreePath || !window.electronAPI?.getFolderContents) return;
    try {
      const tree = await window.electronAPI.getFolderContents(worktreePath);
      setFileTree(tree);
    } catch (err) {
      console.error('[WorktreeFilesMode] Failed to load file tree:', err);
      setFileTree([]);
    }
  }, [worktreePath]);

  // Initial load
  useEffect(() => {
    refreshFileTree();
  }, [refreshFileTree]);

  // File watcher integration - listen for file changes in the worktree directory
  // Uses the same 'file-changed-on-disk' event that TabEditor uses
  useEffect(() => {
    if (!worktreePath) return;

    let debounceTimeout: NodeJS.Timeout | null = null;

    const handleFileChanged = (event: any) => {
      // Check if the changed file is within this worktree's path
      if (event.path && event.path.startsWith(worktreePath)) {
        // Debounce file tree refresh to avoid excessive updates
        if (debounceTimeout) {
          clearTimeout(debounceTimeout);
        }

        debounceTimeout = setTimeout(() => {
          refreshFileTree();
          debounceTimeout = null;
        }, 500);
      }
    };

    window.electronAPI.on('file-changed-on-disk', handleFileChanged);

    return () => {
      if (debounceTimeout) {
        clearTimeout(debounceTimeout);
      }
      window.electronAPI.off('file-changed-on-disk', handleFileChanged);
    };
  }, [worktreePath, refreshFileTree]);

  const loadGitMetadata = useCallback(async () => {
    // Early return if worktree path doesn't seem valid
    if (!window.electronAPI?.invoke || !worktreePath || worktreePath === '/') return;

    // Verify the path exists before making git operations
    try {
      const exists = await window.electronAPI.invoke('fs:exists', worktreePath);
      if (!exists) return;
    } catch {
      return; // Path check failed, skip git operations
    }

    try {
      const [repoResult, worktreeResult] = await Promise.all([
        window.electronAPI.invoke('git:is-repo', worktreePath),
        window.electronAPI.invoke('git:is-worktree', worktreePath)
      ]);
      setIsGitRepo(Boolean(repoResult?.isRepo));
      setIsGitWorktree(Boolean(worktreeResult?.isWorktree));
    } catch (err) {
      console.error('[WorktreeFilesMode] Failed to load git metadata:', err);
      setIsGitRepo(false);
      setIsGitWorktree(false);
    }
  }, [worktreePath]);

  useEffect(() => {
    loadGitMetadata();
  }, [loadGitMetadata]);

  const loadGitStatuses = useCallback(async () => {
    // Early return if worktree path doesn't seem valid
    if (!window.electronAPI?.invoke || !worktreePath || worktreePath === '/') {
      setGitStatusMap(new Map());
      return;
    }

    // Verify the path exists before making git operations
    try {
      const exists = await window.electronAPI.invoke('fs:exists', worktreePath);
      if (!exists) {
        setGitStatusMap(new Map());
        return;
      }
    } catch {
      setGitStatusMap(new Map());
      return; // Path check failed, skip git operations
    }

    try {
      const result = await window.electronAPI.invoke('git:get-all-file-statuses', worktreePath);
      if (result?.success && result.statuses) {
        const entries = Object.entries(result.statuses as Record<string, { status: string }>);
        const next = new Map<string, FileGitStatus>();
        for (const [filePath, data] of entries) {
          const status = data.status as FileGitStatus;
          if (status === 'modified' || status === 'staged' || status === 'untracked') {
            next.set(normalizeFilePath(filePath), status);
          }
        }
        setGitStatusMap(next);
      } else {
        setGitStatusMap(new Map());
      }
    } catch (err) {
      console.error('[WorktreeFilesMode] Failed to load git statuses:', err);
      setGitStatusMap(new Map());
    }
  }, [worktreePath]);

  useEffect(() => {
    if (isGitRepo) {
      loadGitStatuses();
    } else {
      setGitStatusMap(new Map());
    }
  }, [isGitRepo, loadGitStatuses]);

  const loadGitFilteredSets = useCallback(async () => {
    // Early return if worktree path doesn't seem valid
    if (!window.electronAPI?.invoke || !worktreePath || worktreePath === '/') {
      setGitUncommittedPaths(new Set());
      setGitWorktreePaths(new Set());
      return;
    }

    // Verify the path exists before making git operations
    try {
      const exists = await window.electronAPI.invoke('fs:exists', worktreePath);
      if (!exists) {
        setGitUncommittedPaths(new Set());
        setGitWorktreePaths(new Set());
        return;
      }
    } catch {
      setGitUncommittedPaths(new Set());
      setGitWorktreePaths(new Set());
      return; // Path check failed, skip git operations
    }

    if (isGitRepo) {
      try {
        const result = await window.electronAPI.invoke('git:get-uncommitted-files', worktreePath);
        if (result?.success && Array.isArray(result.files)) {
          const normalized = result.files.map((file: string) => normalizeFilePath(file));
          setGitUncommittedPaths(new Set(normalized));
        } else {
          setGitUncommittedPaths(new Set());
        }
      } catch (err) {
        console.error('[WorktreeFilesMode] Failed to load uncommitted files:', err);
        setGitUncommittedPaths(new Set());
      }
    } else {
      setGitUncommittedPaths(new Set());
    }

    if (isGitWorktree) {
      try {
        const result = await window.electronAPI.invoke('git:get-worktree-modified-files', worktreePath);
        if (result?.success && Array.isArray(result.files)) {
          const normalized = result.files.map((file: string) => normalizeFilePath(file));
          setGitWorktreePaths(new Set(normalized));
        } else {
          setGitWorktreePaths(new Set());
        }
      } catch (err) {
        console.error('[WorktreeFilesMode] Failed to load worktree modified files:', err);
        setGitWorktreePaths(new Set());
      }
    } else {
      setGitWorktreePaths(new Set());
    }
  }, [isGitRepo, isGitWorktree, worktreePath]);

  useEffect(() => {
    loadGitFilteredSets();
  }, [loadGitFilteredSets]);

  const loadSessionFileFilters = useCallback(async () => {
    if (!window.electronAPI?.invoke) {
      setAiReadPaths(new Set());
      setAiWrittenPaths(new Set());
      return;
    }

    const normalizeResponse = (response: any): Set<string> => {
      if (!response?.success || !Array.isArray(response.files)) {
        return new Set();
      }
      const mapped: (string | null)[] = response.files
        .map((file: any) => resolveSessionFilePath(file.filePath, workspacePath));
      const normalized = mapped.filter((value): value is string => Boolean(value));
      return new Set(normalized);
    };

    try {
      const [readResult, writtenResult] = await Promise.all([
        window.electronAPI.invoke('session-files:get-by-session', sessionId, 'read'),
        window.electronAPI.invoke('session-files:get-by-session', sessionId, 'edited')
      ]);
      setAiReadPaths(normalizeResponse(readResult));
      setAiWrittenPaths(normalizeResponse(writtenResult));
    } catch (err) {
      console.error('[WorktreeFilesMode] Failed to load session file filters:', err);
      setAiReadPaths(new Set());
      setAiWrittenPaths(new Set());
    }
  }, [sessionId, workspacePath]);

  useEffect(() => {
    loadSessionFileFilters();
  }, [loadSessionFileFilters]);

  // Handle right panel resize
  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return;

      // Calculate width from right edge of window
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

  const filterFileTree = useCallback((items: FileTreeItem[], filter: FileTreeFilter): FileTreeItem[] => {
    const includeSpecialDirectory = (name: string) => SPECIAL_DIRECTORIES.includes(name);

    const includeFileByExtension = (fileName: string): boolean => {
      const lower = fileName.toLowerCase();
      if (filter === 'markdown') {
        return lower.endsWith('.md') || lower.endsWith('.markdown');
      }
      if (filter === 'known') {
        const knownExtensions = ['.md', '.markdown', '.txt', '.json', '.js', '.ts', '.tsx', '.jsx', '.css', '.html', '.xml', '.yaml', '.yml'];
        return knownExtensions.some(ext => lower.endsWith(ext));
      }
      return true;
    };

    const includeByPathSet = (pathSet: Set<string>, filePath: string) => pathSet.has(normalizeFilePath(filePath));

    const shouldIncludeFile = (item: FileTreeItem): boolean => {
      if (filter === 'all' || filter === 'markdown' || filter === 'known') {
        return includeFileByExtension(item.name);
      }
      if (filter === 'git-uncommitted') {
        return includeByPathSet(gitUncommittedPaths, item.path);
      }
      if (filter === 'git-worktree') {
        return includeByPathSet(gitWorktreePaths, item.path);
      }
      if (filter === 'ai-read') {
        return includeByPathSet(aiReadPaths, item.path);
      }
      if (filter === 'ai-written') {
        return includeByPathSet(aiWrittenPaths, item.path);
      }
      return true;
    };

    const filterChildren = (entries: FileTreeItem[]): FileTreeItem[] => {
      return entries.reduce<FileTreeItem[]>((acc, item) => {
        if (item.type === 'directory') {
          if (includeSpecialDirectory(item.name)) {
            acc.push(item);
            return acc;
          }
          const children = item.children ? filterChildren(item.children) : [];
          if (children.length > 0) {
            acc.push({ ...item, children });
          }
        } else if (shouldIncludeFile(item)) {
          acc.push(item);
        }
        return acc;
      }, []);
    };

    if (filter === 'all') {
      return items;
    }

    return filterChildren(items);
  }, [aiReadPaths, aiWrittenPaths, gitUncommittedPaths, gitWorktreePaths]);

  const filteredTree = useMemo(() => filterFileTree(fileTree, fileTreeFilter), [fileTree, fileTreeFilter, filterFileTree]);

  const handleFilterButtonClick = useCallback(() => {
    if (!filterButtonRef.current) return;
    const rect = filterButtonRef.current.getBoundingClientRect();
    setFilterMenuPosition({ x: rect.right + 4, y: rect.bottom + 4 });
    setIsFilterMenuOpen(true);
  }, []);

  const handleNewFileConfirm = useCallback(async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    try {
      const targetDir = newFileDirectory || worktreePath;
      const targetPath = `${targetDir}/${trimmed}`;
      const content = createInitialFileContent(trimmed);
      await window.electronAPI?.createFile?.(targetPath, content);
      await refreshFileTree();
      openFileInEditor(targetPath);
    } catch (err) {
      console.error('[WorktreeFilesMode] Failed to create file:', err);
    } finally {
      setIsNewFileModalOpen(false);
      setNewFileDirectory(null);
    }
  }, [newFileDirectory, openFileInEditor, refreshFileTree, worktreePath]);

  const handleFileSelect = useCallback((filePath: string) => {
    openFileInEditor(filePath);
  }, [openFileInEditor]);

  const activeClaudeFilterCount = fileTreeFilter === 'ai-read'
    ? aiReadPaths.size
    : fileTreeFilter === 'ai-written'
      ? aiWrittenPaths.size
      : 0;

  const rightPanelClassName = panelCollapsed ? 'collapsed' : '';

  // When in agent mode, show only the chat panel fullscreen
  if (mode === 'agent') {
    return (
      <div
        key={`agent-mode-${sessionId}`}
        className="worktree-agent-mode flex-1 flex flex-col min-h-0 bg-[var(--nim-bg)]"
        style={{ display: isActive ? 'flex' : 'none', width: '100%', height: '100%' }}
      >
        {chatPanel}
      </div>
    );
  }

  // When in changes mode, show the diff view
  if (mode === 'changes') {
    return (
      <div
        key={`changes-mode-${sessionId}`}
        className="worktree-changes-mode flex-1 flex flex-col min-h-0 bg-[var(--nim-bg)]"
        style={{ display: isActive ? 'flex' : 'none', width: '100%', height: '100%' }}
      >
        <DiffModeView
          worktreePath={worktreePath}
          workspacePath={workspacePath}
          worktreeId={sessionData.worktreeId}
          isActive={isActive}
          onArchived={onArchived}
        />
      </div>
    );
  }

  // When in files mode, show the full layout with editor and right panel
  return (
    <div
      key={`files-mode-${sessionId}`}
      className="worktree-files-mode flex-1 flex flex-row min-h-0 bg-[var(--nim-bg)]"
      style={{ display: isActive ? 'flex' : 'none' }}
    >
      <div className="worktree-files-editor flex-1 min-w-0 flex flex-col">
        {tabs.tabs.length > 0 ? (
          <TabManager
            onTabClose={(tabId) => {
              tabsActions.removeTab(tabId);
            }}
            onNewTab={() => setIsNewFileModalOpen(true)}
            hideTabBar={false}
            isActive={isActive}
          >
            <TabContent
              onTabClose={(tabId: string) => tabsActions.removeTab(tabId)}
              workspaceId={worktreePath}
            />
          </TabManager>
        ) : (
          <div className="worktree-files-empty flex-1 flex flex-col items-center justify-center text-[var(--nim-text-muted)] gap-3">
            <p>Select a file from the Files panel or open one from chat.</p>
            <button
              type="button"
              onClick={() => setIsNewFileModalOpen(true)}
              className="border-none rounded-md px-4 py-2 bg-[var(--nim-primary)] text-white font-medium cursor-pointer"
            >
              New File
            </button>
          </div>
        )}
      </div>

      {/* Resize handle */}
      <div
        className={`worktree-resize-handle w-1 cursor-col-resize shrink-0 relative z-10 ${panelCollapsed ? 'pointer-events-none opacity-0' : ''}`}
        onMouseDown={handleResizeMouseDown}
      >
        <div className="worktree-resize-handle-inner w-px h-full mx-auto bg-[var(--nim-border)] transition-all duration-200 hover:w-[3px] hover:bg-[var(--nim-primary)]" />
      </div>

      <div
        className={`worktree-files-right-panel min-w-[48px] flex flex-col bg-[var(--nim-bg-secondary)] shrink-0 ${panelCollapsed ? 'collapsed' : ''}`}
        style={{ width: panelCollapsed ? 48 : rightPanelWidth }}
      >
        <div className={`worktree-right-panel-header flex items-center justify-between px-2.5 py-2 border-b border-white/[0.06] gap-2 ${panelCollapsed ? 'justify-center px-1' : ''}`}>
          {!panelCollapsed && (
            <div className="worktree-right-tabs inline-flex bg-white/[0.04] rounded-full">
              <button
                type="button"
                className={`border-none bg-transparent text-[var(--nim-text-muted)] px-3 py-1.5 rounded-full text-xs cursor-pointer ${rightPanelTab === 'chat' ? 'bg-[var(--nim-bg-tertiary)] text-[var(--nim-text)]' : ''}`}
                onClick={() => setRightPanelTab('chat')}
              >
                Chat
              </button>
              <button
                type="button"
                className={`border-none bg-transparent text-[var(--nim-text-muted)] px-3 py-1.5 rounded-full text-xs cursor-pointer ${rightPanelTab === 'files' ? 'bg-[var(--nim-bg-tertiary)] text-[var(--nim-text)]' : ''}`}
                onClick={() => setRightPanelTab('files')}
              >
                Files
              </button>
            </div>
          )}
          <div className={`worktree-right-actions inline-flex gap-1 ${panelCollapsed ? 'w-full justify-center' : ''}`}>
            {!panelCollapsed && (
              <>
                <button
                  type="button"
                  title="New file"
                  onClick={() => setIsNewFileModalOpen(true)}
                  className="border-none bg-transparent text-[var(--nim-text-muted)] rounded-md p-1 cursor-pointer hover:bg-white/[0.08] hover:text-[var(--nim-text)]"
                >
                  <MaterialSymbol icon="add" size={18} />
                </button>
                <button
                  type="button"
                  title="Filter files"
                  ref={filterButtonRef}
                  onClick={handleFilterButtonClick}
                  className="border-none bg-transparent text-[var(--nim-text-muted)] rounded-md p-1 cursor-pointer hover:bg-white/[0.08] hover:text-[var(--nim-text)]"
                >
                  <MaterialSymbol icon="filter_list" size={18} />
                </button>
                <button
                  type="button"
                  title="Refresh files"
                  onClick={refreshFileTree}
                  className="border-none bg-transparent text-[var(--nim-text-muted)] rounded-md p-1 cursor-pointer hover:bg-white/[0.08] hover:text-[var(--nim-text)]"
                >
                  <MaterialSymbol icon="refresh" size={18} />
                </button>
                {onMaximize && (
                  <button
                    type="button"
                    title="Maximize agent view"
                    onClick={onMaximize}
                    className="border-none bg-transparent text-[var(--nim-text-muted)] rounded-md p-1 cursor-pointer hover:bg-white/[0.08] hover:text-[var(--nim-text)]"
                  >
                    <MaterialSymbol icon="fullscreen" size={18} />
                  </button>
                )}
              </>
            )}
            <button
              type="button"
              title={panelCollapsed ? 'Expand panel' : 'Collapse panel'}
              onClick={() => setPanelCollapsed(prev => !prev)}
              className="border-none bg-transparent text-[var(--nim-text-muted)] rounded-md p-1 cursor-pointer hover:bg-white/[0.08] hover:text-[var(--nim-text)]"
            >
              <MaterialSymbol icon={panelCollapsed ? 'chevron_left' : 'chevron_right'} size={18} />
            </button>
          </div>
        </div>

        {!panelCollapsed && (
          <div className="worktree-right-panel-body flex-1 min-h-0 flex">
            {rightPanelTab === 'chat' ? (
              <div key={`chat-panel-wrapper-${sessionId}`} className="worktree-chat-panel flex-1 min-h-0 flex [&>div]:flex-1 [&>div]:min-h-0">
                {chatPanel}
              </div>
            ) : (
              <div className="worktree-files-panel flex-1 min-h-0 flex flex-col py-1 overflow-hidden">
                {filteredTree.length === 0 ? (
                  <div className="worktree-files-empty-state flex-1 flex items-center justify-center text-[var(--nim-text-muted)] p-4 text-center">
                    {fileTreeFilter === 'all' ? (
                      <p>No files found in this worktree.</p>
                    ) : CLAUDE_FILTERS.includes(fileTreeFilter) ? (
                      <p>
                        {activeClaudeFilterCount === 0
                          ? 'No files match this filter for the current session.'
                          : 'No files available.'}
                      </p>
                    ) : (
                      <p>No files match the selected filter.</p>
                    )}
                  </div>
                ) : (
                  <div className="worktree-files-tree flex-1 overflow-y-auto px-2">
                    <FileTree
                      items={filteredTree}
                      currentFilePath={activeFilePath}
                      onFileSelect={handleFileSelect}
                      level={0}
                      showIcons={showFileIcons}
                      gitStatusMap={showGitStatus ? gitStatusMap : undefined}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {isFilterMenuOpen && (
        <FileTreeFilterMenu
          x={filterMenuPosition.x}
          y={filterMenuPosition.y}
          currentFilter={fileTreeFilter}
          showIcons={showFileIcons}
          showGitStatus={showGitStatus}
          enableAutoScroll={enableAutoScroll}
          onFilterChange={setFileTreeFilter}
          onShowIconsChange={setShowFileIcons}
          onShowGitStatusChange={setShowGitStatus}
          onEnableAutoScrollChange={setEnableAutoScroll}
          hasActiveClaudeSession={Boolean(sessionId)}
          claudeSessionFileCounts={{ read: aiReadPaths.size, written: aiWrittenPaths.size }}
          isGitRepo={isGitRepo}
          gitUncommittedCount={gitUncommittedPaths.size}
          isGitWorktree={isGitWorktree}
          gitWorktreeCount={gitWorktreePaths.size}
          onClose={() => setIsFilterMenuOpen(false)}
        />
      )}

      {isNewFileModalOpen && (
        <InputModal
          isOpen={isNewFileModalOpen}
          title="Create File"
          placeholder="example.md"
          onCancel={() => {
            setIsNewFileModalOpen(false);
            setNewFileDirectory(null);
          }}
          onConfirm={handleNewFileConfirm}
        />
      )}
    </div>
  );
});

// Wrapper component that provides TabsContext
const WorktreeFilesMode = forwardRef<WorktreeFilesModeRef, WorktreeFilesModeProps>(function WorktreeFilesMode(props, ref) {
  return (
    <TabsProvider workspacePath={props.worktreePath}>
      <WorktreeFilesModeInner {...props} ref={ref} />
    </TabsProvider>
  );
});

export default WorktreeFilesMode;
