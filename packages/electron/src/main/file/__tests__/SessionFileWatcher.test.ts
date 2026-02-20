import { describe, it, expect, beforeEach, vi } from 'vitest';
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

// Mock chokidar
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

import { SessionFileWatcher } from '../SessionFileWatcher';

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

describe('SessionFileWatcher', () => {
  const workspacePath = '/test/workspace';
  const sessionId = 'test-session-1';

  beforeEach(() => {
    vi.clearAllMocks();
    // Clear handler registry
    for (const key of Object.keys(mockWatcherHandlers)) {
      delete mockWatcherHandlers[key];
    }
  });

  describe('start/stop lifecycle', () => {
    it('should start watching and set active state', async () => {
      const watcher = new SessionFileWatcher();
      const cache = createMockCache();
      const hm = createMockHistoryManager();

      await watcher.start(workspacePath, sessionId, cache, hm);

      expect(watcher.isActive()).toBe(true);
    });

    it('should stop watching and clear active state', async () => {
      const watcher = new SessionFileWatcher();
      const cache = createMockCache();
      const hm = createMockHistoryManager();

      await watcher.start(workspacePath, sessionId, cache, hm);
      await watcher.stop();

      expect(watcher.isActive()).toBe(false);
      expect(mockWatcher.close).toHaveBeenCalled();
    });

    it('should handle stop when not started', async () => {
      const watcher = new SessionFileWatcher();
      await watcher.stop();
      expect(watcher.isActive()).toBe(false);
    });
  });

  describe('change event handling', () => {
    it('should create a pre-edit tag when file content changes', async () => {
      const cache = createMockCache();
      const hm = createMockHistoryManager();
      const watcher = new SessionFileWatcher();

      (cache.getBeforeState as any).mockResolvedValue('original content');
      mockReadFile.mockResolvedValue('modified content');

      await watcher.start(workspacePath, sessionId, cache, hm);

      const changeHandler = mockWatcherHandlers['change']?.[0];
      expect(changeHandler).toBeDefined();
      await changeHandler('/test/workspace/src/file.ts');

      expect(cache.getBeforeState).toHaveBeenCalledWith('/test/workspace/src/file.ts');
      expect(hm.createTag).toHaveBeenCalledWith(
        '/test/workspace/src/file.ts',
        expect.stringContaining('ai-edit-pending-test-session-1-'),
        'original content',
        sessionId,
        expect.stringContaining('codex-file-change-')
      );
      expect(cache.updateSnapshot).toHaveBeenCalledWith('/test/workspace/src/file.ts', 'modified content');
    });

    it('should skip tag creation when content has not changed', async () => {
      const cache = createMockCache();
      const hm = createMockHistoryManager();
      const watcher = new SessionFileWatcher();

      (cache.getBeforeState as any).mockResolvedValue('same content');
      mockReadFile.mockResolvedValue('same content');

      await watcher.start(workspacePath, sessionId, cache, hm);

      const changeHandler = mockWatcherHandlers['change']?.[0];
      await changeHandler('/test/workspace/src/file.ts');

      expect(hm.createTag).not.toHaveBeenCalled();
      expect(cache.updateSnapshot).toHaveBeenCalledWith('/test/workspace/src/file.ts', 'same content');
    });

    it('should skip tag creation when a pending tag already exists', async () => {
      const cache = createMockCache();
      const hm = createMockHistoryManager();
      const watcher = new SessionFileWatcher();

      (cache.getBeforeState as any).mockResolvedValue('original content');
      mockReadFile.mockResolvedValue('modified content');
      (hm.getPendingTags as any).mockResolvedValue([{ id: 'existing-tag' } as HistoryTag]);

      await watcher.start(workspacePath, sessionId, cache, hm);

      const changeHandler = mockWatcherHandlers['change']?.[0];
      await changeHandler('/test/workspace/src/file.ts');

      expect(hm.createTag).not.toHaveBeenCalled();
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
    });

    it('should create a tag with empty baseline when before state is null', async () => {
      const cache = createMockCache();
      const hm = createMockHistoryManager();
      const watcher = new SessionFileWatcher();

      (cache.getBeforeState as any).mockResolvedValue(null);
      mockReadFile.mockResolvedValue('new content');

      await watcher.start(workspacePath, sessionId, cache, hm);

      const changeHandler = mockWatcherHandlers['change']?.[0];
      await changeHandler('/test/workspace/src/file.ts');

      expect(hm.createTag).toHaveBeenCalledWith(
        '/test/workspace/src/file.ts',
        expect.stringContaining('ai-edit-pending-test-session-1-'),
        '',
        sessionId,
        expect.stringContaining('codex-file-change-')
      );
      expect(cache.updateSnapshot).toHaveBeenCalledWith('/test/workspace/src/file.ts', 'new content');
    });

    it('should not create a tag for changes outside the workspace', async () => {
      const cache = createMockCache();
      const hm = createMockHistoryManager();
      const watcher = new SessionFileWatcher();

      (cache.getBeforeState as any).mockResolvedValue(null);
      mockReadFile.mockResolvedValue('new content');

      await watcher.start(workspacePath, sessionId, cache, hm);

      const changeHandler = mockWatcherHandlers['change']?.[0];
      await changeHandler('/outside/workspace/file.ts');

      expect(hm.createTag).not.toHaveBeenCalled();
    });

    it('should handle file read errors gracefully', async () => {
      const cache = createMockCache();
      const hm = createMockHistoryManager();
      const watcher = new SessionFileWatcher();

      (cache.getBeforeState as any).mockResolvedValue('original');
      mockReadFile.mockRejectedValue(new Error('ENOENT'));

      await watcher.start(workspacePath, sessionId, cache, hm);

      const changeHandler = mockWatcherHandlers['change']?.[0];
      // Should not throw
      await changeHandler('/test/workspace/src/deleted.ts');

      expect(hm.createTag).not.toHaveBeenCalled();
    });
  });

  describe('add event handling', () => {
    it('should create a pre-edit tag with empty before content for new files', async () => {
      const cache = createMockCache();
      const hm = createMockHistoryManager();
      const watcher = new SessionFileWatcher();

      mockReadFile.mockResolvedValue('new file content');

      await watcher.start(workspacePath, sessionId, cache, hm);

      const addHandler = mockWatcherHandlers['add']?.[0];
      expect(addHandler).toBeDefined();
      await addHandler('/test/workspace/src/new-file.ts');

      expect(hm.createTag).toHaveBeenCalledWith(
        '/test/workspace/src/new-file.ts',
        expect.stringContaining('ai-edit-pending-test-session-1-'),
        '',
        sessionId,
        expect.stringContaining('codex-file-add-')
      );
      expect(cache.updateSnapshot).toHaveBeenCalledWith('/test/workspace/src/new-file.ts', 'new file content');
    });

    it('should skip if pending tag already exists', async () => {
      const cache = createMockCache();
      const hm = createMockHistoryManager();
      const watcher = new SessionFileWatcher();

      (hm.getPendingTags as any).mockResolvedValue([{ id: 'existing' } as HistoryTag]);
      mockReadFile.mockResolvedValue('content');

      await watcher.start(workspacePath, sessionId, cache, hm);

      const addHandler = mockWatcherHandlers['add']?.[0];
      await addHandler('/test/workspace/src/new-file.ts');

      expect(hm.createTag).not.toHaveBeenCalled();
    });

    it('should skip binary files on add', async () => {
      const cache = createMockCache();
      const hm = createMockHistoryManager();
      const watcher = new SessionFileWatcher();

      await watcher.start(workspacePath, sessionId, cache, hm);

      const addHandler = mockWatcherHandlers['add']?.[0];
      await addHandler('/test/workspace/image.jpg');

      expect(hm.createTag).not.toHaveBeenCalled();
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
});
