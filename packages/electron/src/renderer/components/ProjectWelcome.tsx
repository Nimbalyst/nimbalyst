import React from 'react';

interface ProjectWelcomeProps {
  projectName: string;
}

export function ProjectWelcome({ projectName }: ProjectWelcomeProps) {
  return (
    <div className="project-welcome">
      <div className="project-welcome-content">
        <div className="project-welcome-icon">
          <img src="../../../icon.png" alt="Stravu Editor" />
        </div>
        <h1 className="project-welcome-title">{projectName}</h1>
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
