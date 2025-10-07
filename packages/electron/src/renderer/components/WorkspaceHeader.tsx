import React from 'react';
import './WorkspaceHeader.css';

// Generate a consistent color based on workspace path
function generateWorkspaceColor(path: string): string {
  let hash = 0;
  for (let i = 0; i < path.length; i++) {
    hash = ((hash << 5) - hash) + path.charCodeAt(i);
    hash = hash & hash;
  }

  // Generate a hue value (0-360)
  const hue = Math.abs(hash) % 360;
  // Use consistent saturation and lightness for pleasant colors
  return `hsl(${hue}, 65%, 55%)`;
}

export interface WorkspaceHeaderProps {
  workspacePath: string;
  workspaceName?: string;
  subtitle: string; // e.g., "Plan", "Code", "History"
  actions?: React.ReactNode; // Optional action buttons
}

export function WorkspaceHeader({
  workspacePath,
  workspaceName,
  subtitle,
  actions
}: WorkspaceHeaderProps) {
  const workspaceColor = generateWorkspaceColor(workspacePath);
  const displayName = workspaceName || workspacePath.split('/').pop() || workspacePath;

  return (
    <div className="workspace-header-container" style={{ borderLeftColor: workspaceColor }}>
      <div className="workspace-identity">
        <div className="workspace-name-row">
          <h3 className="workspace-name">{displayName}</h3>
          <span className="workspace-subtitle">{subtitle}</span>
        </div>
        <div className="workspace-path" title={workspacePath}>
          {workspacePath}
        </div>
      </div>
      {actions && (
        <div className="workspace-header-actions">
          {actions}
        </div>
      )}
    </div>
  );
}
