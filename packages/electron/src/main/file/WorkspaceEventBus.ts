import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import chokidar, { FSWatcher as ChokidarFSWatcher } from 'chokidar';
import ignore, { Ignore } from 'ignore';
import { logger } from '../utils/logger';

/**
 * Whether the platform supports `fs.watch(dir, { recursive: true })`.
 *
 * macOS uses FSEvents (1 FD for the entire tree).
 * Windows uses ReadDirectoryChangesW (1 handle for the entire tree).
 * Linux does NOT support recursive: true and throws ERR_FEATURE_UNAVAILABLE_ON_PLATFORM.
 */
const supportsRecursiveWatch = process.platform === 'darwin' || process.platform === 'win32';

/**
 * .git is always ignored — it's an internal data structure, never user content.
 * Everything else is determined by .gitignore (or fallback patterns).
 */
const ALWAYS_IGNORED_DIRS = new Set(['.git']);

/**
 * Top-level directory names (relative to workspace root) that are
 * macOS system/protected dirs and should be ignored entirely.
 * These only apply when the workspace root IS one of these (e.g. opening /).
 */
const IGNORED_TOP_DIRS = new Set([
  '.Trash', 'Library', 'Applications', 'Documents',
  'Downloads', 'Music', 'Pictures', 'Movies', 'Public',
  '.Spotlight-V100', '.TemporaryItems', '.fseventsd',
]);

/** OS junk files that should be silently ignored. */
const IGNORED_BASENAMES = new Set(['.DS_Store', 'Thumbs.db']);

/**
 * Fallback ignore patterns used when no .gitignore exists (non-git projects).
 *
 * When a .gitignore IS present, we trust it completely and don't add these.
 * When it ISN'T present, the project isn't under version control and there's
 * no authoritative source of what to ignore, so we use common conventions
 * for directories that are almost always generated/cached output.
 */
const FALLBACK_IGNORE_PATTERNS = [
  // Package managers
  'node_modules/',
  '.pnp/',
  '.yarn/',
  'bower_components/',

  // Build output
  'dist/',
  'build/',
  'out/',
  'target/',
  '.output/',

  // Framework caches
  '.next/',
  '.nuxt/',
  '.svelte-kit/',
  '.cache/',
  '.turbo/',
  '.parcel-cache/',
  '.webpack/',

  // Test/coverage
  'coverage/',

  // IDE
  '.vscode/',
  '.idea/',

  // Misc
  '.wrangler/',
  '__pycache__/',
  '*.pyc',
  '.DS_Store',
  'Thumbs.db',
];

// ---------------------------------------------------------------------------
// Workspace path safety
// ---------------------------------------------------------------------------

/**
 * Minimum depth from filesystem root for a workspace path to be watchable.
 * Paths like `/`, `/Users`, `/home` are too broad and would flood FSEvents.
 */
const MIN_WORKSPACE_DEPTH = 3;

/**
 * Returns the depth of a path from the filesystem root.
 * `/` = 0, `/Users` = 1, `/Users/ghinkle` = 2, `/Users/ghinkle/project` = 3
 */
function pathDepth(p: string): number {
  const resolved = path.resolve(p);
  const segments = resolved.split(path.sep).filter(Boolean);
  return segments.length;
}

/**
 * Validate that a workspace path is safe to watch recursively.
 * Returns an error message if unsafe, or null if safe.
 */
function validateWorkspacePath(workspacePath: string): string | null {
  const depth = pathDepth(workspacePath);
  if (depth < MIN_WORKSPACE_DEPTH) {
    return `Workspace path "${workspacePath}" is too shallow (depth ${depth}, minimum ${MIN_WORKSPACE_DEPTH}). ` +
      `Watching this path would monitor the entire filesystem and freeze the process.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Event rate circuit breaker
// ---------------------------------------------------------------------------

/**
 * If we receive more than this many events in CIRCUIT_BREAKER_WINDOW_MS,
 * kill the watcher. This catches pathological cases like watching a path
 * with millions of files, even if the path passed the depth check.
 */
const CIRCUIT_BREAKER_THRESHOLD = 5000;
const CIRCUIT_BREAKER_WINDOW_MS = 5000;

interface CircuitBreakerState {
  /** Timestamps of recent events (ring buffer). */
  timestamps: number[];
  /** Current write index into the ring buffer. */
  writeIndex: number;
  /** Whether this breaker has already tripped. */
  tripped: boolean;
}

function createCircuitBreaker(): CircuitBreakerState {
  return {
    timestamps: new Array(CIRCUIT_BREAKER_THRESHOLD).fill(0),
    writeIndex: 0,
    tripped: false,
  };
}

/**
 * Record an event. Returns true if the circuit breaker has tripped
 * (too many events in the window).
 */
function recordEvent(cb: CircuitBreakerState): boolean {
  if (cb.tripped) return true;

  const now = Date.now();
  const oldestIndex = cb.writeIndex;
  const oldestTimestamp = cb.timestamps[oldestIndex];

  cb.timestamps[cb.writeIndex] = now;
  cb.writeIndex = (cb.writeIndex + 1) % cb.timestamps.length;

  // If the oldest entry in the ring buffer is within the window,
  // that means we've had CIRCUIT_BREAKER_THRESHOLD events in < WINDOW_MS.
  if (oldestTimestamp > 0 && (now - oldestTimestamp) < CIRCUIT_BREAKER_WINDOW_MS) {
    cb.tripped = true;
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WorkspaceEventType = 'change' | 'add' | 'unlink';

export interface WorkspaceEventListener {
  onChange: (filePath: string) => void;
  onAdd: (filePath: string) => void;
  onUnlink: (filePath: string) => void;
}

interface BusEntry {
  watcher: fs.FSWatcher | ChokidarFSWatcher;
  /** Subscriber IDs currently using this watcher */
  refCount: number;
  /** Callbacks to invoke for each fs event, keyed by subscriber ID */
  listeners: Map<string, WorkspaceEventListener>;
  /** The loaded .gitignore filter */
  gitignoreFilter: Ignore;
  /** Event rate circuit breaker — kills the watcher if events flood in. */
  circuitBreaker: CircuitBreakerState;
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

/**
 * Fast pre-filter for paths that should ALWAYS be ignored regardless of
 * .gitignore. Only .git internals, macOS system dirs, and OS junk files.
 *
 * Everything else (node_modules, dist, build, etc.) is determined by .gitignore
 * or the fallback patterns. This keeps the hardcoded list minimal and correct.
 */
function shouldIgnoreHardcoded(relativePath: string): boolean {
  const segments = relativePath.split('/').filter(Boolean);
  if (segments.length === 0) return false;

  // Ignore macOS system/protected top-level directories
  if (IGNORED_TOP_DIRS.has(segments[0])) {
    return true;
  }

  // Ignore .git internals (always correct to ignore)
  for (const seg of segments) {
    if (ALWAYS_IGNORED_DIRS.has(seg)) {
      return true;
    }
  }

  const basename = segments[segments.length - 1];

  // Ignore OS junk files
  if (IGNORED_BASENAMES.has(basename)) {
    return true;
  }

  // Ignore Unix socket files (e.g. .gnupg/S.gpg-agent)
  if (basename.startsWith('S.')) {
    return true;
  }

  return false;
}

async function loadGitignoreFilter(workspacePath: string): Promise<Ignore> {
  const gitignorePath = path.join(workspacePath, '.gitignore');
  try {
    const content = await fsPromises.readFile(gitignorePath, 'utf-8');
    return ignore().add(content);
  } catch {
    return ignore().add(FALLBACK_IGNORE_PATTERNS);
  }
}

// ---------------------------------------------------------------------------
// WorkspaceEventBus
// ---------------------------------------------------------------------------

/** Global registry of shared watchers, keyed by normalized workspace path. */
const busEntries = new Map<string, BusEntry>();

/**
 * WorkspaceEventBus owns a single fs.watch/chokidar watcher per workspace,
 * loads .gitignore, and emits filtered events to all subscribers.
 *
 * Both OptimizedWorkspaceWatcher and SessionFileWatcher subscribe to this bus
 * rather than creating their own watchers.
 */

export async function subscribe(
  workspacePath: string,
  subscriberId: string,
  listener: WorkspaceEventListener,
): Promise<void> {
  const key = path.resolve(workspacePath);
  const existing = busEntries.get(key);

  if (existing) {
    existing.refCount++;
    existing.listeners.set(subscriberId, listener);
    logger.main.info('[WorkspaceEventBus] Reusing shared watcher for workspace:', {
      workspacePath: key,
      subscriberId,
      refCount: existing.refCount,
    });
    return;
  }

  // Safety: refuse to watch paths that are too close to the filesystem root
  const validationError = validateWorkspacePath(key);
  if (validationError) {
    logger.main.error('[WorkspaceEventBus] Refusing to watch unsafe path:', {
      workspacePath: key,
      subscriberId,
      reason: validationError,
    });
    return;
  }

  const ig = await loadGitignoreFilter(workspacePath);

  if (supportsRecursiveWatch) {
    startRecursiveWatch(key, workspacePath, subscriberId, listener, ig);
  } else {
    startChokidarWatch(key, workspacePath, subscriberId, listener, ig);
  }
}

export function unsubscribe(workspacePath: string, subscriberId: string): void {
  const key = path.resolve(workspacePath);
  const entry = busEntries.get(key);
  if (!entry) return;

  entry.listeners.delete(subscriberId);
  entry.refCount--;

  if (entry.refCount <= 0) {
    busEntries.delete(key);
    closeWatcher(entry.watcher);
    logger.main.info('[WorkspaceEventBus] Closed shared watcher for workspace:', {
      workspacePath: key,
      lastSubscriberId: subscriberId,
    });
  } else {
    logger.main.info('[WorkspaceEventBus] Released subscriber:', {
      workspacePath: key,
      subscriberId,
      remainingRefCount: entry.refCount,
    });
  }
}

/** Active subscriber IDs for a workspace. Used by WorkspaceFileEditAttributionService. */
export function getSubscriberIds(workspacePath: string): string[] {
  const entry = busEntries.get(path.resolve(workspacePath));
  if (!entry) return [];
  return [...entry.listeners.keys()];
}

/** Number of active bus entries. Visible for testing/diagnostics. */
export function getBusEntryCount(): number {
  return busEntries.size;
}

/** Ref count for a workspace. Visible for testing. */
export function getRefCount(workspacePath: string): number {
  return busEntries.get(path.resolve(workspacePath))?.refCount ?? 0;
}

/** Reset all bus state. Only for tests. */
export function resetBus(): void {
  busEntries.clear();
}

/**
 * On Linux, forward folder expansion to chokidar.
 * No-op on macOS/Windows (recursive fs.watch covers the entire tree).
 */
export function addWatchedPath(workspacePath: string, folderPath: string): void {
  if (supportsRecursiveWatch) return;

  const key = path.resolve(workspacePath);
  const entry = busEntries.get(key);
  if (!entry) return;

  const watcher = entry.watcher;
  if ('add' in watcher) {
    (watcher as ChokidarFSWatcher).add(folderPath);
  }
}

/**
 * On Linux, forward folder collapse to chokidar.
 * No-op on macOS/Windows.
 */
export function removeWatchedPath(workspacePath: string, folderPath: string): void {
  if (supportsRecursiveWatch) return;

  const key = path.resolve(workspacePath);
  const entry = busEntries.get(key);
  if (!entry) return;

  const watcher = entry.watcher;
  if ('unwatch' in watcher) {
    (watcher as ChokidarFSWatcher).unwatch(folderPath);
  }
}

export async function stopAll(): Promise<void> {
  logger.main.info(`[WorkspaceEventBus] Stopping all watchers (${busEntries.size} active)`);

  const closePromises: Promise<void>[] = [];
  for (const [key, entry] of busEntries.entries()) {
    try {
      if (supportsRecursiveWatch) {
        (entry.watcher as fs.FSWatcher).close();
      } else {
        closePromises.push((entry.watcher as ChokidarFSWatcher).close());
      }
    } catch (error) {
      logger.main.error(`[WorkspaceEventBus] Error closing watcher for ${key}:`, error);
    }
  }

  if (closePromises.length > 0) {
    const allClosesPromise = Promise.all(closePromises);
    const timeoutPromise = new Promise<void>((resolve) => {
      setTimeout(() => {
        logger.main.warn('[WorkspaceEventBus] Watcher close timed out after 1000ms, forcing cleanup');
        resolve();
      }, 1000);
    });
    await Promise.race([allClosesPromise, timeoutPromise]);
  }

  busEntries.clear();
  logger.main.info('[WorkspaceEventBus] All watchers stopped');
}

export function getStats(): {
  type: string;
  activeWorkspaces: number;
  workspaces: Array<{ workspacePath: string; subscriberCount: number; subscriberIds: string[] }>;
} {
  const workspaces: Array<{ workspacePath: string; subscriberCount: number; subscriberIds: string[] }> = [];
  for (const [workspacePath, entry] of busEntries.entries()) {
    workspaces.push({
      workspacePath,
      subscriberCount: entry.listeners.size,
      subscriberIds: [...entry.listeners.keys()],
    });
  }
  return {
    type: supportsRecursiveWatch
      ? 'WorkspaceEventBus (fs.watch recursive)'
      : 'WorkspaceEventBus (chokidar)',
    activeWorkspaces: busEntries.size,
    workspaces,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function closeWatcher(watcher: fs.FSWatcher | ChokidarFSWatcher): void {
  if (supportsRecursiveWatch) {
    (watcher as fs.FSWatcher).close();
  } else {
    (watcher as ChokidarFSWatcher).close();
  }
}

/** Returns true if the relative path should be filtered out. */
function shouldFilter(relativePath: string, ig: Ignore): boolean {
  if (shouldIgnoreHardcoded(relativePath)) return true;
  // .gitignore check - test both file and directory forms
  if (ig.ignores(relativePath) || ig.ignores(relativePath + '/')) return true;
  return false;
}

function tripCircuitBreaker(key: string, entry: BusEntry): void {
  logger.main.error(
    `[WorkspaceEventBus] Circuit breaker tripped for "${key}" — ` +
    `received ${CIRCUIT_BREAKER_THRESHOLD} events in ${CIRCUIT_BREAKER_WINDOW_MS}ms. ` +
    `Killing watcher to protect the process. This workspace may be too large or missing a .gitignore.`
  );
  closeWatcher(entry.watcher);
  busEntries.delete(key);
}

function startRecursiveWatch(
  key: string,
  workspacePath: string,
  subscriberId: string,
  listener: WorkspaceEventListener,
  ig: Ignore,
): void {
  const cb = createCircuitBreaker();
  const entry: BusEntry = {
    watcher: null!,
    refCount: 1,
    listeners: new Map([[subscriberId, listener]]),
    gitignoreFilter: ig,
    circuitBreaker: cb,
  };

  try {
    const watcher = fs.watch(workspacePath, { recursive: true }, (eventType: string, filename: string | null) => {
      if (!filename) return;

      // Circuit breaker check BEFORE any filtering — measures raw event pressure
      // from the OS, which is what actually freezes the process.
      if (recordEvent(cb)) {
        if (cb.tripped && busEntries.has(key)) {
          tripCircuitBreaker(key, entry);
        }
        return;
      }

      const relativePath = filename.split(path.sep).join('/');
      if (shouldFilter(relativePath, ig)) return;

      const absolutePath = path.join(workspacePath, filename);

      if (eventType === 'change') {
        for (const l of entry.listeners.values()) l.onChange(absolutePath);
      } else {
        // 'rename' — could be add or delete. Use fs.access to determine.
        fsPromises.access(absolutePath).then(
          () => {
            // File exists — treat as add
            for (const l of entry.listeners.values()) l.onAdd(absolutePath);
          },
          () => {
            // File does not exist — treat as unlink
            for (const l of entry.listeners.values()) l.onUnlink(absolutePath);
          },
        );
      }
    });

    entry.watcher = watcher;

    watcher.on('error', (error: NodeJS.ErrnoException) => {
      const code = error.code;
      if (code === 'EMFILE' || code === 'ENFILE') {
        logger.main.error(
          `[WorkspaceEventBus] Too many open files (${code}) for "${key}" — ` +
          `closing watcher. File changes will not be detected.`
        );
        if (busEntries.has(key)) {
          (watcher as fs.FSWatcher).close();
          busEntries.delete(key);
        }
      } else if (code === 'EPERM' || code === 'EACCES' || code === 'UNKNOWN') {
        logger.main.debug('[WorkspaceEventBus] Skipping unwatchable path:', error);
      } else {
        logger.main.error('[WorkspaceEventBus] Watcher error:', error);
      }
    });

    busEntries.set(key, entry);

    logger.main.info('[WorkspaceEventBus] Created shared watcher (fs.watch recursive):', {
      workspacePath: key,
      subscriberId,
    });
  } catch (error) {
    logger.main.error('[WorkspaceEventBus] Failed to start recursive watcher:', error);
  }
}

/**
 * Max initial watch depth for chokidar on Linux.
 *
 * On Linux, every directory is a separate inotify watch. An unbounded
 * recursive crawl of a large project (no .gitignore, deep node_modules
 * that slipped through) can exhaust inotify limits and block the event
 * loop during setup. Capping depth limits the damage; deeper folders
 * get watched on-demand via addWatchedPath() when the user expands them.
 *
 * This does NOT apply to macOS/Windows — fs.watch(recursive:true) is
 * a single kernel call regardless of tree depth.
 */
const CHOKIDAR_MAX_DEPTH = 10;

function startChokidarWatch(
  key: string,
  workspacePath: string,
  subscriberId: string,
  listener: WorkspaceEventListener,
  ig: Ignore,
): void {
  try {
    const watcher = chokidar.watch(workspacePath, {
      ignored: (filePath: string) => {
        const relativePath = path.relative(workspacePath, filePath);
        if (!relativePath) return false;
        return shouldFilter(relativePath, ig);
      },
      ignoreInitial: true,
      followSymlinks: false,
      usePolling: false,
      atomic: true,
      awaitWriteFinish: {
        stabilityThreshold: 50,
        pollInterval: 20,
      },
      alwaysStat: false,
      depth: CHOKIDAR_MAX_DEPTH,
    });

    const cb = createCircuitBreaker();
    const entry: BusEntry = {
      watcher,
      refCount: 1,
      listeners: new Map([[subscriberId, listener]]),
      gitignoreFilter: ig,
      circuitBreaker: cb,
    };
    busEntries.set(key, entry);

    const checkBreaker = (): boolean => {
      if (recordEvent(cb)) {
        if (cb.tripped && busEntries.has(key)) {
          tripCircuitBreaker(key, entry);
        }
        return true;
      }
      return false;
    };

    watcher
      .on('change', (filePath: string) => {
        if (checkBreaker()) return;
        for (const l of entry.listeners.values()) l.onChange(filePath);
      })
      .on('add', (filePath: string) => {
        if (checkBreaker()) return;
        for (const l of entry.listeners.values()) l.onAdd(filePath);
      })
      .on('unlink', (filePath: string) => {
        if (checkBreaker()) return;
        for (const l of entry.listeners.values()) l.onUnlink(filePath);
      })
      .on('error', (error: unknown) => {
        const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
        if (code === 'EMFILE' || code === 'ENFILE') {
          // Kill the watcher immediately. Chokidar retries internally on
          // EMFILE, which causes retry-spam that floods the log and burns CPU.
          logger.main.error(
            `[WorkspaceEventBus] Too many open files (${code}) for "${key}" — ` +
            `closing watcher to stop retry-spam. File changes will not be detected.`
          );
          if (busEntries.has(key)) {
            closeWatcher(entry.watcher);
            busEntries.delete(key);
          }
        } else if (code === 'EPERM' || code === 'EACCES' || code === 'UNKNOWN') {
          logger.main.debug('[WorkspaceEventBus] Skipping unwatchable path:', error);
        } else {
          logger.main.error('[WorkspaceEventBus] Watcher error:', error);
        }
      });

    logger.main.info('[WorkspaceEventBus] Created shared watcher (chokidar):', {
      workspacePath: key,
      subscriberId,
    });
  } catch (error) {
    logger.main.error('[WorkspaceEventBus] Failed to start chokidar watcher:', error);
  }
}
