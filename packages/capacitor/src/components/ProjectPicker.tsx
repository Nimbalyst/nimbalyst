import React from 'react';
import type { Project } from '../contexts/CollabV3SyncContext';

interface ProjectPickerProps {
  projects: Project[];
  selectedProject: Project | null;
  onSelectProject: (project: Project | null) => void;
  onClose: () => void;
  showAllProjects?: boolean;
}

export function ProjectPicker({ projects, selectedProject, onSelectProject, onClose, showAllProjects = true }: ProjectPickerProps) {
  const handleSelect = (project: Project | null) => {
    onSelectProject(project);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black bg-opacity-50"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-nim rounded-t-2xl shadow-xl max-h-[70vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--nim-border)]">
          <h2 className="text-lg font-semibold text-[var(--nim-text)]">Select Project</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-[var(--nim-bg-tertiary)] text-[var(--nim-text-muted)]"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18"/>
              <path d="m6 6 12 12"/>
            </svg>
          </button>
        </div>

        {/* Project List */}
        <div className="overflow-auto max-h-[calc(70vh-60px)]">
          {/* All Projects Option */}
          {showAllProjects && <button
            onClick={() => handleSelect(null)}
            className={`w-full flex items-center justify-between px-4 py-3 border-b border-[var(--nim-border)] hover:bg-[var(--nim-bg-hover)] transition-colors ${
              !selectedProject ? 'bg-[var(--nim-bg-secondary)]' : ''
            }`}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-[var(--nim-primary)] flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect width="7" height="9" x="3" y="3" rx="1"/>
                  <rect width="7" height="5" x="14" y="3" rx="1"/>
                  <rect width="7" height="9" x="14" y="12" rx="1"/>
                  <rect width="7" height="5" x="3" y="16" rx="1"/>
                </svg>
              </div>
              <div className="text-left">
                <div className="font-medium text-[var(--nim-text)]">All Projects</div>
                <div className="text-sm text-[var(--nim-text-muted)]">
                  {projects.reduce((sum, p) => sum + p.sessionCount, 0)} sessions
                </div>
              </div>
            </div>
            {!selectedProject && (
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--nim-primary)]">
                <path d="M20 6 9 17l-5-5"/>
              </svg>
            )}
          </button>}

          {/* Individual Projects */}
          {projects.map((project) => (
            <button
              key={project.id}
              onClick={() => handleSelect(project)}
              className={`w-full flex items-center justify-between px-4 py-3 border-b border-[var(--nim-border)] hover:bg-[var(--nim-bg-hover)] transition-colors ${
                selectedProject?.id === project.id ? 'bg-[var(--nim-bg-secondary)]' : ''
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-[var(--nim-bg-tertiary)] flex items-center justify-center">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/>
                    <path d="M14 2v4a2 2 0 0 0 2 2h4"/>
                    <path d="M10 9H8"/>
                    <path d="M16 13H8"/>
                    <path d="M16 17H8"/>
                  </svg>
                </div>
                <div className="text-left">
                  <div className="font-medium text-[var(--nim-text)]">{project.name}</div>
                  <div className="text-sm text-[var(--nim-text-muted)]">
                    {project.sessionCount} session{project.sessionCount !== 1 ? 's' : ''}
                  </div>
                </div>
              </div>
              {selectedProject?.id === project.id && (
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--nim-primary)]">
                  <path d="M20 6 9 17l-5-5"/>
                </svg>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
