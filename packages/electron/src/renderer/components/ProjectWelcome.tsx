import React from 'react';
import { MaterialSymbol } from './MaterialSymbol';

interface ProjectWelcomeProps {
  projectName: string;
}

export function ProjectWelcome({ projectName }: ProjectWelcomeProps) {
  return (
    <div className="project-welcome">
      <div className="project-welcome-content">
        <MaterialSymbol icon="folder_open" size={64} className="project-welcome-icon" />
        <h1 className="project-welcome-title">Welcome to {projectName}</h1>
        <p className="project-welcome-text">
          Select a file from the sidebar to start editing
        </p>
        <div className="project-welcome-tips">
          <h3>Quick tips:</h3>
          <ul>
            <li>Click on any markdown file in the sidebar to open it</li>
            <li>Use <kbd>Cmd/Ctrl + S</kbd> to save your changes</li>
            <li>Files are automatically saved every 2 seconds when modified</li>
          </ul>
        </div>
      </div>
    </div>
  );
}