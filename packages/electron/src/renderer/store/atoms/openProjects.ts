/**
 * Open Projects state
 *
 * Tracks the list of workspace projects warm in the multi-project rail and
 * which one is currently visible. The rail is opt-in: when
 * `multiProjectModeAtom` is `false`, the rail stays hidden and the host
 * window keeps the legacy "one project per window" behavior.
 *
 * `activeWorkspacePathAtom` is the single source of truth for the path
 * read by per-workspace atom families (agent layout, navigation history,
 * sidebar widths, etc.). It replaces the module-level `currentWorkspacePath`
 * variables that previously lived in `agentMode.ts` and
 * `navigationHistory.ts`.
 */

import { atom } from 'jotai';
import { store } from '@nimbalyst/runtime/store';
import {
  sessionRegistryAtom,
  sessionProcessingAtom,
  sessionUnreadAtom,
} from './sessions';

export interface OpenProject {
  /** Canonical absolute path; same key used by per-workspace atom families. */
  path: string;
  /** Display name. Derived from `path.basename(path)` on the renderer. */
  name: string;
  /** ms epoch when the project was added to the rail. */
  openedAt: number;
}

const MAX_OPEN_PROJECTS = 8;

/**
 * Path of the workspace currently visible in this window.
 *
 * Read by per-workspace atom families to resolve which workspace's state
 * to expose. Written when a workspace becomes the focused project — by
 * `initAgentModeLayout` / `initNavigationHistory` for single-project flow,
 * by the project rail click handler in multi-project mode.
 */
export const activeWorkspacePathAtom = atom<string | null>(null);

/**
 * Whether multi-project mode is enabled. When false, rail UI is hidden and
 * opening a new project spawns a fresh window (legacy behavior). When true,
 * opening a project adds it to the rail in the current window.
 *
 * Persisted via `app:set-multi-project-mode` IPC; seeded from store on
 * launch by an effect that reads `app:get-multi-project-mode`.
 */
export const multiProjectModeAtom = atom<boolean>(false);

/**
 * Ordered list of open projects in the rail. First entry is leftmost.
 *
 * Capped at `MAX_OPEN_PROJECTS` to bound memory of warm projects.
 */
export const openProjectsAtom = atom<OpenProject[]>([]);

/**
 * Convenience: the OpenProject record for the active workspace, if any.
 */
export const activeOpenProjectAtom = atom((get) => {
  const path = get(activeWorkspacePathAtom);
  if (!path) return null;
  return get(openProjectsAtom).find((p) => p.path === path) ?? null;
});

/**
 * Whether the rail is at the open-project cap. UI uses this to disable
 * the "+" button and show a hint to close a project first.
 */
export const isOpenProjectsAtCapAtom = atom((get) => {
  return get(openProjectsAtom).length >= MAX_OPEN_PROJECTS;
});

export interface ProjectActivitySummary {
  processing: number;
  unread: number;
}

/**
 * Per-workspace summary of "things needing attention" in inactive
 * projects: how many sessions are streaming and how many have unread
 * messages. Drives the rail badges.
 *
 * Recomputes whenever any session's registry/processing/unread atom
 * changes. Components that only read the rail summary subscribe just to
 * this atom, not the full session graph.
 */
export const projectActivitySummaryAtom = atom((get) => {
  const registry = get(sessionRegistryAtom);
  const summary = new Map<string, ProjectActivitySummary>();

  for (const session of registry.values()) {
    const path = session.workspaceId;
    if (!path) continue;
    const isProcessing = get(sessionProcessingAtom(session.id));
    const isUnread = get(sessionUnreadAtom(session.id));
    if (!isProcessing && !isUnread) continue;
    const entry = summary.get(path) ?? { processing: 0, unread: 0 };
    if (isProcessing) entry.processing += 1;
    if (isUnread) entry.unread += 1;
    summary.set(path, entry);
  }

  return summary;
});

/**
 * Add a project to the rail. No-op if it already exists. When the rail
 * has reached the cap, returns without adding (caller should show a UI
 * hint via `isOpenProjectsAtCapAtom`).
 *
 * Activates the added project so the renderer immediately switches to it.
 */
export const addOpenProjectAtom = atom(
  null,
  (get, set, project: OpenProject) => {
    const current = get(openProjectsAtom);

    const existing = current.find((p) => p.path === project.path);
    if (existing) {
      set(activeWorkspacePathAtom, existing.path);
      return;
    }

    if (current.length >= MAX_OPEN_PROJECTS) {
      return;
    }

    set(openProjectsAtom, [...current, project]);
    set(activeWorkspacePathAtom, project.path);
  }
);

/**
 * Remove a project from the rail. If the closed project was active, the
 * adjacent project (next, then previous, then null) becomes active.
 *
 * Callers are responsible for any pre-close confirmation (e.g. when the
 * project has streaming sessions).
 */
export const closeOpenProjectAtom = atom(
  null,
  (get, set, pathToClose: string) => {
    const current = get(openProjectsAtom);
    const idx = current.findIndex((p) => p.path === pathToClose);
    if (idx === -1) return;

    const next = current.filter((p) => p.path !== pathToClose);
    set(openProjectsAtom, next);

    const activePath = get(activeWorkspacePathAtom);
    if (activePath === pathToClose) {
      const replacement = next[idx] ?? next[idx - 1] ?? next[0] ?? null;
      set(activeWorkspacePathAtom, replacement?.path ?? null);
    }
  }
);

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function basenameFromPath(p: string): string {
  // Match Node's path.basename behavior for both posix and win32 separators.
  const trimmed = p.replace(/[\\/]+$/, '');
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

let initialized = false;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let unsubscribers: Array<() => void> = [];

/**
 * Load multi-project settings from disk and start persistence subscribers.
 *
 * Idempotent: subsequent calls are no-ops. Call once at renderer startup,
 * before the rail is rendered, so the first paint already has the correct
 * `multiProjectModeAtom` value.
 *
 * Returns once the initial state has been loaded.
 */
export async function initOpenProjects(): Promise<void> {
  if (initialized) return;
  initialized = true;

  if (!window.electronAPI?.invoke) return;

  try {
    const [mode, paths, activePath] = await Promise.all([
      window.electronAPI.invoke('app:get-multi-project-mode') as Promise<boolean>,
      window.electronAPI.invoke('app:get-open-projects') as Promise<string[]>,
      window.electronAPI.invoke('app:get-active-project-path') as Promise<string | null>,
    ]);

    store.set(multiProjectModeAtom, !!mode);

    const validPaths = Array.isArray(paths) ? paths.filter((p) => typeof p === 'string' && p.length > 0) : [];
    const projects: OpenProject[] = validPaths.map((path) => ({
      path,
      name: basenameFromPath(path),
      openedAt: Date.now(),
    }));
    store.set(openProjectsAtom, projects);

    if (activePath && validPaths.includes(activePath)) {
      store.set(activeWorkspacePathAtom, activePath);
    } else if (projects.length > 0) {
      store.set(activeWorkspacePathAtom, projects[0].path);
    }
  } catch (err) {
    console.error('[openProjects] Failed to load multi-project state:', err);
  }

  // Subscribe for debounced writes back to disk.
  unsubscribers.push(
    store.sub(multiProjectModeAtom, () => {
      const mode = store.get(multiProjectModeAtom);
      window.electronAPI?.invoke?.('app:set-multi-project-mode', mode).catch((err: unknown) => {
        console.error('[openProjects] Failed to persist multiProjectMode:', err);
      });
    }),
    store.sub(openProjectsAtom, () => schedulePersistOpenProjects()),
    store.sub(activeWorkspacePathAtom, () => schedulePersistActivePath()),
  );
}

function schedulePersistOpenProjects(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const projects = store.get(openProjectsAtom);
    const paths = projects.map((p) => p.path);
    window.electronAPI?.invoke?.('app:set-open-projects', paths).catch((err: unknown) => {
      console.error('[openProjects] Failed to persist openProjects:', err);
    });
  }, 300);
}

function schedulePersistActivePath(): void {
  const path = store.get(activeWorkspacePathAtom);
  // No debounce needed — switches are user-driven and infrequent.
  window.electronAPI?.invoke?.('app:set-active-project-path', path).catch((err: unknown) => {
    console.error('[openProjects] Failed to persist activeProjectPath:', err);
  });
}

/**
 * Tear down persistence subscribers (e.g. for tests). Resets `initialized`
 * so the next `initOpenProjects` call re-loads from disk.
 */
export function teardownOpenProjects(): void {
  unsubscribers.forEach((unsub) => unsub());
  unsubscribers = [];
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  initialized = false;
}
