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
