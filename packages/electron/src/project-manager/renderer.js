const { ipcRenderer } = require('electron');
const path = require('path');
const fs = require('fs');

let recentProjects = [];
let selectedProject = null;

// Initialize
async function init() {
  // Apply theme
  const theme = await ipcRenderer.invoke('get-theme');
  applyTheme(theme);
  
  // Load recent projects
  await loadRecentProjects();
  
  // Listen for theme changes
  ipcRenderer.on('theme-change', (event, theme) => {
    applyTheme(theme);
  });
}

// Apply theme
function applyTheme(theme) {
  if (theme === 'dark' || theme === 'crystal-dark') {
    document.body.classList.add('dark');
  } else {
    document.body.classList.remove('dark');
  }
}

// Load recent projects
async function loadRecentProjects() {
  try {
    recentProjects = await ipcRenderer.invoke('project-manager:get-recent-projects');
    renderProjectList();
  } catch (error) {
    console.error('Failed to load recent projects:', error);
  }
}

// Render project list
function renderProjectList() {
  const container = document.getElementById('projectList');
  
  if (recentProjects.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px 20px; color: #9ca3af;">
        <p style="font-size: 14px;">No recent projects</p>
        <p style="font-size: 12px; margin-top: 8px;">Open a folder to get started</p>
      </div>
    `;
    return;
  }
  
  container.innerHTML = recentProjects.map(project => {
    const isSelected = selectedProject && selectedProject.path === project.path;
    const lastModified = project.lastModified ? formatDate(project.lastModified) : 'Unknown';
    const fileCount = project.fileCount || 0;
    
    return `
      <div class="project-item ${isSelected ? 'selected' : ''}" data-path="${escapeHtml(project.path)}">
        <div class="project-name">${escapeHtml(project.name)}</div>
        <div class="project-path">${escapeHtml(project.path)}</div>
        <div class="project-meta">
          <span>${fileCount} files</span>
          <span>•</span>
          <span>${lastModified}</span>
        </div>
      </div>
    `;
  }).join('');
  
  // Add click handlers
  container.querySelectorAll('.project-item').forEach(item => {
    item.addEventListener('click', () => {
      const projectPath = item.dataset.path;
      const project = recentProjects.find(p => p.path === projectPath);
      if (project) {
        selectProject(project);
      }
    });
  });
}

// Select a project
async function selectProject(project) {
  selectedProject = project;
  
  // Update UI
  document.querySelectorAll('.project-item').forEach(item => {
    item.classList.remove('selected');
    if (item.dataset.path === project.path) {
      item.classList.add('selected');
    }
  });
  
  // Get project stats
  const stats = await getProjectStats(project.path);
  
  // Show project preview
  showProjectPreview(project, stats);
}

// Get project statistics
async function getProjectStats(projectPath) {
  try {
    const stats = await ipcRenderer.invoke('project-manager:get-project-stats', projectPath);
    return stats;
  } catch (error) {
    console.error('Failed to get project stats:', error);
    return {
      fileCount: 0,
      totalSize: 0,
      recentFiles: []
    };
  }
}

// Show project preview
function showProjectPreview(project, stats) {
  const rightPanel = document.getElementById('rightPanel');
  
  // Format file size
  const formatSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };
  
  rightPanel.innerHTML = `
    <div class="project-preview">
      <div class="preview-header">
        <div>
          <h2 class="preview-title">${escapeHtml(project.name)}</h2>
          <p class="preview-path">${escapeHtml(project.path)}</p>
        </div>
        <button class="remove-btn" onclick="removeFromRecent('${escapeHtml(project.path)}')" title="Remove from recent">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
          </svg>
        </button>
      </div>
      
      <div class="preview-stats">
        <div class="stat-item">
          <div class="stat-value">${stats.fileCount || 0}</div>
          <div class="stat-label">Files</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${stats.markdownCount || 0}</div>
          <div class="stat-label">Markdown</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${formatSize(stats.totalSize || 0)}</div>
          <div class="stat-label">Size</div>
        </div>
      </div>
      
      ${stats.recentFiles && stats.recentFiles.length > 0 ? `
        <div style="margin-bottom: 24px;">
          <div class="section-title" style="margin-bottom: 12px;">Recent Files</div>
          <div style="display: flex; flex-direction: column; gap: 8px;">
            ${stats.recentFiles.slice(0, 5).map(file => `
              <div style="padding: 8px 12px; background: #f9fafb; border-radius: 6px; font-size: 13px; color: #374151;">
                ${escapeHtml(path.basename(file))}
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
      
      <div class="preview-actions">
        <button class="btn btn-primary" onclick="openProject('${escapeHtml(project.path)}')">
          Open Project
        </button>
      </div>
    </div>
  `;
}

// Open folder dialog
async function openFolder() {
  try {
    const result = await ipcRenderer.invoke('project-manager:open-folder-dialog');
    if (result.success && result.path) {
      await openProject(result.path);
    }
  } catch (error) {
    console.error('Failed to open folder:', error);
  }
}

// Create new project
async function createNewProject() {
  try {
    const result = await ipcRenderer.invoke('project-manager:create-project-dialog');
    if (result.success && result.path) {
      await openProject(result.path);
    }
  } catch (error) {
    console.error('Failed to create project:', error);
  }
}

// Open project (always in new window)
async function openProject(projectPath) {
  try {
    await ipcRenderer.invoke('project-manager:open-project', projectPath);
    // Close the project manager after opening
    window.close();
  } catch (error) {
    console.error('Failed to open project:', error);
  }
}

// Remove from recent
async function removeFromRecent(projectPath) {
  if (!confirm('Remove this project from recent projects?')) {
    return;
  }
  
  try {
    await ipcRenderer.invoke('project-manager:remove-recent', projectPath);
    await loadRecentProjects();
    
    // Clear preview if this was selected
    if (selectedProject && selectedProject.path === projectPath) {
      selectedProject = null;
      document.getElementById('rightPanel').innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">
            <svg viewBox="0 0 24 24">
              <path d="M10 4H4c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2h-8l-2-2z"/>
            </svg>
          </div>
          <h2 class="empty-title">Project Removed</h2>
          <p class="empty-description">Select another project from the list or open a new folder.</p>
        </div>
      `;
    }
  } catch (error) {
    console.error('Failed to remove from recent:', error);
  }
}

// Format date
function formatDate(timestamp) {
  if (!timestamp) return 'Unknown';
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;
  
  if (diff < 3600000) {
    const mins = Math.floor(diff / 60000);
    return mins <= 1 ? 'Just now' : `${mins} mins ago`;
  }
  
  if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000);
    return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
  }
  
  if (diff < 604800000) {
    const days = Math.floor(diff / 86400000);
    return `${days} day${days !== 1 ? 's' : ''} ago`;
  }
  
  return date.toLocaleDateString();
}

// Escape HTML
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Make functions available globally
window.openFolder = openFolder;
window.createNewProject = createNewProject;
window.openProject = openProject;
window.removeFromRecent = removeFromRecent;

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', init);