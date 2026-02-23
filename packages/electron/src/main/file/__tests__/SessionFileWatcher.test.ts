import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as path from 'path';
import type { FileSnapshotCache } from '../FileSnapshotCache';
import type { HistoryManager, HistoryTag } from '../../HistoryManager';

// Mock electron
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
}));

// Mock the logger module
vi.mock('../../utils/logger', () => ({
  logger: {
    main: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  },
}));

// Mock chokidar — shared watcher means chokidar.watch is called once per workspace
const mockWatcherHandlers: Record<string, Function[]> = {};
const mockWatcher = {
  on: vi.fn((event: string, handler: Function) => {
    if (!mockWatcherHandlers[event]) {
      mockWatcherHandlers[event] = [];
    }
    mockWatcherHandlers[event].push(handler);
    return mockWatcher;
  }),
  close: vi.fn(() => Promise.resolve()),
};

vi.mock('chokidar', () => ({
  default: {
    watch: vi.fn(() => mockWatcher),
  },
}));

// Mock fs/promises
const mockReadFile = vi.fn();
vi.mock('fs/promises', () => ({
  readFile: (...args: any[]) => mockReadFile(...args),
}));

import { SessionFileWatcher, getSharedWatcherCount, getSharedWatcherRefCount, resetSharedWatchers } from '../SessionFileWatcher';

/** Helper to extract the `ignored` callback passed to chokidar.watch(). */
async function getChokidarIgnoredFn(): Promise<(filePath: string) => boolean> {
  const chokidar = (await import('chokidar')).default;
  const watchSpy = chokidar.watch as any;
  const lastCall = watchSpy.mock.calls[watchSpy.mock.calls.length - 1];
  return lastCall[1].ignored;
}

/** Flush microtasks so async event handlers complete. */
function flush(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function createMockCache(): FileSnapshotCache {
  return {
    getBeforeState: vi.fn(),
    updateSnapshot: vi.fn(),
    removeSnapshot: vi.fn(),
    startSession: vi.fn(),
    stopSession: vi.fn(),
    getStats: vi.fn(() => ({ fileCount: 0, totalBytes: 0, sessionId: null, isGitRepo: false })),
  } as any;
}

function createMockHistoryManager(): HistoryManager {
  return {
    createTag: vi.fn(),
    getPendingTags: vi.fn(() => Promise.resolve([])),
    getDiffBaseline: vi.fn(),
    getTag: vi.fn(),
    updateTagStatus: vi.fn(),
    hasTag: vi.fn(),
    initialize: vi.fn(),
    createSnapshot: vi.fn(),
    listSnapshots: vi.fn(),
    loadSnapshot: vi.fn(),
    deleteSnapshot: vi.fn(),
    cleanup: vi.fn(),
    listWorkspaceFiles: vi.fn(),
    deleteWorkspaceHistory: vi.fn(),
    updateTagContent: vi.fn(),
    createIncrementalApprovalTag: vi.fn(),
    markTagAsReviewed: vi.fn(),
    getPendingCount: vi.fn(),
    getPendingFilesForSession: vi.fn(),
    getPendingCountForSession: vi.fn(),
    clearAllPending: vi.fn(),
    clearPendingForSession: vi.fn(),
  } as any;
}

/** Map of file path -> content (or Error to reject). Used by mockReadFile. */
let mockFileContents: Record<string, string | Error> = {};

function setMockFileContent(filePath: string, content: string | Error): void {
  mockFileContents[filePath] = content;
}

function setMockGitignore(workspacePath: string, content: string): void {
  mockFileContents[path.join(workspacePath, '.gitignore')] = content;
}

describe('SessionFileWatcher', () => {
  const workspacePath = '/test/workspace';
  const sessionId = 'test-session-1';

  beforeEach(() => {
    vi.clearAllMocks();
    // Clear handler registry
    for (const key of Object.keys(mockWatcherHandlers)) {
      delete mockWatcherHandlers[key];
    }
    // Reset shared watcher state so each test gets a fresh chokidar instance
    resetSharedWatchers();

    // Default: no .gitignore (ENOENT), empty string for other files.
    // Tests override via setMockFileContent() or setMockGitignore().
    mockFileContents = {};
    mockReadFile.mockImplementation((filePath: string) => {
      if (filePath in mockFileContents) {
        const val = mockFileContents[filePath];
        if (val instanceof Error) return Promise.reject(val);
        return Promise.resolve(val);
      }
      if (filePath.endsWith('.gitignore')) {
        return Promise.reject(new Error('ENOENT'));
      }
      return Promise.resolve('');
    });
  });

  describe('start/stop lifecycle', () => {
    it('should start watching and set active state', async () => {
      const watcher = new SessionFileWatcher();
      const cache = createMockCache();
      const hm = createMockHistoryManager();

      await watcher.start(workspacePath, sessionId, cache, hm);

      expect(watcher.isActive()).toBe(true);

      await watcher.stop();
    });

    it('should stop watching and clear active state', async () => {
      const watcher = new SessionFileWatcher();
      const cache = createMockCache();
      const hm = createMockHistoryManager();

      await watcher.start(workspacePath, sessionId, cache, hm);
      await watcher.stop();

      expect(watcher.isActive()).toBe(false);
    });

    it('should handle stop when not started', async () => {
      const watcher = new SessionFileWatcher();
      await watcher.stop();
      expect(watcher.isActive()).toBe(false);
    });
  });

  describe('shared watcher deduplication', () => {
    it('should share a single chokidar watcher for multiple sessions on same workspace', async () => {
      const chokidar = (await import('chokidar')).default;
      const watchSpy = chokidar.watch as any;
      watchSpy.mockClear();

      const watcher1 = new SessionFileWatcher();
      const watcher2 = new SessionFileWatcher();
      const cache1 = createMockCache();
      const cache2 = createMockCache();
      const hm = createMockHistoryManager();

      await watcher1.start(workspacePath, 'session-1', cache1, hm);
      await watcher2.start(workspacePath, 'session-2', cache2, hm);

      // Only one chokidar.watch() call for the same workspace
      expect(watchSpy).toHaveBeenCalledTimes(1);
      expect(getSharedWatcherRefCount(workspacePath)).toBe(2);

      await watcher1.stop();
      expect(getSharedWatcherRefCount(workspacePath)).toBe(1);
      // Chokidar watcher should still be open (session-2 still using it)
      expect(mockWatcher.close).not.toHaveBeenCalled();

      await watcher2.stop();
      // Now it should be closed
      expect(mockWatcher.close).toHaveBeenCalledTimes(1);
      expect(getSharedWatcherRefCount(workspacePath)).toBe(0);
    });

    it('should dispatch events to all sessions on same workspace', async () => {
      const watcher1 = new SessionFileWatcher();
      const watcher2 = new SessionFileWatcher();
      const cache1 = createMockCache();
      const cache2 = createMockCache();
      const hm = createMockHistoryManager();

      (cache1.getBeforeState as any).mockResolvedValue('original');
      (cache2.getBeforeState as any).mockResolvedValue('original');
      setMockFileContent('/test/workspace/src/file.ts', 'modified');

      await watcher1.start(workspacePath, 'session-1', cache1, hm);
      await watcher2.start(workspacePath, 'session-2', cache2, hm);

      // Trigger a change event on the shared watcher
      const changeHandler = mockWatcherHandlers['change']?.[0];
      expect(changeHandler).toBeDefined();
      await changeHandler('/test/workspace/src/file.ts');

      // Both caches should have been updated
      expect(cache1.getBeforeState).toHaveBeenCalled();
      expect(cache2.getBeforeState).toHaveBeenCalled();

      await watcher1.stop();
      await watcher2.stop();
    });
  });

  describe('change event handling', () => {
    it('should create a pre-edit tag when file content changes', async () => {
      const cache = createMockCache();
      const hm = createMockHistoryManager();
      const watcher = new SessionFileWatcher();

      (cache.getBeforeState as any).mockResolvedValue('original content');
      setMockFileContent('/test/workspace/src/file.ts', 'modified content');

      await watcher.start(workspacePath, sessionId, cache, hm);

      const changeHandler = mockWatcherHandlers['change']?.[0];
      expect(changeHandler).toBeDefined();
      changeHandler('/test/workspace/src/file.ts');
      await flush();

      expect(cache.getBeforeState).toHaveBeenCalledWith('/test/workspace/src/file.ts');
      expect(hm.createTag).toHaveBeenCalledWith(
        '/test/workspace/src/file.ts',
        expect.stringContaining('ai-edit-pending-test-session-1-'),
        'original content',
        sessionId,
        expect.stringContaining('codex-file-change-')
      );
      expect(cache.updateSnapshot).toHaveBeenCalledWith('/test/workspace/src/file.ts', 'modified content');

      await watcher.stop();
    });

    it('should skip tag creation when content has not changed', async () => {
      const cache = createMockCache();
      const hm = createMockHistoryManager();
      const watcher = new SessionFileWatcher();

      (cache.getBeforeState as any).mockResolvedValue('same content');
      setMockFileContent('/test/workspace/src/file.ts', 'same content');

      await watcher.start(workspacePath, sessionId, cache, hm);

      const changeHandler = mockWatcherHandlers['change']?.[0];
      changeHandler('/test/workspace/src/file.ts');
      await flush();

      expect(hm.createTag).not.toHaveBeenCalled();
      expect(cache.updateSnapshot).toHaveBeenCalledWith('/test/workspace/src/file.ts', 'same content');

      await watcher.stop();
    });

    it('should skip tag creation when a pending tag already exists', async () => {
      const cache = createMockCache();
      const hm = createMockHistoryManager();
      const watcher = new SessionFileWatcher();

      (cache.getBeforeState as any).mockResolvedValue('original content');
      setMockFileContent('/test/workspace/src/file.ts', 'modified content');
      (hm.getPendingTags as any).mockResolvedValue([{ id: 'existing-tag' } as HistoryTag]);

      await watcher.start(workspacePath, sessionId, cache, hm);

      const changeHandler = mockWatcherHandlers['change']?.[0];
      await changeHandler('/test/workspace/src/file.ts');

      expect(hm.createTag).not.toHaveBeenCalled();

      await watcher.stop();
    });

    it('should skip binary files', async () => {
      const cache = createMockCache();
      const hm = createMockHistoryManager();
      const watcher = new SessionFileWatcher();

      await watcher.start(workspacePath, sessionId, cache, hm);

      const changeHandler = mockWatcherHandlers['change']?.[0];
      await changeHandler('/test/workspace/image.png');

      expect(cache.getBeforeState).not.toHaveBeenCalled();
      expect(hm.createTag).not.toHaveBeenCalled();

      await watcher.stop();
    });

    it('should create a tag with empty baseline when before state is null', async () => {
      const cache = createMockCache();
      const hm = createMockHistoryManager();
      const watcher = new SessionFileWatcher();

      (cache.getBeforeState as any).mockResolvedValue(null);
      setMockFileContent('/test/workspace/src/file.ts', 'new content');

      await watcher.start(workspacePath, sessionId, cache, hm);

      const changeHandler = mockWatcherHandlers['change']?.[0];
      changeHandler('/test/workspace/src/file.ts');
      await flush();

      expect(hm.createTag).toHaveBeenCalledWith(
        '/test/workspace/src/file.ts',
        expect.stringContaining('ai-edit-pending-test-session-1-'),
        '',
        sessionId,
        expect.stringContaining('codex-file-change-')
      );
      expect(cache.updateSnapshot).toHaveBeenCalledWith('/test/workspace/src/file.ts', 'new content');

      await watcher.stop();
    });

    it('should not create a tag for changes outside the workspace', async () => {
      const cache = createMockCache();
      const hm = createMockHistoryManager();
      const watcher = new SessionFileWatcher();

      (cache.getBeforeState as any).mockResolvedValue(null);
      setMockFileContent('/outside/workspace/file.ts', 'new content');

      await watcher.start(workspacePath, sessionId, cache, hm);

      const changeHandler = mockWatcherHandlers['change']?.[0];
      await changeHandler('/outside/workspace/file.ts');

      expect(hm.createTag).not.toHaveBeenCalled();

      await watcher.stop();
    });

    it('should handle file read errors gracefully', async () => {
      const cache = createMockCache();
      const hm = createMockHistoryManager();
      const watcher = new SessionFileWatcher();

      (cache.getBeforeState as any).mockResolvedValue('original');
      setMockFileContent('/test/workspace/src/deleted.ts', new Error('ENOENT'));

      await watcher.start(workspacePath, sessionId, cache, hm);

      const changeHandler = mockWatcherHandlers['change']?.[0];
      // Should not throw
      await changeHandler('/test/workspace/src/deleted.ts');

      expect(hm.createTag).not.toHaveBeenCalled();

      await watcher.stop();
    });
  });

  describe('add event handling', () => {
    it('should create a pre-edit tag with empty before content for new files', async () => {
      const cache = createMockCache();
      const hm = createMockHistoryManager();
      const watcher = new SessionFileWatcher();

      setMockFileContent('/test/workspace/src/new-file.ts', 'new file content');

      await watcher.start(workspacePath, sessionId, cache, hm);

      const addHandler = mockWatcherHandlers['add']?.[0];
      expect(addHandler).toBeDefined();
      addHandler('/test/workspace/src/new-file.ts');
      await flush();

      expect(hm.createTag).toHaveBeenCalledWith(
        '/test/workspace/src/new-file.ts',
        expect.stringContaining('ai-edit-pending-test-session-1-'),
        '',
        sessionId,
        expect.stringContaining('codex-file-add-')
      );
      expect(cache.updateSnapshot).toHaveBeenCalledWith('/test/workspace/src/new-file.ts', 'new file content');

      await watcher.stop();
    });

    it('should skip if pending tag already exists', async () => {
      const cache = createMockCache();
      const hm = createMockHistoryManager();
      const watcher = new SessionFileWatcher();

      (hm.getPendingTags as any).mockResolvedValue([{ id: 'existing' } as HistoryTag]);
      setMockFileContent('/test/workspace/src/new-file.ts', 'content');

      await watcher.start(workspacePath, sessionId, cache, hm);

      const addHandler = mockWatcherHandlers['add']?.[0];
      await addHandler('/test/workspace/src/new-file.ts');

      expect(hm.createTag).not.toHaveBeenCalled();

      await watcher.stop();
    });

    it('should skip binary files on add', async () => {
      const cache = createMockCache();
      const hm = createMockHistoryManager();
      const watcher = new SessionFileWatcher();

      await watcher.start(workspacePath, sessionId, cache, hm);

      const addHandler = mockWatcherHandlers['add']?.[0];
      await addHandler('/test/workspace/image.jpg');

      expect(hm.createTag).not.toHaveBeenCalled();

      await watcher.stop();
    });
  });

  describe('unlink event handling', () => {
    it('should remove from cache on file deletion', async () => {
      const cache = createMockCache();
      const hm = createMockHistoryManager();
      const watcher = new SessionFileWatcher();

      await watcher.start(workspacePath, sessionId, cache, hm);

      const unlinkHandler = mockWatcherHandlers['unlink']?.[0];
      expect(unlinkHandler).toBeDefined();
      unlinkHandler('/test/workspace/src/deleted.ts');

      expect(cache.removeSnapshot).toHaveBeenCalledWith('/test/workspace/src/deleted.ts');

      await watcher.stop();
    });
  });

  describe('inactive state', () => {
    it('should not process events after stop', async () => {
      const cache = createMockCache();
      const hm = createMockHistoryManager();
      const watcher = new SessionFileWatcher();

      await watcher.start(workspacePath, sessionId, cache, hm);

      const changeHandler = mockWatcherHandlers['change']?.[0];
      const addHandler = mockWatcherHandlers['add']?.[0];

      await watcher.stop();

      // Events after stop should be no-ops
      if (changeHandler) await changeHandler('/test/workspace/src/file.ts');
      if (addHandler) await addHandler('/test/workspace/src/new.ts');

      expect(hm.createTag).not.toHaveBeenCalled();
    });
  });

  describe('gitignore-based filtering', () => {
    it('should always ignore .git directory even without a .gitignore', async () => {
      const watcher = new SessionFileWatcher();
      const cache = createMockCache();
      const hm = createMockHistoryManager();
      // No .gitignore set (default ENOENT)

      await watcher.start(workspacePath, sessionId, cache, hm);

      const ignoredFn = await getChokidarIgnoredFn();

      expect(ignoredFn(path.join(workspacePath, '.git'))).toBe(true);
      expect(ignoredFn(path.join(workspacePath, '.git', 'objects', 'abc'))).toBe(true);
      expect(ignoredFn(path.join(workspacePath, 'src', 'file.ts'))).toBe(false);

      await watcher.stop();
    });

    it('should not ignore the workspace root itself', async () => {
      const watcher = new SessionFileWatcher();
      const cache = createMockCache();
      const hm = createMockHistoryManager();

      await watcher.start(workspacePath, sessionId, cache, hm);

      const ignoredFn = await getChokidarIgnoredFn();
      expect(ignoredFn(workspacePath)).toBe(false);

      await watcher.stop();
    });

    it('should use gitignore patterns when .gitignore exists', async () => {
      setMockGitignore(workspacePath, 'node_modules/\ndist/\n*.log\n');

      const watcher = new SessionFileWatcher();
      const cache = createMockCache();
      const hm = createMockHistoryManager();

      await watcher.start(workspacePath, sessionId, cache, hm);

      const ignoredFn = await getChokidarIgnoredFn();

      expect(ignoredFn(path.join(workspacePath, 'node_modules'))).toBe(true);
      expect(ignoredFn(path.join(workspacePath, 'node_modules', 'foo', 'index.js'))).toBe(true);
      expect(ignoredFn(path.join(workspacePath, 'dist'))).toBe(true);
      expect(ignoredFn(path.join(workspacePath, 'dist', 'bundle.js'))).toBe(true);
      expect(ignoredFn(path.join(workspacePath, 'debug.log'))).toBe(true);
      expect(ignoredFn(path.join(workspacePath, 'src', 'file.ts'))).toBe(false);
      expect(ignoredFn(path.join(workspacePath, 'README.md'))).toBe(false);

      await watcher.stop();
    });

    it('should watch everything (except .git) when no .gitignore exists', async () => {
      // Default: no .gitignore (ENOENT)
      const watcher = new SessionFileWatcher();
      const cache = createMockCache();
      const hm = createMockHistoryManager();

      await watcher.start(workspacePath, sessionId, cache, hm);

      const ignoredFn = await getChokidarIgnoredFn();

      // These would have been ignored by the old hardcoded list, but not anymore
      expect(ignoredFn(path.join(workspacePath, 'node_modules', 'foo'))).toBe(false);
      expect(ignoredFn(path.join(workspacePath, 'dist', 'bundle.js'))).toBe(false);
      // .git is still always ignored
      expect(ignoredFn(path.join(workspacePath, '.git'))).toBe(true);

      await watcher.stop();
    });
  });
});
