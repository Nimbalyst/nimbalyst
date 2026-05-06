/**
 * ProjectRail
 *
 * Discord-style vertical rail of warm projects. Click an icon to switch
 * the visible project; the inactive projects' state is kept warm via
 * per-workspace atom families and main-process service refcounting.
 *
 * Hidden when multi-project mode is off (the legacy single-window flow
 * stays as a fallback).
 */

import React, { useCallback, useState } from 'react';
import {
  useFloating,
  FloatingPortal,
  useDismiss,
  useInteractions,
  useRole,
  offset,
  flip,
  shift,
  type VirtualElement,
} from '@floating-ui/react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import {
  multiProjectModeAtom,
  openProjectsAtom,
  activeWorkspacePathAtom,
  isOpenProjectsAtCapAtom,
  addOpenProjectAtom,
  closeOpenProjectAtom,
  projectActivitySummaryAtom,
  type OpenProject,
} from '../store/atoms/openProjects';
import { sessionRegistryAtom } from '../store/atoms/sessions';
import './ProjectRail.css';

const REVEAL_LABEL = (() => {
  const platform = typeof navigator !== 'undefined' ? navigator.platform : '';
  if (platform.startsWith('Mac')) return 'Reveal in Finder';
  if (platform.startsWith('Win')) return 'Show in Explorer';
  return 'Show in Folder';
})();

function projectInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '??';
  const words = trimmed.split(/[-_\s]+/).filter(Boolean);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}

interface ProjectRailIconProps {
  project: OpenProject;
  isActive: boolean;
  processingCount: number;
  unreadCount: number;
  onActivate: (path: string) => void;
  onClose: (project: OpenProject) => void;
  onContextMenu: (project: OpenProject, x: number, y: number) => void;
}

function ProjectRailIcon({
  project,
  isActive,
  processingCount,
  unreadCount,
  onActivate,
  onClose,
  onContextMenu,
}: ProjectRailIconProps) {
  const handleClick = useCallback(() => {
    onActivate(project.path);
  }, [onActivate, project.path]);

  const handleClose = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      onClose(project);
    },
    [onClose, project]
  );

  const handleContextMenu = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      onContextMenu(project, event.clientX, event.clientY);
    },
    [onContextMenu, project]
  );

  const className = isActive ? 'project-rail-item is-active' : 'project-rail-item';

  // Inactive projects show a badge when something needs attention. Active
  // projects already have the user's eyes on them so we suppress the
  // badge to keep the rail quiet.
  const showBadge = !isActive && (processingCount > 0 || unreadCount > 0);
  const badgeLabel = processingCount > 0 ? `${processingCount}` : unreadCount > 0 ? `${unreadCount}` : '';

  return (
    <button
      type="button"
      className={className}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      data-testid="project-rail-item"
      data-project-path={project.path}
      aria-label={`Switch to project ${project.name}`}
      aria-current={isActive ? 'true' : undefined}
    >
      {projectInitials(project.name)}
      {showBadge && (
        <span
          className="project-rail-item-badge"
          aria-label={processingCount > 0 ? `${processingCount} streaming session(s)` : `${unreadCount} unread`}
        >
          {badgeLabel}
        </span>
      )}
      <span
        className="project-rail-item-close"
        role="button"
        tabIndex={-1}
        onClick={handleClose}
        aria-label={`Close ${project.name}`}
      >
        ×
      </span>
      <span className="project-rail-tooltip">{project.name}</span>
    </button>
  );
}

export function ProjectRail() {
  const isMultiProjectMode = useAtomValue(multiProjectModeAtom);
  const openProjects = useAtomValue(openProjectsAtom);
  const [activePath, setActivePath] = useAtom(activeWorkspacePathAtom);
  const atCap = useAtomValue(isOpenProjectsAtCapAtom);
  const addProject = useSetAtom(addOpenProjectAtom);
  const closeProject = useSetAtom(closeOpenProjectAtom);
  const sessionRegistry = useAtomValue(sessionRegistryAtom);
  const activitySummary = useAtomValue(projectActivitySummaryAtom);

  const handleActivate = useCallback(
    (path: string) => {
      if (path === activePath) return;
      setActivePath(path);
      window.electronAPI?.invoke?.('workspace:set-active', { workspacePath: path }).catch((err: unknown) => {
        console.error('[ProjectRail] workspace:set-active failed:', err);
      });
    },
    [activePath, setActivePath]
  );

  const handleAdd = useCallback(async () => {
    if (atCap) {
      window.alert('You can have at most 8 projects open in the rail. Close one first or open in a new window.');
      return;
    }

    if (!window.electronAPI?.invoke) return;

    try {
      const result = await window.electronAPI.invoke('dialog-show-open-dialog', {
        properties: ['openDirectory'],
        title: 'Open Project',
      });
      if (result?.canceled) return;
      const picked: string | undefined = result?.filePaths?.[0];
      if (!picked) return;

      // Register the path with the main process so its services start.
      const reg = await window.electronAPI.invoke('workspace:register-additional', { workspacePath: picked });
      if (!reg?.success) {
        console.error('[ProjectRail] register-additional failed:', reg?.error);
        return;
      }

      const project: OpenProject = {
        path: picked,
        name: picked.split(/[\\/]/).filter(Boolean).pop() || picked,
        openedAt: Date.now(),
      };
      addProject(project);

      // Set as active.
      await window.electronAPI.invoke('workspace:set-active', { workspacePath: picked });
    } catch (err) {
      console.error('[ProjectRail] handleAdd failed:', err);
    }
  }, [atCap, addProject]);

  const handleClose = useCallback(
    async (project: OpenProject) => {
      // Warn if there are running sessions for this project.
      const sessionsForPath = Array.from(sessionRegistry.values()).filter(
        (meta: any) => meta.workspaceId === project.path
      );
      const streaming = sessionsForPath.filter((meta: any) => meta.isStreaming || meta.processing).length;
      if (streaming > 0) {
        const proceed = window.confirm(
          `${project.name} has ${streaming} streaming session${streaming === 1 ? '' : 's'}. Close anyway? Sessions will be paused.`
        );
        if (!proceed) return;
      }

      closeProject(project.path);

      try {
        await window.electronAPI?.invoke?.('workspace:unregister-additional', { workspacePath: project.path });
      } catch (err) {
        console.error('[ProjectRail] unregister-additional failed:', err);
      }
    },
    [closeProject, sessionRegistry]
  );

  // Right-click context menu state. Anchored to a virtual reference at the
  // cursor position so it works for any rail icon without per-icon refs.
  const [menu, setMenu] = useState<{ project: OpenProject; x: number; y: number } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  const { refs, floatingStyles, context } = useFloating({
    open: menu !== null,
    onOpenChange: (open) => {
      if (!open) closeMenu();
    },
    placement: 'right-start',
    middleware: [offset(4), flip(), shift({ padding: 8 })],
  });

  // Use a virtual reference at the cursor position. setPositionReference
  // accepts a VirtualElement which is the documented escape hatch.
  React.useEffect(() => {
    if (!menu) {
      refs.setPositionReference(null);
      return;
    }
    const virtual: VirtualElement = {
      getBoundingClientRect: () => DOMRect.fromRect({ x: menu.x, y: menu.y, width: 0, height: 0 }),
    };
    refs.setPositionReference(virtual);
  }, [menu, refs]);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: 'menu' });
  const { getFloatingProps } = useInteractions([dismiss, role]);

  const handleContextMenu = useCallback((project: OpenProject, x: number, y: number) => {
    setMenu({ project, x, y });
  }, []);

  const handleOpenInNewWindow = useCallback(async (project: OpenProject) => {
    closeMenu();
    try {
      await window.electronAPI?.invoke?.('workspace-manager:open-workspace', project.path);
    } catch (err) {
      console.error('[ProjectRail] open-workspace failed:', err);
    }
  }, [closeMenu]);

  const handleRevealInFinder = useCallback(async (project: OpenProject) => {
    closeMenu();
    try {
      await window.electronAPI?.invoke?.('show-in-finder', project.path);
    } catch (err) {
      console.error('[ProjectRail] show-in-finder failed:', err);
    }
  }, [closeMenu]);

  if (!isMultiProjectMode) return null;

  return (
    <nav className="project-rail" data-testid="project-rail" aria-label="Open projects">
      {openProjects.map((project) => {
        const activity = activitySummary.get(project.path);
        return (
          <ProjectRailIcon
            key={project.path}
            project={project}
            isActive={project.path === activePath}
            processingCount={activity?.processing ?? 0}
            unreadCount={activity?.unread ?? 0}
            onActivate={handleActivate}
            onClose={handleClose}
            onContextMenu={handleContextMenu}
          />
        );
      })}
      {openProjects.length > 0 && <div className="project-rail-divider" aria-hidden="true" />}
      <button
        type="button"
        className="project-rail-add"
        onClick={handleAdd}
        disabled={atCap}
        data-testid="project-rail-add"
        aria-label="Add project to rail"
      >
        +
        <span className="project-rail-tooltip">{atCap ? 'Rail full (8 projects max)' : 'Add project'}</span>
      </button>

      {menu && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            className="project-rail-context-menu"
            style={floatingStyles}
            data-testid="project-rail-context-menu"
            {...getFloatingProps()}
          >
            <button
              type="button"
              className="project-rail-context-menu-item"
              onClick={() => handleOpenInNewWindow(menu.project)}
            >
              Open in new window
            </button>
            <button
              type="button"
              className="project-rail-context-menu-item"
              onClick={() => handleRevealInFinder(menu.project)}
            >
              {REVEAL_LABEL}
            </button>
            <div className="project-rail-context-menu-divider" />
            <button
              type="button"
              className="project-rail-context-menu-item"
              onClick={() => {
                closeMenu();
                handleClose(menu.project);
              }}
            >
              Close project
            </button>
          </div>
        </FloatingPortal>
      )}
    </nav>
  );
}
