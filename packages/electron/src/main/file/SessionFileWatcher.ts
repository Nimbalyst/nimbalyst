import chokidar, { FSWatcher } from 'chokidar';
import * as fs from 'fs/promises';
import * as path from 'path';
import ignore, { Ignore } from 'ignore';
import { BrowserWindow } from 'electron';
import { logger } from '../utils/logger';
import type { FileSnapshotCache } from './FileSnapshotCache';

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.svg',
  '.mp3', '.mp4', '.wav', '.ogg', '.webm', '.flac',
  '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.exe', '.dll', '.so', '.dylib', '.o', '.a',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.sqlite', '.db', '.lock',
  '.wasm', '.node',
]);

/** TTL for editor save markers (ms). Must exceed chokidar's awaitWriteFinish delay. */
const EDITOR_SAVE_TTL_MS = 2000;
const FILE_CHANGED_NOTIFY_DEDUPE_MS = 250;

// ---------------------------------------------------------------------------
// SharedFSWatcher – one chokidar instance per workspace path, ref-counted
// ---------------------------------------------------------------------------

interface SharedWatcherEntry {
  watcher: FSWatcher;
  /** Session IDs currently using this watcher */
  refCount: number;
  /** Callbacks to invoke for each fs event, keyed by session ID */
  listeners: Map<string, SharedWatcherListener>;
}

interface SharedWatcherListener {
  onChange: (filePath: string) => void;
  onAdd: (filePath: string) => void;
  onUnlink: (filePath: string) => void;
}

/** Global registry of shared chokidar watchers, keyed by normalized workspace path. */
const sharedWatchers = new Map<string, SharedWatcherEntry>();

/** Fallback patterns used when no .gitignore exists (e.g. non-git projects). */
const FALLBACK_IGNORE_PATTERNS = [
  'node_modules/',
  '.DS_Store',
  'Thumbs.db',
  'dist/',
  'build/',
  'out/',
  'coverage/',
  '.next/',
  '.nuxt/',
  '.cache/',
  '.turbo/',
  '.svelte-kit/',
];

async function loadGitignoreFilter(workspacePath: string): Promise<Ignore> {
  const gitignorePath = path.join(workspacePath, '.gitignore');
  try {
    const content = await fs.readFile(gitignorePath, 'utf-8');
    return ignore().add(content);
  } catch {
    return ignore().add(FALLBACK_IGNORE_PATTERNS);
  }
}

async function acquireSharedWatcher(
  workspacePath: string,
  sessionId: string,
  listener: SharedWatcherListener,
): Promise<void> {
  const key = path.resolve(workspacePath);
  const existing = sharedWatchers.get(key);

  if (existing) {
    existing.refCount++;
    existing.listeners.set(sessionId, listener);
    logger.main.info('[SessionFileWatcher] Reusing shared watcher for workspace:', {
      workspacePath: key,
      sessionId,
      refCount: existing.refCount,
    });
    return;
  }

  const ig = await loadGitignoreFilter(workspacePath);

  const watcher = chokidar.watch(workspacePath, {
    ignored: (filePath: string) => {
      const relativePath = path.relative(workspacePath, filePath);
      if (!relativePath) return false;

      if (relativePath === '.git' || relativePath.startsWith('.git' + path.sep)) {
        return true;
      }

      // Test both as file and as directory (trailing slash) so that
      // directory-only patterns like "node_modules/" match the directory
      // itself, preventing chokidar from recursing into it.
      return ig.ignores(relativePath) || ig.ignores(relativePath + '/');
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
  });

  const entry: SharedWatcherEntry = {
    watcher,
    refCount: 1,
    listeners: new Map([[sessionId, listener]]),
  };
  sharedWatchers.set(key, entry);

  watcher
    .on('change', (filePath: string) => {
      for (const l of entry.listeners.values()) l.onChange(filePath);
    })
    .on('add', (filePath: string) => {
      for (const l of entry.listeners.values()) l.onAdd(filePath);
    })
    .on('unlink', (filePath: string) => {
      for (const l of entry.listeners.values()) l.onUnlink(filePath);
    })
    .on('error', (error: unknown) => {
      const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
      if (code === 'EPERM' || code === 'EACCES' || code === 'UNKNOWN') {
        logger.main.debug('[SessionFileWatcher] Skipping unwatchable path:', error);
      } else {
        logger.main.error('[SessionFileWatcher] Watcher error:', error);
      }
    });

  logger.main.info('[SessionFileWatcher] Created shared watcher for workspace:', {
    workspacePath: key,
    sessionId,
  });
}

async function releaseSharedWatcher(workspacePath: string, sessionId: string): Promise<void> {
  const key = path.resolve(workspacePath);
  const entry = sharedWatchers.get(key);
  if (!entry) return;

  entry.listeners.delete(sessionId);
  entry.refCount--;

  if (entry.refCount <= 0) {
    sharedWatchers.delete(key);
    await entry.watcher.close();
    logger.main.info('[SessionFileWatcher] Closed shared watcher for workspace:', {
      workspacePath: key,
      lastSessionId: sessionId,
    });
  } else {
    logger.main.info('[SessionFileWatcher] Released shared watcher ref:', {
      workspacePath: key,
      sessionId,
      remainingRefCount: entry.refCount,
    });
  }
}

/** Visible for testing / diagnostics. */
export function getSharedWatcherCount(): number {
  return sharedWatchers.size;
}

/** Visible for testing. */
export function getSharedWatcherRefCount(workspacePath: string): number {
  return sharedWatchers.get(path.resolve(workspacePath))?.refCount ?? 0;
}

/** Active session IDs currently attached to the shared watcher for a workspace. */
export function getSharedWatcherSessionIds(workspacePath: string): string[] {
  const entry = sharedWatchers.get(path.resolve(workspacePath));
  if (!entry) return [];
  return [...entry.listeners.keys()];
}

/** Reset shared watcher state. Only for tests. */
export function resetSharedWatchers(): void {
  sharedWatchers.clear();
}

// ---------------------------------------------------------------------------
// SessionFileWatcher – per-session wrapper that ref-counts into SharedFSWatcher
// ---------------------------------------------------------------------------

export interface SessionFileWatcherEditEvent {
  workspacePath: string;
  filePath: string;
  timestamp: number;
  beforeContent?: string | null;
}

export class SessionFileWatcher {
  private cache: FileSnapshotCache | null = null;
  private sessionId: string | null = null;
  private workspacePath: string | null = null;
  private active = false;
  private onFileChanged: ((event: SessionFileWatcherEditEvent) => Promise<void> | void) | null = null;

  /**
   * File paths recently saved by the Nimbalyst editor (user saves).
   * These are excluded from AI tool call matching so human edits
   * don't get attributed to AI tool calls.
   */
  private static recentEditorSaves = new Map<string, number>();
  private static recentDiskNotifications = new Map<string, number>();

  /**
   * Mark a file as recently saved by the editor.
   * Called from FileHandlers when the user saves a file (Cmd+S / autosave).
   */
  static markEditorSave(filePath: string): void {
    SessionFileWatcher.recentEditorSaves.set(path.normalize(filePath), Date.now());
  }

  private isRecentEditorSave(filePath: string): boolean {
    const normalized = path.normalize(filePath);
    const savedAt = SessionFileWatcher.recentEditorSaves.get(normalized);
    if (savedAt === undefined) return false;
    if (Date.now() - savedAt > EDITOR_SAVE_TTL_MS) {
      SessionFileWatcher.recentEditorSaves.delete(normalized);
      return false;
    }
    return true;
  }

  async start(
    workspacePath: string,
    sessionId: string,
    cache: FileSnapshotCache,
    onFileChanged?: (event: SessionFileWatcherEditEvent) => Promise<void> | void
  ): Promise<void> {
    await this.stop();

    this.cache = cache;
    this.sessionId = sessionId;
    this.workspacePath = workspacePath;
    this.active = true;
    this.onFileChanged = onFileChanged ?? null;

    await acquireSharedWatcher(workspacePath, sessionId, {
      onChange: (filePath: string) => this.handleChange(filePath),
      onAdd: (filePath: string) => this.handleAdd(filePath),
      onUnlink: (filePath: string) => this.handleUnlink(filePath),
    });

    logger.main.info('[SessionFileWatcher] Started watching:', { workspacePath, sessionId });
  }

  async stop(): Promise<void> {
    if (this.workspacePath && this.sessionId) {
      await releaseSharedWatcher(this.workspacePath, this.sessionId);
    }
    this.cache = null;
    this.sessionId = null;
    this.workspacePath = null;
    this.active = false;
    this.onFileChanged = null;
  }

  isActive(): boolean {
    return this.active;
  }

  private isBinaryPath(filePath: string): boolean {
    return BINARY_EXTENSIONS.has(path.extname(filePath).toLowerCase());
  }

  private async handleChange(filePath: string): Promise<void> {
    if (!this.active || !this.cache || !this.sessionId || !this.workspacePath) return;
    if (this.isBinaryPath(filePath)) return;
    if (this.isRecentEditorSave(filePath)) return;
    if (!this.isPathInWorkspace(filePath, this.workspacePath)) return;

    try {
      logger.main.debug('[SessionFileWatcher] Change event received:', {
        sessionId: this.sessionId,
        filePath,
      });

      const beforeContent = await this.cache.getBeforeState(filePath);

      let currentContent: string;
      try {
        currentContent = await fs.readFile(filePath, 'utf-8');
      } catch {
        return; // File may have been deleted between event and read
      }

      if (beforeContent !== null && beforeContent === currentContent) {
        this.cache.updateSnapshot(filePath, currentContent);
        return;
      }

      const timestamp = Date.now();
      if (this.onFileChanged) {
        await this.onFileChanged({
          workspacePath: this.workspacePath,
          filePath,
          timestamp,
          beforeContent,
        });
      }

      this.notifyFileChanged(filePath);
      logger.main.debug('[SessionFileWatcher] Emitted change event:', {
        sessionId: this.sessionId,
        filePath,
        timestamp,
        hasBeforeContent: beforeContent !== null,
      });

      // Update cache with current content for subsequent edits
      this.cache.updateSnapshot(filePath, currentContent);
    } catch (error) {
      logger.main.error('[SessionFileWatcher] Error handling file change:', error);
    }
  }

  private async handleAdd(filePath: string): Promise<void> {
    if (!this.active || !this.cache || !this.sessionId || !this.workspacePath) return;
    if (this.isBinaryPath(filePath)) return;
    if (this.isRecentEditorSave(filePath)) return;
    if (!this.isPathInWorkspace(filePath, this.workspacePath)) return;

    try {
      logger.main.debug('[SessionFileWatcher] Add event received:', {
        sessionId: this.sessionId,
        filePath,
      });

      // Cache the new file content
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        this.cache.updateSnapshot(filePath, content);
      } catch {
        // File may have been deleted already
        return;
      }

      const timestamp = Date.now();
      if (this.onFileChanged) {
        await this.onFileChanged({
          workspacePath: this.workspacePath,
          filePath,
          timestamp,
          beforeContent: '',
        });
      }

      this.notifyFileChanged(filePath);
      logger.main.debug('[SessionFileWatcher] Emitted add event:', {
        sessionId: this.sessionId,
        filePath,
        timestamp,
      });
    } catch (error) {
      logger.main.error('[SessionFileWatcher] Error handling file add:', error);
    }
  }

  private handleUnlink(filePath: string): void {
    if (!this.active || !this.cache) return;
    this.cache.removeSnapshot(filePath);
  }

  private isPathInWorkspace(filePath: string, workspacePath: string): boolean {
    const resolvedFile = path.resolve(filePath);
    const resolvedWorkspace = path.resolve(workspacePath);
    return resolvedFile === resolvedWorkspace || resolvedFile.startsWith(resolvedWorkspace + path.sep);
  }

  private notifyFileChanged(filePath: string): void {
    const normalized = path.normalize(filePath);
    const now = Date.now();

    for (const [trackedPath, notifiedAt] of SessionFileWatcher.recentDiskNotifications.entries()) {
      if ((now - notifiedAt) > FILE_CHANGED_NOTIFY_DEDUPE_MS) {
        SessionFileWatcher.recentDiskNotifications.delete(trackedPath);
      }
    }

    const lastNotifiedAt = SessionFileWatcher.recentDiskNotifications.get(normalized);
    if (lastNotifiedAt != null && (now - lastNotifiedAt) < FILE_CHANGED_NOTIFY_DEDUPE_MS) {
      return;
    }
    SessionFileWatcher.recentDiskNotifications.set(normalized, now);

    const windows = BrowserWindow.getAllWindows();
    for (const window of windows) {
      if (!window.isDestroyed()) {
        window.webContents.send('file-changed-on-disk', { path: filePath });
      }
    }
  }
}
