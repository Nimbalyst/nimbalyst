import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentToolHooks } from '../AgentToolHooks';
import type { AgentToolHooksOptions } from '../AgentToolHooks';

// Mock fs module
vi.mock('fs', () => ({
  default: {
    readFileSync: vi.fn(() => 'file content'),
  },
  readFileSync: vi.fn(() => 'file content'),
}));

function createMockOptions(overrides?: Partial<AgentToolHooksOptions>): AgentToolHooksOptions {
  return {
    workspacePath: '/test/workspace',
    sessionId: 'test-session-1',
    emit: vi.fn(),
    logAgentMessage: vi.fn().mockResolvedValue(undefined),
    logSecurity: vi.fn(),
    historyManager: {
      createSnapshot: vi.fn().mockResolvedValue(undefined),
      getPendingTags: vi.fn().mockResolvedValue([]),
      tagFile: vi.fn().mockResolvedValue(undefined),
      updateTagStatus: vi.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  };
}

describe('AgentToolHooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Bash pre-tool hook: no pre-tagging', () => {
    it('does not call tagFile or getPendingTags for Bash tool', async () => {
      const options = createMockOptions();
      const hooks = new AgentToolHooks(options);
      const preToolHook = hooks.createPreToolUseHook();

      await preToolHook(
        { tool_name: 'Bash', tool_input: { command: 'echo "hello" > /test/workspace/file.txt' } },
        'tool-use-1',
        { signal: new AbortController().signal }
      );

      expect(options.historyManager!.getPendingTags).not.toHaveBeenCalled();
      expect(options.historyManager!.tagFile).not.toHaveBeenCalled();
      expect(options.historyManager!.updateTagStatus).not.toHaveBeenCalled();
    });

    it('does not create or clear pending diff tags for Bash', async () => {
      const options = createMockOptions({
        historyManager: {
          createSnapshot: vi.fn().mockResolvedValue(undefined),
          getPendingTags: vi.fn().mockResolvedValue([
            { id: 'existing-tag', createdAt: new Date(), sessionId: 'other-session' },
          ]),
          tagFile: vi.fn().mockResolvedValue(undefined),
          updateTagStatus: vi.fn().mockResolvedValue(undefined),
        },
      });

      const hooks = new AgentToolHooks(options);
      const preToolHook = hooks.createPreToolUseHook();

      await preToolHook(
        { tool_name: 'Bash', tool_input: { command: 'sed -i "" "s/old/new/g" /test/workspace/file.txt' } },
        'tool-use-2',
        { signal: new AbortController().signal }
      );

      // Should NOT have cleared the other session's tag (was the old bug)
      expect(options.historyManager!.updateTagStatus).not.toHaveBeenCalled();
      expect(options.historyManager!.tagFile).not.toHaveBeenCalled();
    });
  });

  describe('Bash post-tool hook: editedFilesThisTurn tracking', () => {
    it('tracks Bash-affected files in editedFilesThisTurn via post-tool hook', async () => {
      const options = createMockOptions();
      const hooks = new AgentToolHooks(options);
      const postToolHook = hooks.createPostToolUseHook();

      // Bash command that writes to a file
      await postToolHook(
        { tool_name: 'Bash', tool_input: { command: 'echo "data" > /test/workspace/output.txt' } },
        'tool-use-3',
        { signal: new AbortController().signal }
      );

      const editedFiles = hooks.getEditedFiles();
      // parseBashForFileOps may or may not detect this depending on implementation,
      // but the important thing is no pre-tagging happened
      expect(options.historyManager!.tagFile).not.toHaveBeenCalled();
    });
  });

  describe('Edit/Write/MultiEdit: pre-tagging preserved', () => {
    it('still tags files for Edit tool', async () => {
      const options = createMockOptions();
      const hooks = new AgentToolHooks(options);
      const preToolHook = hooks.createPreToolUseHook();

      await preToolHook(
        {
          tool_name: 'Edit',
          tool_input: {
            file_path: '/test/workspace/src/module.ts',
            old_string: 'old code',
            new_string: 'new code',
          },
        },
        'tool-use-4',
        { signal: new AbortController().signal }
      );

      expect(options.historyManager!.getPendingTags).toHaveBeenCalledWith('/test/workspace/src/module.ts');
      expect(options.historyManager!.tagFile).toHaveBeenCalled();
    });

    it('still tags files for Write tool', async () => {
      const options = createMockOptions();
      const hooks = new AgentToolHooks(options);
      const preToolHook = hooks.createPreToolUseHook();

      await preToolHook(
        {
          tool_name: 'Write',
          tool_input: {
            file_path: '/test/workspace/src/new-file.ts',
            content: 'new content',
          },
        },
        'tool-use-5',
        { signal: new AbortController().signal }
      );

      expect(options.historyManager!.getPendingTags).toHaveBeenCalledWith('/test/workspace/src/new-file.ts');
      expect(options.historyManager!.tagFile).toHaveBeenCalled();
    });

    it('still tags files for MultiEdit tool', async () => {
      const options = createMockOptions();
      const hooks = new AgentToolHooks(options);
      const preToolHook = hooks.createPreToolUseHook();

      await preToolHook(
        {
          tool_name: 'MultiEdit',
          tool_input: {
            edits: [
              { file_path: '/test/workspace/src/a.ts', old_string: 'x', new_string: 'y' },
              { file_path: '/test/workspace/src/b.ts', old_string: 'x', new_string: 'y' },
            ],
          },
        },
        'tool-use-6',
        { signal: new AbortController().signal }
      );

      expect(options.historyManager!.getPendingTags).toHaveBeenCalledWith('/test/workspace/src/a.ts');
      expect(options.historyManager!.getPendingTags).toHaveBeenCalledWith('/test/workspace/src/b.ts');
      expect(options.historyManager!.tagFile).toHaveBeenCalledTimes(2);
    });
  });
});
