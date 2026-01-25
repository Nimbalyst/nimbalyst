import React from 'react';

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
  actions,
}: WorkspaceHeaderProps) {
  const displayName = workspaceName || workspacePath.split('/').pop() || 'Workspace';

  return (
    <div
      className="workspace-header-container flex items-center justify-between gap-3 min-h-14 bg-[var(--nim-bg-secondary)] [-webkit-app-region:drag]"
    >
      <div className="workspace-identity flex-1 min-w-0 flex flex-col gap-1">
        <div className="workspace-name-row flex items-baseline gap-2.5">
          <h1
            className="workspace-name m-0 text-base font-bold text-[var(--nim-text)] overflow-hidden text-ellipsis whitespace-nowrap tracking-tight leading-tight"
          >
            {displayName}
          </h1>
          <span
            className="workspace-subtitle text-[13px] font-medium text-[var(--nim-text-muted)] opacity-70 whitespace-nowrap"
          >
            {subtitle}
          </span>
        </div>
        <span
          className="workspace-path text-[11px] text-[var(--nim-text-faint)] overflow-hidden text-ellipsis whitespace-nowrap opacity-75 font-normal"
        >
          {workspacePath}
        </span>
      </div>
      {actions && (
        <div className="workspace-header-actions flex items-center gap-2 [-webkit-app-region:no-drag]">
          {actions}
        </div>
      )}
    </div>
  );
}
