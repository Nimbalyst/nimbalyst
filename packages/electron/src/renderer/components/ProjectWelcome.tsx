import React from 'react';

interface ProjectWelcomeProps {
  projectName: string;
}

// Try to import the icon if it exists in the build
let iconUrl: string | undefined;
try {
  iconUrl = new URL('/icon.png', import.meta.url).href;
} catch {
  // Icon not available in this build
  iconUrl = undefined;
}

export function ProjectWelcome({ projectName }: ProjectWelcomeProps) {
  return (
    <div className="project-welcome">
      <div className="project-welcome-content">
        <div className="project-welcome-icon">
          {iconUrl && (
            <img 
              src={iconUrl} 
              alt="Stravu Editor" 
              onError={(e) => {
                // Hide the image if it fails to load
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          )}
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
