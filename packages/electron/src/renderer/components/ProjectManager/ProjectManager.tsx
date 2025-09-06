import React, { useState, useEffect } from 'react';
import './ProjectManager.css';

// Apply theme to document on mount
if (typeof window !== 'undefined') {
  // Get theme from localStorage or system preference
  const savedTheme = localStorage.getItem('theme');
  const root = document.documentElement;

  if (savedTheme === 'dark' || savedTheme === 'crystal-dark') {
    root.setAttribute('data-theme', savedTheme);
  } else if (savedTheme === 'light') {
    root.setAttribute('data-theme', 'light');
  } else {
    // Auto - check system preference
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  }
}

interface ProjectInfo {
  path: string;
  name: string;
  lastOpened: number | string;
  lastModified?: number | string;
  fileCount?: number;
  markdownCount?: number;
  exists: boolean;
}

interface ProjectStats {
  fileCount: number;
  markdownCount: number;
  totalSize: number;
  recentFiles: string[];
}

export const ProjectManager: React.FC = () => {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [selectedProject, setSelectedProject] = useState<ProjectInfo | null>(null);
  const [projectStats, setProjectStats] = useState<ProjectStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadProjects();
  }, []);

  useEffect(() => {
    if (selectedProject) {
      loadProjectStats(selectedProject.path);
    }
  }, [selectedProject]);

  const loadProjects = async () => {
    try {
      const recentProjects = await window.electronAPI.projectManager.getRecentProjects();
      console.log('Loaded projects:', recentProjects);
      setProjects(recentProjects);
      if (recentProjects.length > 0) {
        setSelectedProject(recentProjects[0]);
      }
    } catch (error) {
      console.error('Failed to load projects:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadProjectStats = async (projectPath: string) => {
    try {
      const stats = await window.electronAPI.projectManager.getProjectStats(projectPath);
      setProjectStats(stats);
    } catch (error) {
      console.error('Failed to load project stats:', error);
    }
  };

  const handleOpenProject = async () => {
    if (!selectedProject) return;

    try {
      await window.electronAPI.projectManager.openProject(selectedProject.path);
    } catch (error) {
      console.error('Failed to open project:', error);
    }
  };

  const handleBrowse = async () => {
    try {
      const result = await window.electronAPI.projectManager.openFolderDialog();
      if (result.success) {
        await window.electronAPI.projectManager.openProject(result.path);
      }
    } catch (error) {
      console.error('Failed to browse for project:', error);
    }
  };

  const handleCreateProject = async () => {
    try {
      const result = await window.electronAPI.projectManager.createProjectDialog();
      if (result.success) {
        await window.electronAPI.projectManager.openProject(result.path);
      }
    } catch (error) {
      console.error('Failed to create project:', error);
    }
  };

  const handleRemoveFromRecent = async () => {
    if (!selectedProject) return;

    try {
      await window.electronAPI.projectManager.removeRecent(selectedProject.path);
      await loadProjects();
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

  return (
    <div className="project-manager">
      <div className="sidebar">
        <div className="sidebar-header">
          <div className="app-branding">
            <img src="./icon.png" alt="Preditor" className="app-logo" />
            <h2>Preditor</h2>
          </div>
          <div className="action-buttons">
            <button className="btn btn-primary" onClick={handleBrowse}>
              Open Folder
            </button>
          </div>
        </div>

        <div className="projects-list">
          {loading ? (
            <div className="loading">
              <div className="spinner"></div>
            </div>
          ) : projects.length === 0 ? (
            <div className="sidebar-empty">
              <p>No recent projects</p>
            </div>
          ) : (
            projects.map(project => (
              <div
                key={project.path}
                className={`project-item ${selectedProject?.path === project.path ? 'selected' : ''}`}
                onClick={() => setSelectedProject(project)}
                onDoubleClick={handleOpenProject}
              >
                <div className="project-icon">
                  <span className="material-symbols-outlined">folder</span>
                </div>
                <div className="project-info">
                  <div className="project-name">{project.name}</div>
                  <div className="project-path">{project.path}</div>
                  <div className="project-meta">
                    {project.markdownCount !== undefined && (
                      <span>{project.markdownCount} markdown files</span>
                    )}
                    <span>{formatDate(project.lastOpened)}</span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="content">
        {selectedProject ? (
          <>
            <div className="content-header">
              <div className="project-title">
                <h1>{selectedProject.name}</h1>
                <div className="project-path">{selectedProject.path}</div>
              </div>
              <div className="content-actions">
                <button className="btn btn-primary" onClick={handleOpenProject}>
                  Open Project
                </button>
                <button className="btn btn-danger" onClick={handleRemoveFromRecent}>
                  Remove from Recent
                </button>
              </div>
            </div>

            <div className="project-details">
              {projectStats ? (
                <>
                  <div className="stats-grid">
                    <div className="stat-card">
                      <div className="stat-value">{projectStats.fileCount}</div>
                      <div className="stat-label">Total Files</div>
                    </div>
                    <div className="stat-card">
                      <div className="stat-value">{projectStats.markdownCount}</div>
                      <div className="stat-label">Markdown Files</div>
                    </div>
                    <div className="stat-card">
                      <div className="stat-value">{formatSize(projectStats.totalSize)}</div>
                      <div className="stat-label">Total Size</div>
                    </div>
                    <div className="stat-card">
                      <div className="stat-value">{formatDate(selectedProject.lastOpened)}</div>
                      <div className="stat-label">Last Opened</div>
                    </div>
                  </div>

                  {projectStats.recentFiles.length > 0 && (
                    <div className="recent-files">
                      <h3>Recent Files</h3>
                      <ul>
                        {projectStats.recentFiles.map(file => (
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
                <img src="./icon.png" alt="Preditor" className="welcome-logo" />
                <div className="welcome-text">
                  <h1 className="welcome-title">Preditor</h1>
                  <p className="welcome-subtitle">AI-native markdown editor</p>
                </div>
              </div>

              <div className="welcome-info-compact">
                <p className="welcome-description">
                  Projects are local folders on your computer. Open any folder to view and edit all markdown files within it.
                </p>
              </div>

              <div className="welcome-actions">
                <button className="btn btn-large btn-gradient" onClick={handleBrowse}>
                  <span className="material-symbols-outlined">folder_open</span>
                  Open Folder
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
