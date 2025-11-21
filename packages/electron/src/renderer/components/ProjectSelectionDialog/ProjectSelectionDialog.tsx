import React, { useState, useEffect } from 'react';
import { getFileName } from '../../utils/pathUtils';
import './ProjectSelectionDialog.css';

export interface ProjectOption {
  path: string;
  name: string;
}

export interface ProjectSelectionDialogProps {
  isOpen: boolean;
  fileName: string;
  suggestedWorkspace?: string;
  onSelectProject: (projectPath: string) => void;
  onCancel: () => void;
}

export const ProjectSelectionDialog: React.FC<ProjectSelectionDialogProps> = ({
  isOpen,
  fileName,
  suggestedWorkspace,
  onSelectProject,
  onCancel
}) => {
  const [recentProjects, setRecentProjects] = useState<ProjectOption[]>([]);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadRecentProjects();
    }
  }, [isOpen]);

  const loadRecentProjects = async () => {
    try {
      const projects = await window.electronAPI.invoke('get-recent-workspaces');
      setRecentProjects(projects || []);

      // Pre-select suggested workspace if provided
      if (suggestedWorkspace) {
        setSelectedProject(suggestedWorkspace);
      }
    } catch (err) {
      console.error('Failed to load recent projects:', err);
      setRecentProjects([]);
    }
  };

  const handleBrowse = async () => {
    try {
      const result = await window.electronAPI.invoke('dialog-show-open-dialog', {
        properties: ['openDirectory', 'createDirectory']
      });

      if (!result.canceled && result.filePaths.length > 0) {
        onSelectProject(result.filePaths[0]);
      }
    } catch (err) {
      console.error('Failed to browse for project:', err);
    }
  };

  const handleCreateNew = async () => {
    try {
      const result = await window.electronAPI.invoke('dialog-show-open-dialog', {
        properties: ['openDirectory', 'createDirectory'],
        title: 'Create New Project',
        buttonLabel: 'Create Project'
      });

      if (!result.canceled && result.filePaths.length > 0) {
        onSelectProject(result.filePaths[0]);
      }
    } catch (err) {
      console.error('Failed to create new project:', err);
    }
  };

  const handleUseSuggested = () => {
    if (suggestedWorkspace) {
      onSelectProject(suggestedWorkspace);
    }
  };

  const handleUseSelected = () => {
    if (selectedProject) {
      onSelectProject(selectedProject);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="project-selection-dialog-overlay" onClick={onCancel}>
      <div className="project-selection-dialog" onClick={(e) => e.stopPropagation()}>
        <h2 className="project-selection-dialog-title">Select a Project</h2>
        <p className="project-selection-dialog-message">
          The file <strong>{fileName}</strong> is not in a known project.
          {suggestedWorkspace && ' A potential project folder was detected.'}
        </p>

        {suggestedWorkspace && (
          <div className="project-selection-suggested">
            <h3 className="project-selection-section-title">Suggested Project</h3>
            <div className="project-selection-suggested-item">
              <div className="project-selection-item-name">
                {getFileName(suggestedWorkspace)}
              </div>
              <div className="project-selection-item-path">{suggestedWorkspace}</div>
            </div>
            <button
              className="project-selection-button project-selection-button-primary"
              onClick={handleUseSuggested}
            >
              Use This Project
            </button>
          </div>
        )}

        {recentProjects.length > 0 && (
          <div className="project-selection-recent">
            <h3 className="project-selection-section-title">Recent Projects</h3>
            <div className="project-selection-list">
              {recentProjects.map((project) => (
                <div
                  key={project.path}
                  className={`project-selection-item ${selectedProject === project.path ? 'selected' : ''}`}
                  onClick={() => setSelectedProject(project.path)}
                >
                  <div className="project-selection-item-name">{project.name}</div>
                  <div className="project-selection-item-path">{project.path}</div>
                </div>
              ))}
            </div>
            <button
              className="project-selection-button project-selection-button-primary"
              onClick={handleUseSelected}
              disabled={!selectedProject}
            >
              Use Selected Project
            </button>
          </div>
        )}

        <div className="project-selection-actions">
          <button
            className="project-selection-button project-selection-button-secondary"
            onClick={handleBrowse}
          >
            Browse for Project...
          </button>
          <button
            className="project-selection-button project-selection-button-secondary"
            onClick={handleCreateNew}
          >
            Create New Project...
          </button>
        </div>

        <div className="project-selection-footer">
          <button
            className="project-selection-button project-selection-button-cancel"
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
