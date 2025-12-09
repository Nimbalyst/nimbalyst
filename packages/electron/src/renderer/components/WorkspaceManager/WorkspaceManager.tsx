import React, { useState, useEffect } from 'react';
import './WorkspaceManager.css';

// Helper function to apply theme
const applyTheme = () => {
  if (typeof window === 'undefined') return;

  const savedTheme = localStorage.getItem('theme');
  const root = document.documentElement;

  // Clear all theme classes first
  root.classList.remove('light-theme', 'dark-theme', 'crystal-dark-theme');

  if (savedTheme === 'dark') {
    root.setAttribute('data-theme', 'dark');
    root.classList.add('dark-theme');
  } else if (savedTheme === 'crystal-dark') {
    root.setAttribute('data-theme', 'crystal-dark');
    root.classList.add('crystal-dark-theme');
  } else if (savedTheme === 'light') {
    root.setAttribute('data-theme', 'light');
    root.classList.add('light-theme');
  } else {
    // Auto - check system preference
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (prefersDark) {
      root.setAttribute('data-theme', 'dark');
      root.classList.add('dark-theme');
    } else {
      root.setAttribute('data-theme', 'light');
      root.classList.add('light-theme');
    }
  }
};

// Apply theme on mount
applyTheme();

// Listen for theme changes
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === 'theme') {
      applyTheme();
    }
  });

  // Also listen for IPC theme changes
  if (window.electronAPI?.onThemeChange) {
    const unsubscribe = window.electronAPI.onThemeChange((theme) => {
      // Guard: skip if unchanged
      if (localStorage.getItem('theme') === theme) return;
      // Update localStorage with the new theme
      localStorage.setItem('theme', theme);
      applyTheme();
    });
    // Note: unsubscribe is returned but we're not cleaning it up since this is module-level
  }
}

interface WorkspaceInfo {
  path: string;
  name: string;
  lastOpened: number | string;
  lastModified?: number | string;
  fileCount?: number;
  markdownCount?: number;
  exists: boolean;
}

interface WorkspaceStats {
  fileCount: number;
  markdownCount: number;
  totalSize: number;
  recentFiles: string[];
}

export const WorkspaceManager: React.FC = () => {
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [selectedWorkspace, setSelectedWorkspace] = useState<WorkspaceInfo | null>(null);
  const [workspaceStats, setWorkspaceStats] = useState<WorkspaceStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  useEffect(() => {
    loadWorkspaces();
  }, []);

  useEffect(() => {
    if (selectedWorkspace) {
      loadWorkspaceStats(selectedWorkspace.path);
    }
  }, [selectedWorkspace]);

  // Auto-select first item when search query changes or results update
  useEffect(() => {
    if (filteredWorkspaces.length > 0) {
      setHighlightedIndex(0);
      setSelectedWorkspace(filteredWorkspaces[0]);
    } else {
      setHighlightedIndex(-1);
      setSelectedWorkspace(null);
    }
  }, [searchQuery]);

  // Score and filter workspaces based on search query
  // Higher score = better match, prioritizing name matches over path matches
  const scoreWorkspace = (workspace: WorkspaceInfo, query: string): number => {
    const name = workspace.name.toLowerCase();
    const path = workspace.path.toLowerCase();
    const q = query.toLowerCase();

    // Exact name match (highest priority)
    if (name === q) return 100;

    // Name starts with query (prefix match)
    if (name.startsWith(q)) return 80;

    // Name contains query at word boundary (e.g., "My-JSVault" matches "js")
    const wordBoundaryRegex = new RegExp(`(?:^|[\\s_-])${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
    if (wordBoundaryRegex.test(name)) return 60;

    // Name contains query anywhere
    if (name.includes(q)) return 40;

    // Path contains query
    if (path.includes(q)) return 20;

    // No match
    return 0;
  };

  const filteredWorkspaces = workspaces
    .map(workspace => ({
      workspace,
      score: searchQuery ? scoreWorkspace(workspace, searchQuery) : 1
    }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ workspace }) => workspace);

  const loadWorkspaces = async () => {
    try {
      const recentWorkspaces = await window.electronAPI.workspaceManager.getRecentWorkspaces();
      console.log('Loaded workspaces:', recentWorkspaces);
      setWorkspaces(recentWorkspaces);
      // Don't auto-select first workspace - show welcome pane instead
    } catch (error) {
      console.error('Failed to load workspaces:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadWorkspaceStats = async (workspacePath: string) => {
    try {
      const stats = await window.electronAPI.workspaceManager.getWorkspaceStats(workspacePath);
      setWorkspaceStats(stats);
    } catch (error) {
      console.error('Failed to load workspace stats:', error);
    }
  };

  const handleOpenWorkspace = async () => {
    if (!selectedWorkspace) return;

    try {
      await window.electronAPI.workspaceManager.openWorkspace(selectedWorkspace.path);
    } catch (error) {
      console.error('Failed to open workspace:', error);
    }
  };

  const handleBrowse = async () => {
    try {
      const result = await window.electronAPI.workspaceManager.openFolderDialog();
      if (result.success) {
        await window.electronAPI.workspaceManager.openWorkspace(result.path);
      }
    } catch (error) {
      console.error('Failed to browse for workspace:', error);
    }
  };

  const handleCreateWorkspace = async () => {
    try {
      const result = await window.electronAPI.workspaceManager.createWorkspaceDialog();
      if (result.success) {
        await window.electronAPI.workspaceManager.openWorkspace(result.path);
      }
    } catch (error) {
      console.error('Failed to create workspace:', error);
    }
  };

  const handleRemoveFromRecent = async () => {
    if (!selectedWorkspace) return;

    try {
      await window.electronAPI.workspaceManager.removeRecent(selectedWorkspace.path);
      await loadWorkspaces();
    } catch (error) {
      console.error('Failed to remove from recent:', error);
    }
  };

  const formatDate = (timestamp: number | string | undefined) => {
    if (!timestamp) {
      return 'Unknown';
    }

    // Convert string to number if needed
    let ts = typeof timestamp === 'string' ? parseInt(timestamp, 10) : timestamp;

    // If timestamp is in seconds (Unix timestamp), convert to milliseconds
    // Unix timestamps are typically 10 digits, JS timestamps are 13
    if (ts && ts < 10000000000) {
      ts = ts * 1000;
    }

    if (!ts || isNaN(ts) || ts === 0) {
      return 'Unknown';
    }

    const date = new Date(ts);

    // Check if date is valid
    if (isNaN(date.getTime())) {
      return 'Never';
    }

    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days < 0) {
      return date.toLocaleDateString();
    } else if (days === 0) {
      return 'Today';
    } else if (days === 1) {
      return 'Yesterday';
    } else if (days < 7) {
      return `${days} days ago`;
    } else if (days < 30) {
      const weeks = Math.floor(days / 7);
      return `${weeks} week${weeks > 1 ? 's' : ''} ago`;
    } else {
      return date.toLocaleDateString();
    }
  };

  const formatSize = (bytes: number) => {
    // Validate bytes
    if (!bytes || isNaN(bytes) || bytes < 0) {
      return '0 B';
    }

    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (filteredWorkspaces.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex(prev => {
          const next = prev < filteredWorkspaces.length - 1 ? prev + 1 : prev;
          if (next !== -1) {
            setSelectedWorkspace(filteredWorkspaces[next]);
          }
          return next;
        });
        break;

      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex(prev => {
          const next = prev > 0 ? prev - 1 : 0;
          setSelectedWorkspace(filteredWorkspaces[next]);
          return next;
        });
        break;

      case 'Enter':
        e.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex < filteredWorkspaces.length) {
          const workspace = filteredWorkspaces[highlightedIndex];
          window.electronAPI.workspaceManager.openWorkspace(workspace.path);
        } else if (selectedWorkspace) {
          handleOpenWorkspace();
        }
        break;

      case 'Escape':
        e.preventDefault();
        setSearchQuery('');
        setHighlightedIndex(-1);
        break;
    }
  };

  return (
    <div className="workspace-manager">
      <div className="sidebar">
        <div className="sidebar-header">
          <div className="app-branding">
            <img src="./icon.png" alt="Nimbalyst" className="app-logo" />
            <h2>Nimbalyst</h2>
          </div>
          <div className="action-buttons">
            <button className="btn btn-primary" onClick={handleBrowse}>
              Open Folder
            </button>
            <button className="btn btn-secondary" onClick={handleCreateWorkspace}>
              New Folder
            </button>
          </div>
        </div>

        <div className="workspaces-list">
          {!loading && workspaces.length > 0 && (
            <div className="search-container">
              <input
                type="text"
                className="workspace-search"
                placeholder="Search projects..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                autoFocus
              />
            </div>
          )}

          {loading ? (
            <div className="loading">
              <div className="spinner"></div>
            </div>
          ) : workspaces.length === 0 ? (
            <div className="sidebar-empty">
              <p>No recent projects</p>
            </div>
          ) : filteredWorkspaces.length === 0 ? (
            <div className="sidebar-empty">
              <p>No matching projects</p>
            </div>
          ) : (
            filteredWorkspaces.map((workspace, index) => (
              <div
                key={workspace.path}
                className={`workspace-item ${selectedWorkspace?.path === workspace.path ? 'selected' : ''} ${highlightedIndex === index ? 'highlighted' : ''}`}
                onClick={(e) => {
                  // Command/Ctrl + click to deselect
                  if (e.metaKey || e.ctrlKey) {
                    if (selectedWorkspace?.path === workspace.path) {
                      setSelectedWorkspace(null);
                    }
                  } else {
                    setSelectedWorkspace(workspace);
                  }
                  setHighlightedIndex(index);
                }}
                onDoubleClick={handleOpenWorkspace}
              >
                <div className="workspace-icon">
                  <span className="material-symbols-outlined">folder</span>
                </div>
                <div className="workspace-info">
                  <div className="workspace-name">{workspace.name}</div>
                  <div className="workspace-path">{workspace.path}</div>
                  <div className="workspace-meta">
                    {workspace.markdownCount !== undefined && (
                      <span>{workspace.markdownCount} markdown files</span>
                    )}
                    <span>{formatDate(workspace.lastOpened)}</span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="content">
        {selectedWorkspace ? (
          <>
            <div className="content-header">
              <div className="workspace-title">
                <h1>{selectedWorkspace.name}</h1>
                <div className="workspace-path">{selectedWorkspace.path}</div>
              </div>
              <div className="content-actions">
                <button className="btn btn-primary" onClick={handleOpenWorkspace}>
                  Open Project
                </button>
                <button className="btn btn-danger" onClick={handleRemoveFromRecent}>
                  Remove from Recent
                </button>
              </div>
            </div>

            <div className="workspace-details">
              {workspaceStats ? (
                <>
                  <div className="stats-grid">
                    <div className="stat-card">
                      <div className="stat-value">{workspaceStats.fileCount}</div>
                      <div className="stat-label">Total Files</div>
                    </div>
                    <div className="stat-card">
                      <div className="stat-value">{workspaceStats.markdownCount}</div>
                      <div className="stat-label">Markdown Files</div>
                    </div>
                    <div className="stat-card">
                      <div className="stat-value">{formatSize(workspaceStats.totalSize)}</div>
                      <div className="stat-label">Total Size</div>
                    </div>
                    <div className="stat-card">
                      <div className="stat-value">{formatDate(selectedWorkspace.lastOpened)}</div>
                      <div className="stat-label">Last Opened</div>
                    </div>
                  </div>

                  {workspaceStats.recentFiles.length > 0 && (
                    <div className="recent-files">
                      <h3>Recent Files</h3>
                      <ul>
                        {workspaceStats.recentFiles.map(file => (
                          <li key={file}>
                            <span className="material-symbols-outlined">description</span>
                            {file}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              ) : (
                <div className="loading">
                  <div className="spinner"></div>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="welcome-container">
            <div className="welcome-content">
              <div className="welcome-header">
                <img src="./icon.png" alt="Nimbalyst" className="welcome-logo" />
                <div className="welcome-text">
                  <h1 className="welcome-title">Nimbalyst</h1>
                  <p className="welcome-subtitle">AI-native markdown editor</p>
                </div>
              </div>

              <div className="welcome-info-compact">
                <p className="welcome-description">
                  Projects are local folders on your computer. Open any folder to view and edit all markdown files within it.
                </p>
              </div>

              <div className="welcome-actions">
                <button className="btn btn-large btn-welcome-primary" onClick={handleBrowse}>
                  <span className="material-symbols-outlined">folder_open</span>
                  Open Folder
                </button>
                <button className="btn btn-large btn-welcome-secondary" onClick={handleCreateWorkspace}>
                  <span className="material-symbols-outlined">create_new_folder</span>
                  New Folder
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
