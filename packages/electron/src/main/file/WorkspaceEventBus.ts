import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import chokidar, { FSWatcher as ChokidarFSWatcher } from 'chokidar';
import ignore, { Ignore } from 'ignore';
import { logger } from '../utils/logger';
import { isPathInWorkspace } from '../utils/workspaceDetection';

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
// Path normalization
// ---------------------------------------------------------------------------

/** Normalize a path to forward slashes for consistent Set comparisons across platforms. */
function normalizeToForwardSlash(p: string): string {
  return p.replace(/\\/g, '/');
}

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
  onChange: (filePath: string, gitignoreBypassed?: boolean) => void;
  onAdd: (filePath: string, gitignoreBypassed?: boolean) => void;
  onUnlink: (filePath: string, gitignoreBypassed?: boolean) => void;
}

/** Dropped gitignored event stored in replay buffer. */
interface DroppedGitignoreEvent {
  absolutePath: string;
  eventType: 'change' | 'add' | 'unlink' | 'rename';
  timestamp: number;
}

/** Max entries in the replay buffer per workspace. */
const REPLAY_BUFFER_MAX = 50;
/** TTL for replay buffer entries (ms). */
const REPLAY_BUFFER_TTL_MS = 5000;

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
  /** Absolute paths that bypass gitignore filtering. */
  gitignoreBypassPaths: Set<string>;
  /** Ring buffer of recently dropped gitignored events for replay on bypass registration. */
  replayBuffer: DroppedGitignoreEvent[];
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
    entry.gitignoreBypassPaths.clear();
    entry.replayBuffer = [];
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
 * Register a file path to bypass gitignore filtering.
 * Events for this path will be dispatched with `gitignoreBypassed=true`.
 * On Linux (chokidar), also adds the path to the watcher so events fire
 * for files inside already-ignored directories.
 */
export function addGitignoreBypass(workspacePath: string, absolutePath: string): void {
  const key = path.resolve(workspacePath);
  const entry = busEntries.get(key);
  if (!entry) return;

  // Validate that the path is inside the workspace
  if (!isPathInWorkspace(absolutePath, key)) {
    logger.main.debug('[WorkspaceEventBus] Rejected gitignore bypass for path outside workspace:', {
      workspacePath: key,
      absolutePath,
    });
    return;
  }

  const normalizedPath = normalizeToForwardSlash(absolutePath);
  entry.gitignoreBypassPaths.add(normalizedPath);

  // On Linux, ensure chokidar watches this specific path
  if (!supportsRecursiveWatch && 'add' in entry.watcher) {
    (entry.watcher as ChokidarFSWatcher).add(absolutePath);
  }

  // Replay any recently dropped events for this path
  replayDroppedEvents(entry, normalizedPath);

  logger.main.debug('[WorkspaceEventBus] Added gitignore bypass:', {
    workspacePath: key,
    absolutePath: normalizedPath,
    bypassCount: entry.gitignoreBypassPaths.size,
  });
}

/**
 * Remove a file path from the gitignore bypass set.
 */
export function removeGitignoreBypass(workspacePath: string, absolutePath: string): void {
  const key = path.resolve(workspacePath);
  const entry = busEntries.get(key);
  if (!entry) return;

  entry.gitignoreBypassPaths.delete(normalizeToForwardSlash(absolutePath));
}

/** Check if absolute path is in the bypass set for a workspace. Visible for testing. */
export function hasGitignoreBypass(workspacePath: string, absolutePath: string): boolean {
  const entry = busEntries.get(path.resolve(workspacePath));
  return entry?.gitignoreBypassPaths.has(normalizeToForwardSlash(absolutePath)) ?? false;
}

/**
 * Clear all gitignore bypass paths for a workspace.
 * Called during session cleanup or when bypass state should be reset.
 */
export function clearGitignoreBypasses(workspacePath: string): void {
  const key = path.resolve(workspacePath);
  const entry = busEntries.get(key);
  if (!entry) return;

  const count = entry.gitignoreBypassPaths.size;
  entry.gitignoreBypassPaths.clear();
  entry.replayBuffer = [];

  if (count > 0) {
    logger.main.debug('[WorkspaceEventBus] Cleared all gitignore bypasses:', {
      workspacePath: key,
      clearedCount: count,
    });
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

/** Returns true if the relative path is gitignored (but NOT hardcoded-ignored). */
function isGitignored(relativePath: string, ig: Ignore): boolean {
  return ig.ignores(relativePath) || ig.ignores(relativePath + '/');
}

/** Returns true if a file has a .md extension. */
function isMarkdownFile(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() === '.md';
}

/**
 * Determine how a gitignored file should be handled:
 * - 'bypass': dispatch with gitignoreBypassed=true (.md file or in bypass set)
 * - 'drop': filter out (store in replay buffer)
 */
function getGitignoreAction(
  absolutePath: string,
  entry: BusEntry,
): 'bypass' | 'drop' {
  if (entry.gitignoreBypassPaths.has(normalizeToForwardSlash(absolutePath))) return 'bypass';
  if (isMarkdownFile(absolutePath)) return 'bypass';
  return 'drop';
}

/** Add a dropped gitignored event to the replay buffer. */
function addToReplayBuffer(
  entry: BusEntry,
  absolutePath: string,
  eventType: 'change' | 'add' | 'unlink' | 'rename',
): void {
  const now = Date.now();

  // Prune expired entries
  entry.replayBuffer = entry.replayBuffer.filter(
    (e) => now - e.timestamp < REPLAY_BUFFER_TTL_MS,
  );

  // Cap at max size
  if (entry.replayBuffer.length >= REPLAY_BUFFER_MAX) {
    entry.replayBuffer.shift();
  }

  entry.replayBuffer.push({ absolutePath: normalizeToForwardSlash(absolutePath), eventType, timestamp: now });
}

/** Re-dispatch matching events from the replay buffer when a bypass is added. */
function replayDroppedEvents(entry: BusEntry, absolutePath: string): void {
  const now = Date.now();
  const matching: DroppedGitignoreEvent[] = [];
  const remaining: DroppedGitignoreEvent[] = [];

  for (const event of entry.replayBuffer) {
    if (now - event.timestamp >= REPLAY_BUFFER_TTL_MS) continue; // expired
    if (event.absolutePath === absolutePath) {
      matching.push(event);
    } else {
      remaining.push(event);
    }
  }

  entry.replayBuffer = remaining;

  if (matching.length === 0) return;

  // Re-dispatch matching events to all listeners.
  // 'rename' events need an async fs.access check to determine add vs unlink,
  // matching the same logic used in the live startRecursiveWatch path.
  for (const event of matching) {
    switch (event.eventType) {
      case 'change':
        for (const l of entry.listeners.values()) l.onChange(event.absolutePath, true);
        break;
      case 'add':
        for (const l of entry.listeners.values()) l.onAdd(event.absolutePath, true);
        break;
      case 'unlink':
        for (const l of entry.listeners.values()) l.onUnlink(event.absolutePath, true);
        break;
      case 'rename':
        // Determine add vs unlink by checking file existence, same as live path
        fsPromises.access(event.absolutePath).then(
          () => {
            for (const l of entry.listeners.values()) l.onAdd(event.absolutePath, true);
          },
          () => {
            for (const l of entry.listeners.values()) l.onUnlink(event.absolutePath, true);
          },
        );
        break;
    }
  }

  logger.main.debug('[WorkspaceEventBus] Replayed dropped events:', {
    absolutePath,
    count: matching.length,
  });
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
    gitignoreBypassPaths: new Set(),
    replayBuffer: [],
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

      // Stage 1: hardcoded ignores always apply (.git, OS junk)
      if (shouldIgnoreHardcoded(relativePath)) return;

      const absolutePath = path.join(workspacePath, filename);

      // Stage 2: gitignore check with bypass support
      let bypassed = false;
      if (isGitignored(relativePath, ig)) {
        const action = getGitignoreAction(absolutePath, entry);
        if (action === 'drop') {
          // Store in replay buffer for potential late bypass registration.
          // Preserve the raw fs.watch event type so replay can determine add vs unlink.
          const bufferEventType = eventType === 'change' ? 'change' : 'rename';
          addToReplayBuffer(entry, absolutePath, bufferEventType);
          return;
        }
        bypassed = true;
      }

      if (eventType === 'change') {
        for (const l of entry.listeners.values()) l.onChange(absolutePath, bypassed || undefined);
      } else {
        // 'rename' — could be add or delete. Use fs.access to determine.
        fsPromises.access(absolutePath).then(
          () => {
            // File exists — treat as add
            for (const l of entry.listeners.values()) l.onAdd(absolutePath, bypassed || undefined);
          },
          () => {
            // File does not exist — treat as unlink
            for (const l of entry.listeners.values()) l.onUnlink(absolutePath, bypassed || undefined);
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
    // Create entry first so the `ignored` callback can reference bypass set.
    const cb = createCircuitBreaker();
    const entry: BusEntry = {
      watcher: null!,
      refCount: 1,
      listeners: new Map([[subscriberId, listener]]),
      gitignoreFilter: ig,
      circuitBreaker: cb,
      gitignoreBypassPaths: new Set(),
      replayBuffer: [],
    };

    // Chokidar's `ignored` applies both hardcoded and gitignore filtering,
    // but checks the bypass set so explicitly added paths get through.
    // This keeps the perf benefit of not recursing into node_modules etc.
    // Bypassed files inside ignored dirs are added via watcher.add() in addGitignoreBypass.
    const watcher = chokidar.watch(workspacePath, {
      ignored: (filePath: string) => {
        const relativePath = path.relative(workspacePath, filePath);
        if (!relativePath) return false;
        if (shouldIgnoreHardcoded(relativePath)) return true;
        if (!isGitignored(relativePath, ig)) return false;
        // Gitignored — let through if bypassed
        return getGitignoreAction(filePath, entry) === 'drop';
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

    entry.watcher = watcher;
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

    /** Check if an event that passed chokidar's filter was gitignore-bypassed. */
    const isBypassed = (filePath: string): boolean => {
      const relativePath = path.relative(workspacePath, filePath);
      if (!relativePath) return false;
      return isGitignored(relativePath, ig);
    };

    watcher
      .on('change', (filePath: string) => {
        if (checkBreaker()) return;
        const bypassed = isBypassed(filePath) || undefined;
        for (const l of entry.listeners.values()) l.onChange(filePath, bypassed);
      })
      .on('add', (filePath: string) => {
        if (checkBreaker()) return;
        const bypassed = isBypassed(filePath) || undefined;
        for (const l of entry.listeners.values()) l.onAdd(filePath, bypassed);
      })
      .on('unlink', (filePath: string) => {
        if (checkBreaker()) return;
        const bypassed = isBypassed(filePath) || undefined;
        for (const l of entry.listeners.values()) l.onUnlink(filePath, bypassed);
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
