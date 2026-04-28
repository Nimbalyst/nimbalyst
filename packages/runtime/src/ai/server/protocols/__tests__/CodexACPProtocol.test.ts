import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { CodexACPProtocol } from '../CodexACPProtocol';

function fixturePath(): string {
  return fileURLToPath(new URL('./fixtures/mockCodexAcpAgent.mjs', import.meta.url));
}

describe('CodexACPProtocol', () => {
  it('streams ACP updates, permission previews, and completion data', async () => {
    const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-acp-protocol-'));
    const protocol = new CodexACPProtocol('test-key', {
      command: process.execPath,
      args: [fixturePath()],
      onPermissionRequest: async () => ({
        decision: 'allow',
        scope: 'session',
      }),
    });

    try {
      const session = await protocol.createSession({
        workspacePath,
        permissionMode: 'ask',
      });

      const events: any[] = [];
      for await (const event of protocol.sendMessage(session, {
        content: 'Apply the ACP edit',
      })) {
        events.push(event);
      }

      expect(events.some((event) => event.type === 'raw_event' && event.metadata?.rawEvent?.type === 'session/request_permission')).toBe(true);
      expect(events.some((event) => event.type === 'text' && event.content === 'Starting ACP turn')).toBe(true);
      expect(events.some((event) => event.type === 'text' && event.content === 'ACP edit applied')).toBe(true);
      expect(events.some((event) => event.type === 'tool_call' && event.toolCall?.name === 'Write')).toBe(true);

      const completeEvent = events.find((event) => event.type === 'complete');
      expect(completeEvent).toBeDefined();
      expect(completeEvent?.contextFillTokens).toBe(42);
      expect(completeEvent?.contextWindow).toBe(100);

      expect(fs.readFileSync(path.join(workspacePath, 'acp-target.txt'), 'utf-8')).toBe('after from acp\n');
    } finally {
      protocol.destroy();
      fs.rmSync(workspacePath, { recursive: true, force: true });
    }
  }, 15000);

  it('maps denied ACP permission requests to failed tool results', async () => {
    const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-acp-protocol-deny-'));
    const protocol = new CodexACPProtocol('test-key', {
      command: process.execPath,
      args: [fixturePath()],
      onPermissionRequest: async () => ({
        decision: 'deny',
        scope: 'once',
      }),
    });

    try {
      const session = await protocol.createSession({
        workspacePath,
        permissionMode: 'ask',
      });

      const events: any[] = [];
      for await (const event of protocol.sendMessage(session, {
        content: 'Reject the ACP edit',
      })) {
        events.push(event);
      }

      expect(events.some((event) => event.type === 'tool_call' && event.toolCall?.result?.success === false)).toBe(true);
      expect(fs.existsSync(path.join(workspacePath, 'acp-target.txt'))).toBe(false);
    } finally {
      protocol.destroy();
      fs.rmSync(workspacePath, { recursive: true, force: true });
    }
  }, 15000);
});
