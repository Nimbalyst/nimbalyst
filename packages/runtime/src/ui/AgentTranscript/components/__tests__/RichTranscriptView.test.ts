import { describe, expect, it } from 'vitest';
import type { Message } from '../../../../ai/server/types';
import { extractEditsFromToolMessage } from '../RichTranscriptView';

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

    const message: Message = {
      role: 'tool',
      content: '',
      timestamp: 1,
      edits: [duplicateEdit],
      toolCall: {
        id: 'tool-1',
        name: 'Edit',
        arguments: {
          file_path: '/workspace/checkboxes.md',
        },
        result: {
          success: true,
          edits: [duplicateEdit],
        } as any,
      },
    };

    expect(extractEditsFromToolMessage(message)).toEqual([duplicateEdit]);
  });

  it('keeps distinct edits for the same file', () => {
    const message: Message = {
      role: 'tool',
      content: '',
      timestamp: 1,
      toolCall: {
        id: 'tool-2',
        name: 'Edit',
        arguments: {
          file_path: '/workspace/checkboxes.md',
        },
        result: {
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
        } as any,
      },
    };

    const edits = extractEditsFromToolMessage(message);
    expect(edits).toHaveLength(2);
    expect(edits[0].replacements[0].oldText).toBe('Alpha');
    expect(edits[1].replacements[0].oldText).toBe('Beta');
  });
});
