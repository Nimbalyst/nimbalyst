/**
 * Tests for gitignore bypass and replay buffer in WorkspaceEventBus.
 *
 * These tests mock fs.watch to control event dispatch and verify:
 * - Bypass set add/remove
 * - .md files pass through gitignore
 * - gitignoreBypassed flag is set correctly on dispatched events
 * - Replay buffer stores dropped events and replays on bypass registration
 * - OptimizedWorkspaceWatcher ignores bypassed events
 */

import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — must run before vi.mock() factories
// ---------------------------------------------------------------------------

const { mockFsWatch, mockWatcherCallbacks, mockFsAccess, originalPlatform } = vi.hoisted(() => {
  // Force fs.watch recursive path (macOS/Windows) even on Linux CI,
  // since this test mocks fs.watch, not chokidar.
  const originalPlatform = process.platform;
  Object.defineProperty(process, 'platform', { value: 'darwin', writable: true });
  const mockWatcherCallbacks: Array<(eventType: string, filename: string | null) => void> = [];
  const mockFsWatch = vi.fn((_path: string, _opts: any, callback: any) => {
    mockWatcherCallbacks.push(callback);
    return {
      close: vi.fn(),
      on: vi.fn().mockReturnThis(),
    };
  });

  const mockFsAccess = vi.fn(() => Promise.resolve());

  return { mockFsWatch, mockWatcherCallbacks, mockFsAccess, originalPlatform };
});

// Mock fs module
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    watch: mockFsWatch,
  };
});

vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises');
  return {
    ...actual,
    readFile: vi.fn().mockRejectedValue(new Error('no .gitignore')),
    access: mockFsAccess,
  };
});

// Mock chokidar (not used on macOS/Windows but needs to be present)
vi.mock('chokidar', () => ({
  default: {
    watch: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      close: vi.fn(),
      add: vi.fn(),
      unwatch: vi.fn(),
    })),
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
    workspaceWatcher: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  },
}));

// Mock workspaceDetection to avoid electron/store imports
vi.mock('../../utils/workspaceDetection', () => ({
  isPathInWorkspace: (filePath: string, workspacePath: string) => {
    if (!filePath || !workspacePath) return false;
    return filePath === workspacePath || filePath.startsWith(workspacePath + '/');
  },
}));

// Mock the `ignore` package to simulate .gitignore behavior
// We'll make it ignore anything under `dist/` and `build/`
vi.mock('ignore', () => {
  const createMatcher = () => {
    const matcher = {
      add: vi.fn().mockReturnThis(),
      ignores: (p: string) => {
        return p.startsWith('dist/') || p.startsWith('build/') ||
               p === 'dist' || p === 'build';
      },
    };
    return matcher;
  };
  return { default: createMatcher };
});

// ---------------------------------------------------------------------------
// Import after mocks are set up
// ---------------------------------------------------------------------------

import {
  subscribe,
  unsubscribe,
  addGitignoreBypass,
  removeGitignoreBypass,
  hasGitignoreBypass,
  resetBus,
} from '../WorkspaceEventBus';
import type { WorkspaceEventListener } from '../WorkspaceEventBus';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const WORKSPACE = '/Users/test/project';

function createListener(): WorkspaceEventListener & {
  changes: Array<{ path: string; type: string; bypassed?: boolean }>;
} {
  const changes: Array<{ path: string; type: string; bypassed?: boolean }> = [];
  return {
    changes,
    onChange: vi.fn((filePath: string, gitignoreBypassed?: boolean) => {
      changes.push({ path: filePath, type: 'change', bypassed: gitignoreBypassed });
    }),
    onAdd: vi.fn((filePath: string, gitignoreBypassed?: boolean) => {
      changes.push({ path: filePath, type: 'add', bypassed: gitignoreBypassed });
    }),
    onUnlink: vi.fn((filePath: string, gitignoreBypassed?: boolean) => {
      changes.push({ path: filePath, type: 'unlink', bypassed: gitignoreBypassed });
    }),
  };
}

/** Simulate an fs.watch event for the most recently created watcher. */
function fireWatchEvent(eventType: string, filename: string) {
  const cb = mockWatcherCallbacks[mockWatcherCallbacks.length - 1];
  if (!cb) throw new Error('No watcher callback registered');
  cb(eventType, filename);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorkspaceEventBus gitignore bypass', () => {
  beforeEach(() => {
    mockWatcherCallbacks.length = 0;
    mockFsWatch.mockClear();
    mockFsAccess.mockReset();
    mockFsAccess.mockResolvedValue(undefined);
    resetBus();
  });

  afterAll(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true });
  });

  afterEach(() => {
    resetBus();
  });

  describe('bypass set management', () => {
    it('adds and removes bypass paths', async () => {
      const listener = createListener();
      await subscribe(WORKSPACE, 'test-sub', listener);

      addGitignoreBypass(WORKSPACE, `${WORKSPACE}/dist/bundle.js`);
      expect(hasGitignoreBypass(WORKSPACE, `${WORKSPACE}/dist/bundle.js`)).toBe(true);

      removeGitignoreBypass(WORKSPACE, `${WORKSPACE}/dist/bundle.js`);
      expect(hasGitignoreBypass(WORKSPACE, `${WORKSPACE}/dist/bundle.js`)).toBe(false);

      unsubscribe(WORKSPACE, 'test-sub');
    });

    it('returns false for non-existent bypass', async () => {
      const listener = createListener();
      await subscribe(WORKSPACE, 'test-sub', listener);

      expect(hasGitignoreBypass(WORKSPACE, `${WORKSPACE}/dist/nope.js`)).toBe(false);

      unsubscribe(WORKSPACE, 'test-sub');
    });

    it('handles bypass for non-existent workspace gracefully', () => {
      addGitignoreBypass('/nonexistent', '/nonexistent/file.js');
      expect(hasGitignoreBypass('/nonexistent', '/nonexistent/file.js')).toBe(false);
    });
  });

  describe('event dispatch with bypass', () => {
    it('dispatches non-gitignored events without bypass flag', async () => {
      const listener = createListener();
      await subscribe(WORKSPACE, 'test-sub', listener);

      // src/app.ts is not gitignored
      fireWatchEvent('change', 'src/app.ts');

      expect(listener.onChange).toHaveBeenCalledWith(
        `${WORKSPACE}/src/app.ts`,
        undefined,
      );
      expect(listener.changes[0]?.bypassed).toBeUndefined();

      unsubscribe(WORKSPACE, 'test-sub');
    });

    it('drops gitignored events not in bypass set', async () => {
      const listener = createListener();
      await subscribe(WORKSPACE, 'test-sub', listener);

      // dist/ is gitignored, not bypassed
      fireWatchEvent('change', 'dist/bundle.js');

      expect(listener.onChange).not.toHaveBeenCalled();

      unsubscribe(WORKSPACE, 'test-sub');
    });

    it('dispatches bypassed gitignored events with flag', async () => {
      const listener = createListener();
      await subscribe(WORKSPACE, 'test-sub', listener);

      // Add bypass then fire event
      addGitignoreBypass(WORKSPACE, `${WORKSPACE}/dist/bundle.js`);
      fireWatchEvent('change', 'dist/bundle.js');

      expect(listener.onChange).toHaveBeenCalledWith(
        `${WORKSPACE}/dist/bundle.js`,
        true,
      );
      expect(listener.changes[0]?.bypassed).toBe(true);

      unsubscribe(WORKSPACE, 'test-sub');
    });

    it('dispatches .md files in gitignored dirs with bypass flag', async () => {
      const listener = createListener();
      await subscribe(WORKSPACE, 'test-sub', listener);

      // .md files always bypass gitignore (Condition 2)
      fireWatchEvent('change', 'dist/README.md');

      expect(listener.onChange).toHaveBeenCalledWith(
        `${WORKSPACE}/dist/README.md`,
        true,
      );

      unsubscribe(WORKSPACE, 'test-sub');
    });

    it('handles rename events (add/unlink) with bypass', async () => {
      const listener = createListener();
      await subscribe(WORKSPACE, 'test-sub', listener);

      addGitignoreBypass(WORKSPACE, `${WORKSPACE}/build/output.js`);

      // Simulate a rename event — fs.access resolves means it's an add
      mockFsAccess.mockResolvedValue(undefined);
      fireWatchEvent('rename', 'build/output.js');

      // Wait for the async fs.access check
      await vi.waitFor(() => {
        expect(listener.onAdd).toHaveBeenCalledWith(
          `${WORKSPACE}/build/output.js`,
          true,
        );
      });

      unsubscribe(WORKSPACE, 'test-sub');
    });

    it('retries rename events before treating a delayed file as unlink', async () => {
      vi.useFakeTimers();

      const listener = createListener();
      await subscribe(WORKSPACE, 'test-sub', listener);

      addGitignoreBypass(WORKSPACE, `${WORKSPACE}/build/output.js`);

      mockFsAccess
        .mockRejectedValueOnce(new Error('not yet visible'))
        .mockRejectedValueOnce(new Error('still not visible'))
        .mockResolvedValueOnce(undefined);

      fireWatchEvent('rename', 'build/output.js');

      await vi.advanceTimersByTimeAsync(125);

      expect(listener.onAdd).toHaveBeenCalledWith(
        `${WORKSPACE}/build/output.js`,
        true,
      );
      expect(listener.onUnlink).not.toHaveBeenCalled();

      unsubscribe(WORKSPACE, 'test-sub');
      vi.useRealTimers();
    });
  });

  describe('replay buffer', () => {
    it('replays dropped events when bypass is registered', async () => {
      const listener = createListener();
      await subscribe(WORKSPACE, 'test-sub', listener);

      // Fire event BEFORE bypass is registered — should be dropped
      fireWatchEvent('change', 'dist/bundle.js');
      expect(listener.onChange).not.toHaveBeenCalled();

      // Now register bypass — should replay the dropped event
      addGitignoreBypass(WORKSPACE, `${WORKSPACE}/dist/bundle.js`);

      expect(listener.onChange).toHaveBeenCalledWith(
        `${WORKSPACE}/dist/bundle.js`,
        true,
      );

      unsubscribe(WORKSPACE, 'test-sub');
    });

    it('does not replay expired events', async () => {
      // Use fake timers throughout so Date.now() is controlled
      vi.useFakeTimers({ now: 1000000 });

      const listener = createListener();
      await subscribe(WORKSPACE, 'test-sub', listener);

      // Fire event at t=1000000
      fireWatchEvent('change', 'dist/bundle.js');
      expect(listener.onChange).not.toHaveBeenCalled();

      // Advance past TTL (5s)
      vi.advanceTimersByTime(6000);

      // Register bypass at t=1006000 — expired events should NOT replay
      addGitignoreBypass(WORKSPACE, `${WORKSPACE}/dist/bundle.js`);
      expect(listener.onChange).not.toHaveBeenCalled();

      unsubscribe(WORKSPACE, 'test-sub');
      vi.useRealTimers();
    });

    it('does not replay events for unrelated paths', async () => {
      const listener = createListener();
      await subscribe(WORKSPACE, 'test-sub', listener);

      // Drop event for dist/a.js
      fireWatchEvent('change', 'dist/a.js');

      // Register bypass for dist/b.js — should NOT replay dist/a.js
      addGitignoreBypass(WORKSPACE, `${WORKSPACE}/dist/b.js`);

      expect(listener.onChange).not.toHaveBeenCalled();

      unsubscribe(WORKSPACE, 'test-sub');
    });
  });

  describe('hardcoded ignores are never bypassed', () => {
    it('always filters .git paths regardless of bypass', async () => {
      const listener = createListener();
      await subscribe(WORKSPACE, 'test-sub', listener);

      addGitignoreBypass(WORKSPACE, `${WORKSPACE}/.git/HEAD`);
      fireWatchEvent('change', '.git/HEAD');

      expect(listener.onChange).not.toHaveBeenCalled();

      unsubscribe(WORKSPACE, 'test-sub');
    });

    it('always filters .DS_Store regardless of bypass', async () => {
      const listener = createListener();
      await subscribe(WORKSPACE, 'test-sub', listener);

      addGitignoreBypass(WORKSPACE, `${WORKSPACE}/.DS_Store`);
      fireWatchEvent('change', '.DS_Store');

      expect(listener.onChange).not.toHaveBeenCalled();

      unsubscribe(WORKSPACE, 'test-sub');
    });
  });
});
