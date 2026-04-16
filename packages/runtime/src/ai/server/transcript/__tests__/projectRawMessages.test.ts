/**
 * Integration tests for projectRawMessagesToViewMessages -- the client-side
 * transcript projection used by mobile (iOS/Android) transcript bundles.
 *
 * Verifies that raw messages end up as properly projected TranscriptViewMessages
 * for both Claude Code and Codex providers, matching desktop rendering.
 */

import { describe, it, expect } from 'vitest';
import {
  projectRawMessagesToViewMessages,
  rawMessagesToCanonicalEvents,
} from '../projectRawMessages';
import type { RawMessage } from '../TranscriptTransformer';

const SESSION_ID = 'test-session';

function raw(overrides: Partial<RawMessage>): RawMessage {
  return {
    id: 1,
    sessionId: SESSION_ID,
    source: 'claude-code',
    direction: 'output',
    content: '',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('projectRawMessagesToViewMessages', () => {
  it('returns empty array for no messages', async () => {
    const vms = await projectRawMessagesToViewMessages([], 'claude-code');
    expect(vms).toEqual([]);
  });

  describe('Codex provider', () => {
    it('projects a user prompt followed by an assistant text response', async () => {
      const messages: RawMessage[] = [
        raw({
          id: 1,
          direction: 'input',
          content: JSON.stringify({ prompt: 'Hello codex' }),
        }),
        raw({
          id: 2,
          content: 'Sure -- hi back!',
        }),
      ];

      const vms = await projectRawMessagesToViewMessages(messages, 'openai-codex');

      expect(vms).toHaveLength(2);
      expect(vms[0]).toMatchObject({ type: 'user_message', text: 'Hello codex' });
      expect(vms[1]).toMatchObject({ type: 'assistant_message', text: 'Sure -- hi back!' });
    });

    it('projects a Codex function_call event as a tool_call view message (no raw JSON leaks)', async () => {
      const messages: RawMessage[] = [
        raw({
          id: 1,
          source: 'openai-codex',
          content: JSON.stringify({
            type: 'item.completed',
            item: {
              type: 'function_call',
              id: 'fc-1',
              name: 'Read',
              arguments: JSON.stringify({ file_path: '/test.ts' }),
              output: 'file contents here',
              status: 'completed',
            },
          }),
        }),
      ];

      const vms = await projectRawMessagesToViewMessages(messages, 'openai-codex');

      const toolCall = vms.find(m => m.type === 'tool_call');
      expect(toolCall).toBeDefined();
      expect(toolCall?.toolCall?.toolName).toBe('Read');

      // Regression: the raw Codex JSON must NOT appear as plain assistant text.
      const hasRawJsonText = vms.some(
        m => m.text && m.text.includes('"type":"item.completed"'),
      );
      expect(hasRawJsonText).toBe(false);
    });
  });

  describe('Claude Code provider', () => {
    it('projects a user prompt as a user_message', async () => {
      const messages: RawMessage[] = [
        raw({
          id: 1,
          direction: 'input',
          content: JSON.stringify({ prompt: 'Refactor this file' }),
        }),
      ];

      const vms = await projectRawMessagesToViewMessages(messages, 'claude-code');

      expect(vms).toHaveLength(1);
      expect(vms[0]).toMatchObject({ type: 'user_message', text: 'Refactor this file' });
    });
  });

  it('rawMessagesToCanonicalEvents assigns sequential ids and sequences', async () => {
    const messages: RawMessage[] = [
      raw({ id: 1, direction: 'input', content: JSON.stringify({ prompt: 'first' }) }),
      raw({ id: 2, direction: 'input', content: JSON.stringify({ prompt: 'second' }) }),
    ];

    const events = await rawMessagesToCanonicalEvents(messages, 'claude-code');

    expect(events).toHaveLength(2);
    expect(events[0].id).toBe(1);
    expect(events[1].id).toBe(2);
    expect(events[0].sequence).toBeLessThan(events[1].sequence);
  });
});
