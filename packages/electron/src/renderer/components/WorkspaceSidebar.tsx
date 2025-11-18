import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { FileTree } from './FileTree';
import { InputModal } from './InputModal';
import { PlansPanel } from './PlansPanel/PlansPanel';
import { FileTreeFilterMenu, FileTreeFilter } from './FileTreeFilterMenu';
import { createInitialFileContent } from '../utils/fileUtils';
import '../WorkspaceSidebar.css';

interface FileTreeItem {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeItem[];
}

interface WorkspaceSidebarProps {
  workspaceName: string;
  workspacePath: string;
  fileTree: FileTreeItem[];
  currentFilePath: string | null;
  currentView: 'files' | 'plans';
  onFileSelect: (filePath: string) => void;
  onCloseWorkspace: () => void;
  onOpenQuickSearch?: () => void;
  onRefreshFileTree?: () => void;
  onViewHistory?: (filePath: string) => void;
  onNewPlan?: () => void;
  onOpenPlansTable?: () => void;
  onSelectedFolderChange?: (folderPath: string | null) => void;
  currentAISessionId?: string | null;
}

const FILE_TREE_FILTER_OPTIONS: ReadonlyArray<FileTreeFilter> = ['all', 'markdown', 'known', 'git-uncommitted', 'ai-read', 'ai-written'];
const CLAUDE_SESSION_FILTERS = new Set<FileTreeFilter>(['ai-read', 'ai-written']);
const GIT_FILTERS = new Set<FileTreeFilter>(['git-uncommitted']);

interface SessionFileFilterState {
  read: string[];
  written: string[];
}

function isValidFileTreeFilter(value: unknown): value is FileTreeFilter {
  return typeof value === 'string' && FILE_TREE_FILTER_OPTIONS.includes(value as FileTreeFilter);
}

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

function resolveSessionFilePath(filePath: string, workspacePath?: string): string | null {
  if (!filePath) return null;
  const sanitized = normalizeSlashes(filePath);
  if (sanitized.startsWith('/') || /^[a-zA-Z]:\//.test(sanitized)) {
    return normalizeFilePath(sanitized);
  }
  if (!workspacePath) {
    return normalizeFilePath(sanitized);
  }
  const base = normalizeFilePath(workspacePath);
  const relative = sanitized.replace(/^\.?\//, '');
  return normalizeFilePath(`${base}/${relative}`);
}

// Generate a consistent color based on workspace path
function generateWorkspaceColor(path: string): string {
  let hash = 0;
  for (let i = 0; i < path.length; i++) {
    hash = ((hash << 5) - hash) + path.charCodeAt(i);
    hash = hash & hash;
  }

  // Generate a hue value (0-360)
  const hue = Math.abs(hash) % 360;
  // Use consistent saturation and lightness for pleasant colors
  return `hsl(${hue}, 65%, 55%)`;
}

export function WorkspaceSidebar({
  workspaceName,
  workspacePath,
  fileTree,
  currentFilePath,
  currentView,
  onFileSelect,
  onCloseWorkspace,
  onOpenQuickSearch,
  onRefreshFileTree,
  onViewHistory,
  onNewPlan,
  onOpenPlansTable,
  onSelectedFolderChange,
  currentAISessionId
}: WorkspaceSidebarProps) {
  const [isFileModalOpen, setIsFileModalOpen] = useState(false);
  const [isFolderModalOpen, setIsFolderModalOpen] = useState(false);
  const [isDragOverRoot, setIsDragOverRoot] = useState(false);
  const [draggedItem, setDraggedItem] = useState<any | null>(null);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [fileTreeFilter, setFileTreeFilter] = useState<FileTreeFilter>('all');
  const [showFileIcons, setShowFileIcons] = useState(true);
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [filterMenuPosition, setFilterMenuPosition] = useState({ x: 0, y: 0 });
  const [sessionFileFilters, setSessionFileFilters] = useState<SessionFileFilterState>({ read: [], written: [] });
  const [gitUncommittedFiles, setGitUncommittedFiles] = useState<string[]>([]);
  const [isGitRepo, setIsGitRepo] = useState(false);
  const filterButtonRef = useRef<HTMLButtonElement>(null);
  const hasLoadedSettingsRef = useRef(false);

  // Load file tree settings from workspace state
  useEffect(() => {
    if (!workspacePath || !window.electronAPI?.invoke) return;

    // Reset loaded flag when workspace changes
    hasLoadedSettingsRef.current = false;

    window.electronAPI.invoke('workspace:get-state', workspacePath)
      .then(state => {
        // Set filter if it exists, otherwise keep default
        if (state?.fileTreeFilter && isValidFileTreeFilter(state.fileTreeFilter)) {
          setFileTreeFilter(state.fileTreeFilter);
        }

        // Set showFileIcons - handle both explicit false and undefined
        if (state?.showFileIcons !== undefined) {
          setShowFileIcons(state.showFileIcons);
        }

        hasLoadedSettingsRef.current = true;
      })
      .catch(error => {
        console.error('Failed to load file tree settings:', error);
        hasLoadedSettingsRef.current = true;
      });
  }, [workspacePath]);

  // Save file tree settings to workspace state
  useEffect(() => {
    // Don't save until we've loaded the initial settings
    if (!hasLoadedSettingsRef.current) return;
    if (!workspacePath || !window.electronAPI?.invoke) return;

    window.electronAPI.invoke('workspace:update-state', workspacePath, {
      fileTreeFilter,
      showFileIcons
    }).catch(error => {
      console.error('Failed to save file tree settings:', error);
    });
  }, [workspacePath, fileTreeFilter, showFileIcons]);

  // Notify parent when selected folder changes
  const handleSelectedFolderChange = (folderPath: string | null) => {
    setSelectedFolder(folderPath);
    onSelectedFolderChange?.(folderPath);
  };

  const handleNewFile = () => {
    // Priority: selected folder > parent of current file > workspace root
    if (selectedFolder) {
      setTargetFolder(selectedFolder);
    } else if (currentFilePath) {
      const parentDir = currentFilePath.substring(0, currentFilePath.lastIndexOf('/'));
      setTargetFolder(parentDir);
    }
    setIsFileModalOpen(true);
  };

  const handleNewFolder = () => {
    // Priority: selected folder > parent of current file > workspace root
    if (selectedFolder) {
      setTargetFolder(selectedFolder);
    } else if (currentFilePath) {
      const parentDir = currentFilePath.substring(0, currentFilePath.lastIndexOf('/'));
      setTargetFolder(parentDir);
    }
    setIsFolderModalOpen(true);
  };

  const [targetFolder, setTargetFolder] = useState<string | null>(null);

  const handleCreateFile = async (fileName: string) => {
    setIsFileModalOpen(false);

    // Ensure it has .md extension
    const fullFileName = fileName.endsWith('.md') || fileName.endsWith('.markdown')
      ? fileName
      : `${fileName}.md`;

    try {
      const basePath = targetFolder || workspacePath;
      const filePath = `${basePath}/${fullFileName}`;
      const content = createInitialFileContent(fullFileName);

      const result = await (window as any).electronAPI?.createFile?.(filePath, content);
      if (result?.success) {
        // Refresh file tree and open the new file
        if (onRefreshFileTree) {
          onRefreshFileTree();
        }
        onFileSelect(filePath);
      } else {
        alert('Failed to create file: ' + (result?.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Failed to create file:', error);
      alert('Failed to create file: ' + error);
    } finally {
      setTargetFolder(null);
    }
  };

  const handleCreateFolder = async (folderName: string) => {
    setIsFolderModalOpen(false);

    try {
      const basePath = targetFolder || workspacePath;
      const folderPath = `${basePath}/${folderName}`;

      const result = await (window as any).electronAPI?.createFolder?.(folderPath);
      if (result?.success) {
        // Refresh file tree
        if (onRefreshFileTree) {
          onRefreshFileTree();
        }
      } else {
        alert('Failed to create folder: ' + (result?.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Failed to create folder:', error);
      alert('Failed to create folder: ' + error);
    } finally {
      setTargetFolder(null);
    }
  };

  const handleNewFileInFolder = (folderPath: string) => {
    setTargetFolder(folderPath);
    setIsFileModalOpen(true);
  };

  const handleNewFolderInFolder = (folderPath: string) => {
    setTargetFolder(folderPath);
    setIsFolderModalOpen(true);
  };

  const handleFileSelect = (filePath: string) => {
    handleSelectedFolderChange(null); // Clear folder selection when a file is selected
    onFileSelect(filePath);
  };

  // Filter menu handlers
  const handleFilterButtonClick = () => {
    if (filterButtonRef.current) {
      const rect = filterButtonRef.current.getBoundingClientRect();
      setFilterMenuPosition({
        x: rect.right + 4,
        y: rect.top
      });
      setShowFilterMenu(true);
    }
  };

  const handleFilterChange = (filter: FileTreeFilter) => {
    setFileTreeFilter(filter);
  };

  const loadClaudeSessionFiles = useCallback(async (sessionId: string | null) => {
    if (!sessionId) {
      setSessionFileFilters({ read: [], written: [] });
      return;
    }

    if (!window.electronAPI?.invoke) {
      return;
    }

    const normalizeResponse = (response: any): string[] => {
      if (!response?.success || !Array.isArray(response.files)) {
        return [];
      }
      const normalizedPaths = response.files
        .map((file: any) => resolveSessionFilePath(file.filePath, workspacePath))
        .filter((value): value is string => Boolean(value));

      return Array.from(new Set(normalizedPaths));
    };

    try {
      const [readResult, writtenResult] = await Promise.all([
        window.electronAPI.invoke('session-files:get-by-session', sessionId, 'read'),
        window.electronAPI.invoke('session-files:get-by-session', sessionId, 'edited')
      ]);

      setSessionFileFilters({
        read: normalizeResponse(readResult),
        written: normalizeResponse(writtenResult)
      });
    } catch (error) {
      console.error('Failed to load Claude session files:', error);
      setSessionFileFilters({ read: [], written: [] });
    }
  }, [workspacePath]);

  useEffect(() => {
    if (!currentAISessionId) {
      setSessionFileFilters({ read: [], written: [] });
      return;
    }

    setSessionFileFilters({ read: [], written: [] });
    loadClaudeSessionFiles(currentAISessionId);
  }, [currentAISessionId, loadClaudeSessionFiles]);

  useEffect(() => {
    if (!currentAISessionId || !window.electronAPI?.on) {
      return;
    }

    const handler = (sessionId: string) => {
      if (sessionId === currentAISessionId) {
        loadClaudeSessionFiles(currentAISessionId);
      }
    };

    const unsubscribe = window.electronAPI.on('session-files:updated', handler);

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [currentAISessionId, loadClaudeSessionFiles]);

  // Check if workspace is a git repository
  useEffect(() => {
    if (!workspacePath || !window.electronAPI?.invoke) {
      setIsGitRepo(false);
      return;
    }

    window.electronAPI.invoke('git:is-repo', workspacePath)
      .then(result => {
        if (result?.success) {
          setIsGitRepo(result.isRepo);
        } else {
          setIsGitRepo(false);
        }
      })
      .catch(error => {
        console.error('Failed to check if git repo:', error);
        setIsGitRepo(false);
      });
  }, [workspacePath]);

  // Load git uncommitted files when filter is active
  const loadGitUncommittedFiles = useCallback(async () => {
    if (!workspacePath || !window.electronAPI?.invoke) {
      setGitUncommittedFiles([]);
      return;
    }

    try {
      const result = await window.electronAPI.invoke('git:get-uncommitted-files', workspacePath);

      if (result?.success && Array.isArray(result.files)) {
        // Files are already absolute paths from the service, just normalize them
        const normalizedFiles = result.files
          .map((file: string) => normalizeFilePath(file))
          .filter((value): value is string => Boolean(value));
        setGitUncommittedFiles(Array.from(new Set(normalizedFiles)));
      } else {
        setGitUncommittedFiles([]);
      }
    } catch (error) {
      console.error('Failed to load git uncommitted files:', error);
      setGitUncommittedFiles([]);
    }
  }, [workspacePath]);

  useEffect(() => {
    if (fileTreeFilter === 'git-uncommitted' && isGitRepo) {
      loadGitUncommittedFiles();
    } else if (!GIT_FILTERS.has(fileTreeFilter)) {
      setGitUncommittedFiles([]);
    }
  }, [fileTreeFilter, isGitRepo, loadGitUncommittedFiles]);

  // Refresh git status when file tree changes (files added/modified/deleted)
  // Debounced to avoid excessive git status calls during rapid file changes
  useEffect(() => {
    if (fileTreeFilter !== 'git-uncommitted' || !isGitRepo) {
      return;
    }

    const timeoutId = setTimeout(() => {
      loadGitUncommittedFiles();
    }, 300); // 300ms debounce

    return () => clearTimeout(timeoutId);
  }, [fileTree, fileTreeFilter, isGitRepo, loadGitUncommittedFiles]);

  const aiReadPathSet = useMemo(() => new Set(sessionFileFilters.read), [sessionFileFilters.read]);
  const aiWrittenPathSet = useMemo(() => new Set(sessionFileFilters.written), [sessionFileFilters.written]);
  const gitUncommittedPathSet = useMemo(() => new Set(gitUncommittedFiles), [gitUncommittedFiles]);

  // Filter file tree based on current filter
  const filterFileTree = useCallback((items: FileTreeItem[], filter: FileTreeFilter): FileTreeItem[] => {
    if (filter === 'all') {
      return items;
    }

    if (CLAUDE_SESSION_FILTERS.has(filter)) {
      const trackedSet = filter === 'ai-read' ? aiReadPathSet : aiWrittenPathSet;
      if (trackedSet.size === 0) {
        return [];
      }

      const filterTrackedItems = (entries: FileTreeItem[]): FileTreeItem[] => {
        return entries.reduce((acc: FileTreeItem[], item) => {
          if (item.type === 'directory') {
            const filteredChildren = item.children ? filterTrackedItems(item.children) : [];
            if (filteredChildren.length > 0) {
              acc.push({
                ...item,
                children: filteredChildren
              });
            }
          } else {
            const normalizedPath = normalizeFilePath(item.path);
            if (trackedSet.has(normalizedPath)) {
              acc.push(item);
            }
          }
          return acc;
        }, []);
      };

      return filterTrackedItems(items);
    }

    if (GIT_FILTERS.has(filter)) {
      if (gitUncommittedPathSet.size === 0) {
        return [];
      }

      const filterGitItems = (entries: FileTreeItem[]): FileTreeItem[] => {
        return entries.reduce((acc: FileTreeItem[], item) => {
          if (item.type === 'directory') {
            const filteredChildren = item.children ? filterGitItems(item.children) : [];
            if (filteredChildren.length > 0) {
              acc.push({
                ...item,
                children: filteredChildren
              });
            }
          } else {
            const normalizedPath = normalizeFilePath(item.path);
            if (gitUncommittedPathSet.has(normalizedPath)) {
              acc.push(item);
            }
          }
          return acc;
        }, []);
      };

      return filterGitItems(items);
    }

    const knownExtensions = ['.md', '.markdown', '.txt', '.json', '.js', '.ts', '.tsx', '.jsx', '.css', '.html', '.xml', '.yaml', '.yml'];

    const shouldIncludeFile = (fileName: string): boolean => {
      const lowerName = fileName.toLowerCase();

      if (filter === 'markdown') {
        return lowerName.endsWith('.md') || lowerName.endsWith('.markdown');
      }

      if (filter === 'known') {
        return knownExtensions.some(ext => lowerName.endsWith(ext));
      }

      return true;
    };

    const filterItems = (entries: FileTreeItem[]): FileTreeItem[] => {
      return entries.reduce((acc: FileTreeItem[], item) => {
        if (item.type === 'directory') {
          const filteredChildren = item.children ? filterItems(item.children) : [];
          // Include directory if it has any matching children
          if (filteredChildren.length > 0) {
            acc.push({
              ...item,
              children: filteredChildren
            });
          }
        } else if (shouldIncludeFile(item.name)) {
          acc.push(item);
        }
        return acc;
      }, []);
    };

    return filterItems(items);
  }, [aiReadPathSet, aiWrittenPathSet, gitUncommittedPathSet]);

  const filteredFileTree = useMemo(
    () => filterFileTree(fileTree, fileTreeFilter),
    [fileTree, fileTreeFilter, filterFileTree]
  );

  const isAISessionFilter = CLAUDE_SESSION_FILTERS.has(fileTreeFilter);
  const hasActiveClaudeSession = Boolean(currentAISessionId);
  const activeClaudeFilterCount = fileTreeFilter === 'ai-read'
    ? aiReadPathSet.size
    : fileTreeFilter === 'ai-written'
      ? aiWrittenPathSet.size
      : 0;
  const shouldShowFilterHint = isAISessionFilter && (!hasActiveClaudeSession || activeClaudeFilterCount === 0);
  const aiFilterHintText = !hasActiveClaudeSession
    ? 'Open a Claude Code session to see which files the agent reads or writes.'
    : fileTreeFilter === 'ai-read'
      ? 'No files have been read by this Claude Code session yet.'
      : 'No files have been written by this Claude Code session yet.';

  // Root folder drag and drop handlers
  const handleRootDragOver = (e: React.DragEvent) => {
    e.preventDefault();

    // Check if we're over a folder or file item - if so, don't handle at root level
    const target = e.target as HTMLElement;
    const overFolderOrFile = target.closest('.file-tree-directory, .file-tree-file');

    if (overFolderOrFile) {
      // We're over a specific folder/file, let FileTree handle it
      setIsDragOverRoot(false);
      return;
    }

    // Get the drag data to check if it's a valid file/folder
    const dragPath = e.dataTransfer.types.includes('text/plain');
    if (dragPath) {
      setIsDragOverRoot(true);
      e.dataTransfer.dropEffect = e.altKey || e.metaKey ? 'copy' : 'move';
    }
  };

  const handleRootDragLeave = (e: React.DragEvent) => {
    // Only clear if we're leaving the root drop zone entirely
    const relatedTarget = e.relatedTarget as HTMLElement;
    const dropZone = e.currentTarget as HTMLElement;
    if (!dropZone.contains(relatedTarget)) {
      setIsDragOverRoot(false);
    }
  };

  const handleRootDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOverRoot(false);

    const sourcePath = e.dataTransfer.getData('text/plain');
    if (!sourcePath) return;

    const isCopy = e.altKey || e.metaKey;

    try {
      if (isCopy) {
        const result = await (window as any).electronAPI.copyFile(sourcePath, workspacePath);
        if (!result.success) {
          console.error('Failed to copy to root:', result.error);
        } else if (onRefreshFileTree) {
          onRefreshFileTree();
        }
      } else {
        const result = await (window as any).electronAPI.moveFile(sourcePath, workspacePath);
        if (!result.success) {
          console.error('Failed to move to root:', result.error);
        } else if (onRefreshFileTree) {
          onRefreshFileTree();
        }
      }
    } catch (error) {
      console.error('Error during drop to root:', error);
    }
  };

  const handleDragStart = (e: React.DragEvent) => {
    // Store the dragged item info for visual feedback
    const dragPath = e.dataTransfer.getData('text/plain');
    setDraggedItem({ path: dragPath });
  };

  const handleDragEnd = () => {
    setDraggedItem(null);
    setIsDragOverRoot(false);
  };

  const workspaceColor = generateWorkspaceColor(workspacePath);

  return (
    <div className="workspace-sidebar"
      onDragOver={handleRootDragOver}
      onDragLeave={handleRootDragLeave}
      onDrop={handleRootDrop}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="workspace-color-accent" style={{ backgroundColor: workspaceColor }} />
      <div className="workspace-sidebar-header">
        <div className="workspace-identity">
          <h3 className="workspace-name">{workspaceName}</h3>
          <div className="workspace-path" title={workspacePath}>
            {workspacePath}
          </div>
        </div>
        <div className="workspace-sidebar-actions">
          {currentView === 'files' && (
            <>
              <button
                className="workspace-action-button"
                onClick={handleNewFile}
                title="New file"
                aria-label="New file"
              >
                <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
                  edit_square
                </span>
              </button>
              <button
                className="workspace-action-button"
                onClick={handleNewFolder}
                title="New folder"
                aria-label="New folder"
              >
                <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
                  create_new_folder
                </span>
              </button>
              {onOpenQuickSearch && (
                <button
                  className="workspace-action-button"
                  onClick={onOpenQuickSearch}
                  title="Search files (⌘K)"
                  aria-label="Search files"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
                    search
                  </span>
                </button>
              )}
              <button
                ref={filterButtonRef}
                className="workspace-action-button"
                onClick={handleFilterButtonClick}
                title="Filter files"
                aria-label="Filter files"
              >
                <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
                  more_vert
                </span>
              </button>
            </>
          )}
          {currentView === 'plans' && (
            <>
              {onNewPlan && (
                <button
                  className="workspace-action-button"
                  onClick={onNewPlan}
                  title="New plan"
                  aria-label="New plan"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
                    note_add
                  </span>
                </button>
              )}
              {onOpenPlansTable && (
                <button
                  className="workspace-action-button"
                  onClick={onOpenPlansTable}
                  title="Open planning table"
                  aria-label="Open planning table"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
                    table_view
                  </span>
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {currentView === 'files' ? (
        <>
          <div className="workspace-section-label">Files</div>
          <div className={`workspace-file-tree ${isDragOverRoot ? 'drag-over-root' : ''}`}>
            {shouldShowFilterHint && (
              <div className="file-tree-filter-hint">
                {aiFilterHintText}
              </div>
            )}
            <FileTree
              items={filteredFileTree}
              currentFilePath={currentFilePath}
              onFileSelect={handleFileSelect}
              level={0}
              showIcons={showFileIcons}
              onNewFile={handleNewFileInFolder}
              onNewFolder={handleNewFolderInFolder}
              onRefreshFileTree={onRefreshFileTree}
              onViewHistory={onViewHistory}
              selectedFolder={selectedFolder}
              onFolderSelect={handleSelectedFolderChange}
            />
            {isDragOverRoot && (
              <div className="root-drop-indicator">
                Drop here to move to workspace root
              </div>
            )}
          </div>
          {showFilterMenu && (
            <FileTreeFilterMenu
              x={filterMenuPosition.x}
              y={filterMenuPosition.y}
              currentFilter={fileTreeFilter}
              showIcons={showFileIcons}
              onFilterChange={handleFilterChange}
              onShowIconsChange={setShowFileIcons}
              hasActiveClaudeSession={hasActiveClaudeSession}
              claudeSessionFileCounts={{
                read: sessionFileFilters.read.length,
                written: sessionFileFilters.written.length
              }}
              isGitRepo={isGitRepo}
              gitUncommittedCount={gitUncommittedFiles.length}
              onClose={() => setShowFilterMenu(false)}
            />
          )}
        </>
      ) : (
        <PlansPanel
          currentFilePath={currentFilePath}
          onPlanSelect={onFileSelect}
        />
      )}

      <InputModal
        isOpen={isFileModalOpen}
        title={targetFolder ? `New File in ${targetFolder.split('/').pop()}` : "New File"}
        placeholder="Enter file name (e.g., document.md)"
        defaultValue=""
        onConfirm={handleCreateFile}
        onCancel={() => {
          setIsFileModalOpen(false);
          setTargetFolder(null);
        }}
      />

      <InputModal
        isOpen={isFolderModalOpen}
        title={targetFolder ? `New Folder in ${targetFolder.split('/').pop()}` : "New Folder"}
        placeholder="Enter folder name"
        defaultValue=""
        onConfirm={handleCreateFolder}
        onCancel={() => {
          setIsFolderModalOpen(false);
          setTargetFolder(null);
        }}
      />
    </div>
  );
}
