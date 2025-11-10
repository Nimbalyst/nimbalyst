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
              alt="Nimbalyst"
              onError={(e) => {
                // Hide the image if it fails to load
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          )}
        </div>
        <h1 className="workspace-welcome-title">{workspaceName}</h1>
        <div className="workspace-welcome-tips">
          <h3>Quick tips:</h3>
          <ul>
            <li>Open Markdown files from the sidebar</li>
            <li>Edit files directly or use the agent on the right side</li>
            <li>Files are automatically saved as you work</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
