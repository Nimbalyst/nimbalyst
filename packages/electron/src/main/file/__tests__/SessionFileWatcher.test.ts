import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as path from 'path';
import type { FileSnapshotCache } from '../FileSnapshotCache';

// Mock electron
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
}));

// Mock logger
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

// Mock chokidar - shared watcher means chokidar.watch is called once per workspace
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

import {
  SessionFileWatcher,
  getSharedWatcherRefCount,
  getSharedWatcherSessionIds,
  resetSharedWatchers,
} from '../SessionFileWatcher';

function flush(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

async function getChokidarIgnoredFn(): Promise<(filePath: string) => boolean> {
  const chokidar = (await import('chokidar')).default;
  const watchSpy = chokidar.watch as any;
  const lastCall = watchSpy.mock.calls[watchSpy.mock.calls.length - 1];
  return lastCall[1].ignored;
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
    for (const key of Object.keys(mockWatcherHandlers)) {
      delete mockWatcherHandlers[key];
    }
    resetSharedWatchers();

    mockFileContents = {};
    mockReadFile.mockImplementation((filePath: string) => {
      if (filePath in mockFileContents) {
        const value = mockFileContents[filePath];
        if (value instanceof Error) return Promise.reject(value);
        return Promise.resolve(value);
      }
      if (filePath.endsWith('.gitignore')) {
        return Promise.reject(new Error('ENOENT'));
      }
      return Promise.resolve('');
    });
  });

  describe('start/stop lifecycle', () => {
    it('starts and stops with active state updates', async () => {
      const watcher = new SessionFileWatcher();
      const cache = createMockCache();

      await watcher.start(workspacePath, sessionId, cache);
      expect(watcher.isActive()).toBe(true);

      await watcher.stop();
      expect(watcher.isActive()).toBe(false);
    });

    it('handles stop when not started', async () => {
      const watcher = new SessionFileWatcher();
      await watcher.stop();
      expect(watcher.isActive()).toBe(false);
    });
  });

  describe('shared watcher behavior', () => {
    it('shares one chokidar watcher across sessions for the same workspace', async () => {
      const chokidar = (await import('chokidar')).default;
      const watchSpy = chokidar.watch as any;
      watchSpy.mockClear();

      const watcher1 = new SessionFileWatcher();
      const watcher2 = new SessionFileWatcher();

      await watcher1.start(workspacePath, 'session-1', createMockCache());
      await watcher2.start(workspacePath, 'session-2', createMockCache());

      expect(watchSpy).toHaveBeenCalledTimes(1);
      expect(getSharedWatcherRefCount(workspacePath)).toBe(2);
      expect(getSharedWatcherSessionIds(workspacePath).sort()).toEqual(['session-1', 'session-2']);

      await watcher1.stop();
      expect(getSharedWatcherRefCount(workspacePath)).toBe(1);
      expect(mockWatcher.close).not.toHaveBeenCalled();

      await watcher2.stop();
      expect(getSharedWatcherRefCount(workspacePath)).toBe(0);
      expect(mockWatcher.close).toHaveBeenCalledTimes(1);
    });

    it('dispatches change events to all session listeners', async () => {
      const cache1 = createMockCache();
      const cache2 = createMockCache();
      (cache1.getBeforeState as any).mockResolvedValue('before');
      (cache2.getBeforeState as any).mockResolvedValue('before');
      setMockFileContent('/test/workspace/src/file.ts', 'after');

      const cb1 = vi.fn();
      const cb2 = vi.fn();

      const watcher1 = new SessionFileWatcher();
      const watcher2 = new SessionFileWatcher();

      await watcher1.start(workspacePath, 'session-1', cache1, cb1);
      await watcher2.start(workspacePath, 'session-2', cache2, cb2);

      const changeHandler = mockWatcherHandlers.change?.[0];
      expect(changeHandler).toBeDefined();
      changeHandler('/test/workspace/src/file.ts');
      await flush();

      expect(cb1).toHaveBeenCalled();
      expect(cb2).toHaveBeenCalled();

      await watcher1.stop();
      await watcher2.stop();
    });
  });

  describe('change event handling', () => {
    it('emits watcher edit payload and updates cache when content changes', async () => {
      const cache = createMockCache();
      (cache.getBeforeState as any).mockResolvedValue('original content');
      setMockFileContent('/test/workspace/src/file.ts', 'modified content');

      const callback = vi.fn();
      const watcher = new SessionFileWatcher();
      await watcher.start(workspacePath, sessionId, cache, callback);

      const changeHandler = mockWatcherHandlers.change?.[0];
      expect(changeHandler).toBeDefined();
      changeHandler('/test/workspace/src/file.ts');
      await flush();

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          workspacePath,
          filePath: '/test/workspace/src/file.ts',
          beforeContent: 'original content',
          timestamp: expect.any(Number),
        })
      );
      expect(cache.updateSnapshot).toHaveBeenCalledWith('/test/workspace/src/file.ts', 'modified content');

      await watcher.stop();
    });

    it('does not emit event when content is unchanged', async () => {
      const cache = createMockCache();
      (cache.getBeforeState as any).mockResolvedValue('same content');
      setMockFileContent('/test/workspace/src/file.ts', 'same content');

      const callback = vi.fn();
      const watcher = new SessionFileWatcher();
      await watcher.start(workspacePath, sessionId, cache, callback);

      const changeHandler = mockWatcherHandlers.change?.[0];
      changeHandler('/test/workspace/src/file.ts');
      await flush();

      expect(callback).not.toHaveBeenCalled();
      expect(cache.updateSnapshot).toHaveBeenCalledWith('/test/workspace/src/file.ts', 'same content');

      await watcher.stop();
    });

    it('logs no-op skip with reason when content is unchanged', async () => {
      const { logger } = await import('../../utils/logger');
      const cache = createMockCache();
      (cache.getBeforeState as any).mockResolvedValue('same content');
      setMockFileContent('/test/workspace/src/file.ts', 'same content');

      const watcher = new SessionFileWatcher();
      await watcher.start(workspacePath, sessionId, cache);

      const changeHandler = mockWatcherHandlers.change?.[0];
      changeHandler('/test/workspace/src/file.ts');
      await flush();

      expect(logger.main.debug).toHaveBeenCalledWith(
        '[SessionFileWatcher] No-op skip (content unchanged):',
        expect.objectContaining({
          workspacePath,
          filePath: '/test/workspace/src/file.ts',
          sessionId,
          reason: 'no_content_change',
        })
      );

      await watcher.stop();
    });

    it('skips binary files', async () => {
      const cache = createMockCache();
      const callback = vi.fn();
      const watcher = new SessionFileWatcher();

      await watcher.start(workspacePath, sessionId, cache, callback);

      const changeHandler = mockWatcherHandlers.change?.[0];
      await changeHandler('/test/workspace/image.png');

      expect(cache.getBeforeState).not.toHaveBeenCalled();
      expect(callback).not.toHaveBeenCalled();

      await watcher.stop();
    });
  });

  describe('add event handling', () => {
    it('emits add payload with empty before content and updates cache', async () => {
      const cache = createMockCache();
      setMockFileContent('/test/workspace/src/new-file.ts', 'new file content');

      const callback = vi.fn();
      const watcher = new SessionFileWatcher();
      await watcher.start(workspacePath, sessionId, cache, callback);

      const addHandler = mockWatcherHandlers.add?.[0];
      expect(addHandler).toBeDefined();
      addHandler('/test/workspace/src/new-file.ts');
      await flush();

      expect(cache.updateSnapshot).toHaveBeenCalledWith('/test/workspace/src/new-file.ts', 'new file content');
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          workspacePath,
          filePath: '/test/workspace/src/new-file.ts',
          beforeContent: '',
          timestamp: expect.any(Number),
        })
      );

      await watcher.stop();
    });

    it('skips binary files on add', async () => {
      const cache = createMockCache();
      const callback = vi.fn();
      const watcher = new SessionFileWatcher();

      await watcher.start(workspacePath, sessionId, cache, callback);

      const addHandler = mockWatcherHandlers.add?.[0];
      await addHandler('/test/workspace/file.jpg');

      expect(callback).not.toHaveBeenCalled();

      await watcher.stop();
    });
  });

  describe('unlink event handling', () => {
    it('removes snapshot on unlink', async () => {
      const cache = createMockCache();
      const watcher = new SessionFileWatcher();

      await watcher.start(workspacePath, sessionId, cache);

      const unlinkHandler = mockWatcherHandlers.unlink?.[0];
      expect(unlinkHandler).toBeDefined();
      unlinkHandler('/test/workspace/src/deleted.ts');

      expect(cache.removeSnapshot).toHaveBeenCalledWith('/test/workspace/src/deleted.ts');

      await watcher.stop();
    });
  });

  describe('inactive state', () => {
    it('does not process events after stop', async () => {
      const cache = createMockCache();
      const callback = vi.fn();
      const watcher = new SessionFileWatcher();

      await watcher.start(workspacePath, sessionId, cache, callback);
      const changeHandler = mockWatcherHandlers.change?.[0];
      const addHandler = mockWatcherHandlers.add?.[0];

      await watcher.stop();

      if (changeHandler) changeHandler('/test/workspace/src/file.ts');
      if (addHandler) addHandler('/test/workspace/src/new.ts');
      await flush();

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('gitignore filtering', () => {
    it('always ignores .git directory', async () => {
      const watcher = new SessionFileWatcher();
      await watcher.start(workspacePath, sessionId, createMockCache());

      const ignoredFn = await getChokidarIgnoredFn();
      expect(ignoredFn(path.join(workspacePath, '.git'))).toBe(true);
      expect(ignoredFn(path.join(workspacePath, '.git', 'objects', 'abc'))).toBe(true);
      expect(ignoredFn(path.join(workspacePath, 'src', 'file.ts'))).toBe(false);

      await watcher.stop();
    });

    it('uses .gitignore patterns when present', async () => {
      setMockGitignore(workspacePath, 'node_modules/\ndist/\n*.log\n');

      const watcher = new SessionFileWatcher();
      await watcher.start(workspacePath, sessionId, createMockCache());

      const ignoredFn = await getChokidarIgnoredFn();
      expect(ignoredFn(path.join(workspacePath, 'node_modules'))).toBe(true);
      expect(ignoredFn(path.join(workspacePath, 'dist', 'bundle.js'))).toBe(true);
      expect(ignoredFn(path.join(workspacePath, 'debug.log'))).toBe(true);
      expect(ignoredFn(path.join(workspacePath, 'src', 'file.ts'))).toBe(false);

      await watcher.stop();
    });

    it('uses fallback patterns when .gitignore is missing', async () => {
      const watcher = new SessionFileWatcher();
      await watcher.start(workspacePath, sessionId, createMockCache());

      const ignoredFn = await getChokidarIgnoredFn();
      expect(ignoredFn(path.join(workspacePath, 'node_modules'))).toBe(true);
      expect(ignoredFn(path.join(workspacePath, 'dist', 'bundle.js'))).toBe(true);
      expect(ignoredFn(path.join(workspacePath, '.git'))).toBe(true);
      expect(ignoredFn(path.join(workspacePath, 'src', 'file.ts'))).toBe(false);

      await watcher.stop();
    });
  });
});
