import { describe, expect, it } from 'vitest';
import type { TranscriptViewMessage } from '../../../../ai/server/transcript/TranscriptProjector';
import { extractEditsFromToolMessage, parseUnifiedDiffToReplacements } from '../RichTranscriptView';

function makeTestMessage(overrides: Partial<TranscriptViewMessage> = {}): TranscriptViewMessage {
  return {
    id: 1,
    sequence: 1,
    createdAt: new Date(),
    type: 'tool_call',
    subagentId: null,
    ...overrides,
  };
}

describe('extractEditsFromToolMessage', () => {
  it('deduplicates identical edits present on both message.edits and tool result payloads', () => {
    const duplicateEdit = {
      filePath: '/workspace/checkboxes.md',
      replacements: [
        {
          oldText: '- [ ] Delta',
          newText: '- [ ] Delta\n- [ ] Epsilon',
        },
      ],
    };

    const message = makeTestMessage({
      toolCall: {
        toolName: 'Edit',
        toolDisplayName: 'Edit',
        status: 'completed',
        description: null,
        arguments: {
          file_path: '/workspace/checkboxes.md',
        },
        targetFilePath: null,
        mcpServer: null,
        mcpTool: null,
        providerToolCallId: 'tool-1',
        progress: [],
        result: JSON.stringify({
          success: true,
          edits: [duplicateEdit],
        }),
        changes: [{ path: duplicateEdit.filePath, patch: '' }],
      },
    });

    expect(extractEditsFromToolMessage(message)).toEqual([duplicateEdit]);
  });

  it('extracts Codex apply_patch edits from `changes` map with unified_diff', () => {
    // Mirrors what CodexACPProtocol's apply_patch tool emits: args.changes is
    // a record keyed by file path with { type, unified_diff } values.
    const message = makeTestMessage({
      toolCall: {
        toolName: 'ApplyPatch',
        toolDisplayName: 'ApplyPatch',
        status: 'completed',
        description: null,
        arguments: {
          path: '/repo/test-screenshot.md',
          call_id: 'call_abc',
          changes: {
            '/repo/test-screenshot.md': {
              type: 'update',
              move_path: null,
              unified_diff: '@@ -1 +1,2 @@\n # Test File\n+Small test edit added by Codex.\n',
            },
          },
          turn_id: 'turn_xyz',
        },
        targetFilePath: '/repo/test-screenshot.md',
        mcpServer: null,
        mcpTool: null,
        providerToolCallId: 'call_abc',
        progress: [],
        result: JSON.stringify({ success: true }),
      },
    });

    const edits = extractEditsFromToolMessage(message);
    expect(edits).toHaveLength(1);
    expect(edits[0].filePath).toBe('/repo/test-screenshot.md');
    expect(edits[0].replacements).toHaveLength(1);
    expect(edits[0].replacements[0]).toEqual({
      oldText: '# Test File',
      newText: '# Test File\nSmall test edit added by Codex.',
    });
  });

  it('extracts Codex apply_patch new-file (type:add) into NewFilePreview-shaped edit', () => {
    const message = makeTestMessage({
      toolCall: {
        toolName: 'ApplyPatch',
        toolDisplayName: 'ApplyPatch',
        status: 'completed',
        description: null,
        arguments: {
          changes: {
            '/repo/new-file.md': {
              type: 'add',
              unified_diff: '@@ -0,0 +1,2 @@\n+Hello\n+World\n',
            },
          },
        },
        targetFilePath: '/repo/new-file.md',
        mcpServer: null,
        mcpTool: null,
        providerToolCallId: 'call_def',
        progress: [],
        result: JSON.stringify({ success: true }),
      },
    });

    const edits = extractEditsFromToolMessage(message);
    expect(edits).toHaveLength(1);
    expect(edits[0].filePath).toBe('/repo/new-file.md');
    expect(edits[0].operation).toBe('create');
    expect(edits[0].content).toBe('Hello\nWorld');
  });

  describe('parseUnifiedDiffToReplacements', () => {
    it('returns one replacement per hunk and includes context lines on both sides', () => {
      const diff = '@@ -1,3 +1,3 @@\n line1\n-old\n+new\n line3\n@@ -10 +10,2 @@\n-x\n+y\n+z\n';
      const replacements = parseUnifiedDiffToReplacements(diff);
      expect(replacements).toHaveLength(2);
      expect(replacements[0]).toEqual({
        oldText: 'line1\nold\nline3',
        newText: 'line1\nnew\nline3',
      });
      expect(replacements[1]).toEqual({
        oldText: 'x',
        newText: 'y\nz',
      });
    });

    it('returns [] for empty input', () => {
      expect(parseUnifiedDiffToReplacements('')).toEqual([]);
    });
  });

  it('keeps distinct edits for the same file', () => {
    const message = makeTestMessage({
      toolCall: {
        toolName: 'Edit',
        toolDisplayName: 'Edit',
        status: 'completed',
        description: null,
        arguments: {
          file_path: '/workspace/checkboxes.md',
        },
        targetFilePath: null,
        mcpServer: null,
        mcpTool: null,
        providerToolCallId: 'tool-2',
        progress: [],
        result: JSON.stringify({
          success: true,
          edits: [
            {
              filePath: '/workspace/checkboxes.md',
              replacements: [{ oldText: 'Alpha', newText: 'Alpha updated' }],
            },
            {
              filePath: '/workspace/checkboxes.md',
              replacements: [{ oldText: 'Beta', newText: 'Beta updated' }],
            },
          ],
        }),
      },
    });

    const edits = extractEditsFromToolMessage(message);
    expect(edits).toHaveLength(2);
    expect(edits[0].replacements[0].oldText).toBe('Alpha');
    expect(edits[1].replacements[0].oldText).toBe('Beta');
  });
});
