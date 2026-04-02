import { describe, expect, it } from 'vitest';
import type { TranscriptViewMessage } from '../../../../ai/server/transcript/TranscriptProjector';
import { extractEditsFromToolMessage } from '../RichTranscriptView';

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
