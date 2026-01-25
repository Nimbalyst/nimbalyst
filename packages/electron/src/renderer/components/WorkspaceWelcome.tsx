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
    <div className="workspace-welcome flex items-center justify-center h-full w-full bg-[var(--nim-bg)] text-[var(--nim-text)]">
      <div className="workspace-welcome-content text-center max-w-[500px] p-8">
        <div className="workspace-welcome-icon mb-6 w-20 h-20 mx-auto">
          {iconUrl && (
            <img
              src={iconUrl}
              alt="Nimbalyst"
              className="w-full h-full object-contain"
              onError={(e) => {
                // Hide the image if it fails to load
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          )}
        </div>
        <h1 className="workspace-welcome-title text-[2rem] font-semibold m-0 mb-2 text-[var(--nim-text)]">
          {workspaceName}
        </h1>
        <div className="workspace-welcome-tips nim-panel text-left mt-8 p-6">
          <h3 className="nim-section-label m-0 mb-4">Quick tips:</h3>
          <ul className="m-0 pl-6 text-[var(--nim-text-muted)]">
            <li className="mb-2 leading-relaxed">Open Markdown files from the sidebar</li>
            <li className="mb-2 leading-relaxed">Edit files directly or use the agent on the right side</li>
            <li className="mb-0 leading-relaxed">Files are automatically saved as you work</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
