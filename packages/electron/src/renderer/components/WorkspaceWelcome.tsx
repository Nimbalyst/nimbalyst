import React from 'react';

interface WorkspaceWelcomeProps {
  workspaceName: string;
}

// Try to import the icon if it exists in the build
let iconUrl: string | undefined;
try {
  iconUrl = new URL('/icon.png', import.meta.url).href;
} catch {
  // Icon not available in this build
  iconUrl = undefined;
}

export function WorkspaceWelcome({ workspaceName }: WorkspaceWelcomeProps) {
  return (
    <div className="workspace-welcome">
      <div className="workspace-welcome-content">
        <div className="workspace-welcome-icon">
          {iconUrl && (
            <img
              src={iconUrl}
              alt="Preditor"
              onError={(e) => {
                // Hide the image if it fails to load
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          )}
        </div>
        <h1 className="workspace-welcome-title">{workspaceName}</h1>
        <p className="workspace-welcome-text">
          Select a file from the sidebar to start editing
        </p>
        <div className="workspace-welcome-tips">
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
