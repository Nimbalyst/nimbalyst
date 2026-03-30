import { describe, it, expect } from 'vitest';
import { convertCanonicalToLegacyMessages } from '../CanonicalTranscriptConverter';
import type { TranscriptViewMessage } from '../TranscriptProjector';

function makeViewMessage(overrides: Partial<TranscriptViewMessage> & { type: TranscriptViewMessage['type'] }): TranscriptViewMessage {
  return {
    id: 1,
    sequence: 0,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    subagentId: null,
    ...overrides,
  };
}

describe('convertCanonicalToLegacyMessages', () => {
  it('converts user_message to legacy user Message', () => {
    const viewMessages: TranscriptViewMessage[] = [
      makeViewMessage({
        type: 'user_message',
        text: 'Hello world',
        mode: 'agent',
        attachments: [{ id: '1', filename: 'test.png', filepath: '/test.png', mimeType: 'image/png', size: 100, type: 'image' }],
      }),
    ];

    const result = convertCanonicalToLegacyMessages(viewMessages);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('user');
    expect(result[0].content).toBe('Hello world');
    expect(result[0].mode).toBe('agent');
    expect(result[0].isUserInput).toBe(true);
    expect(result[0].attachments).toHaveLength(1);
  });

  it('converts assistant_message to legacy assistant Message', () => {
    const viewMessages: TranscriptViewMessage[] = [
      makeViewMessage({
        type: 'assistant_message',
        text: 'I can help with that.',
        mode: 'planning',
      }),
    ];

    const result = convertCanonicalToLegacyMessages(viewMessages);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('assistant');
    expect(result[0].content).toBe('I can help with that.');
    expect(result[0].mode).toBe('planning');
    expect(result[0].isComplete).toBe(true);
  });

  it('converts system_message to legacy system Message', () => {
    const viewMessages: TranscriptViewMessage[] = [
      makeViewMessage({
        type: 'system_message',
        text: 'Session started',
        systemMessage: { systemType: 'status' },
      }),
    ];

    const result = convertCanonicalToLegacyMessages(viewMessages);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('system');
    expect(result[0].isSystem).toBe(true);
    expect(result[0].isUserInput).toBe(false);
  });

  it('filters out init system messages', () => {
    const viewMessages: TranscriptViewMessage[] = [
      makeViewMessage({
        type: 'system_message',
        text: 'Session initialized',
        systemMessage: { systemType: 'init' },
      }),
    ];

    const result = convertCanonicalToLegacyMessages(viewMessages);
    expect(result).toHaveLength(0);
  });

  it('converts system_message with error type to error Message', () => {
    const viewMessages: TranscriptViewMessage[] = [
      makeViewMessage({
        type: 'system_message',
        text: 'API error occurred',
        systemMessage: { systemType: 'error' },
      }),
    ];

    const result = convertCanonicalToLegacyMessages(viewMessages);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('assistant');
    expect(result[0].isError).toBe(true);
    expect(result[0].errorMessage).toBe('API error occurred');
  });

  it('converts tool_call to legacy tool Message', () => {
    const viewMessages: TranscriptViewMessage[] = [
      makeViewMessage({
        type: 'tool_call',
        toolCall: {
          toolName: 'Read',
          toolDisplayName: 'Read',
          status: 'completed',
          description: 'Reading file',
          arguments: { file_path: '/src/index.ts' },
          targetFilePath: '/src/index.ts',
          mcpServer: null,
          mcpTool: null,
          result: 'file contents here',
          isError: false,
          providerToolCallId: 'tool_123',
          progress: [],
        },
      }),
    ];

    const result = convertCanonicalToLegacyMessages(viewMessages);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('tool');
    expect(result[0].toolCall?.name).toBe('Read');
    expect(result[0].toolCall?.result).toBe('file contents here');
    expect(result[0].toolCall?.id).toBe('tool_123');
    expect(result[0].toolCall?.arguments).toEqual({ file_path: '/src/index.ts' });
  });

  it('parses JSON-stringified MCP content array in tool result', () => {
    const mcpContent = [{ type: 'text', text: '{"summary":"done","before":{"name":null,"tags":[],"phase":null},"after":{"name":"Test","tags":["feature"],"phase":"implementing"}}' }];
    const viewMessages: TranscriptViewMessage[] = [
      makeViewMessage({
        type: 'tool_call',
        toolCall: {
          toolName: 'mcp__nimbalyst-session-naming__update_session_meta',
          toolDisplayName: 'update_session_meta',
          status: 'completed',
          description: null,
          arguments: { name: 'Test', add: ['feature'], phase: 'implementing' },
          targetFilePath: null,
          mcpServer: 'nimbalyst-session-naming',
          mcpTool: 'update_session_meta',
          result: JSON.stringify(mcpContent),
          providerToolCallId: 'tool_mcp',
          progress: [],
        },
      }),
    ];

    const result = convertCanonicalToLegacyMessages(viewMessages);
    expect(result).toHaveLength(1);
    // The result should be parsed back to the MCP content array, not left as a string
    expect(result[0].toolCall?.result).toEqual(mcpContent);
    // The widget can then extract text from the array
    const resultArray = result[0].toolCall?.result as unknown as Array<{ type: string; text: string }>;
    expect(resultArray[0].type).toBe('text');
    const innerJson = JSON.parse(resultArray[0].text);
    expect(innerJson.after.name).toBe('Test');
  });

  it('parses JSON-stringified object in tool result', () => {
    const viewMessages: TranscriptViewMessage[] = [
      makeViewMessage({
        type: 'tool_call',
        toolCall: {
          toolName: 'Bash',
          toolDisplayName: 'Bash',
          status: 'completed',
          description: null,
          arguments: { command: 'echo hello' },
          targetFilePath: null,
          mcpServer: null,
          mcpTool: null,
          result: JSON.stringify({ stdout: 'hello', exit_code: 0 }),
          providerToolCallId: 'tool_bash',
          progress: [],
        },
      }),
    ];

    const result = convertCanonicalToLegacyMessages(viewMessages);
    expect(result).toHaveLength(1);
    expect(result[0].toolCall?.result).toEqual({ stdout: 'hello', exit_code: 0 });
  });

  it('converts Task/Agent tool_call with sub-agent metadata', () => {
    const viewMessages: TranscriptViewMessage[] = [
      makeViewMessage({
        type: 'tool_call',
        toolCall: {
          toolName: 'Agent',
          toolDisplayName: 'Agent',
          status: 'completed',
          description: null,
          arguments: { subagent_type: 'Explore', name: 'researcher', team_name: 'myteam', mode: 'plan' },
          targetFilePath: null,
          mcpServer: null,
          mcpTool: null,
          providerToolCallId: 'tool_456',
          progress: [],
        },
      }),
    ];

    const result = convertCanonicalToLegacyMessages(viewMessages);
    expect(result).toHaveLength(1);
    const tc = result[0].toolCall!;
    expect(tc.isSubAgent).toBe(true);
    expect(tc.subAgentType).toBe('Explore');
    expect(tc.teammateName).toBe('researcher');
    expect(tc.teamName).toBe('myteam');
    expect(tc.teammateMode).toBe('plan');
    expect(tc.teammateAgentId).toBe('researcher@myteam');
  });

  it('converts interactive_prompt (permission_request) to legacy tool Message', () => {
    const viewMessages: TranscriptViewMessage[] = [
      makeViewMessage({
        type: 'interactive_prompt',
        interactivePrompt: {
          promptType: 'permission_request',
          requestId: 'req_1',
          status: 'resolved',
          toolName: 'Bash',
          rawCommand: 'git status',
          pattern: 'Bash(git:*)',
          patternDisplayName: 'git commands',
          isDestructive: false,
          warnings: [],
          decision: 'allow',
          scope: 'session',
        },
      }),
    ];

    const result = convertCanonicalToLegacyMessages(viewMessages);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('tool');
    expect(result[0].toolCall?.name).toBe('ToolPermission');
    expect(result[0].toolCall?.id).toBe('req_1');
  });

  it('converts subagent with child events', () => {
    const viewMessages: TranscriptViewMessage[] = [
      makeViewMessage({
        type: 'subagent',
        subagentId: 'agent_1',
        subagent: {
          agentType: 'Explore',
          status: 'completed',
          teammateName: 'explorer',
          teamName: null,
          teammateMode: null,
          model: null,
          color: null,
          isBackground: false,
          prompt: 'Find the file',
          resultSummary: 'Found 3 files',
          childEvents: [
            makeViewMessage({
              id: 2,
              type: 'tool_call',
              subagentId: 'agent_1',
              toolCall: {
                toolName: 'Glob',
                toolDisplayName: 'Glob',
                status: 'completed',
                description: null,
                arguments: { pattern: '*.ts' },
                targetFilePath: null,
                mcpServer: null,
                mcpTool: null,
                result: 'file1.ts\nfile2.ts',
                providerToolCallId: 'child_1',
                progress: [],
              },
            }),
          ],
        },
      }),
    ];

    const result = convertCanonicalToLegacyMessages(viewMessages);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('tool');
    expect(result[0].toolCall?.id).toBe('agent_1');
    expect(result[0].toolCall?.isSubAgent).toBe(true);
    expect(result[0].toolCall?.subAgentType).toBe('Explore');
    expect(result[0].toolCall?.result).toBe('Found 3 files');
    expect(result[0].toolCall?.arguments).toMatchObject({
      prompt: 'Find the file',
      description: 'Explore',
    });
    expect(result[0].toolCall?.childToolCalls).toHaveLength(1);
    expect(result[0].toolCall?.childToolCalls![0].toolCall?.name).toBe('Glob');
  });

  it('includes run_in_background for background subagents', () => {
    const viewMessages: TranscriptViewMessage[] = [
      makeViewMessage({
        type: 'subagent',
        subagentId: 'agent_bg',
        subagent: {
          agentType: 'Explore',
          status: 'running',
          teammateName: null,
          teamName: null,
          teammateMode: null,
          model: null,
          color: null,
          isBackground: true,
          prompt: 'Search in background',
          childEvents: [],
        },
      }),
    ];

    const result = convertCanonicalToLegacyMessages(viewMessages);
    expect(result[0].toolCall?.arguments).toMatchObject({
      prompt: 'Search in background',
      run_in_background: true,
    });
  });

  it('filters non-tool_call child events from subagent childToolCalls', () => {
    const viewMessages: TranscriptViewMessage[] = [
      makeViewMessage({
        type: 'subagent',
        subagentId: 'agent_2',
        subagent: {
          agentType: 'Explore',
          status: 'completed',
          teammateName: null,
          teamName: null,
          teammateMode: null,
          model: null,
          color: null,
          isBackground: false,
          prompt: 'Search code',
          resultSummary: 'Done',
          childEvents: [
            makeViewMessage({
              id: 2,
              type: 'tool_call',
              subagentId: 'agent_2',
              toolCall: {
                toolName: 'Grep',
                toolDisplayName: 'Grep',
                status: 'completed',
                description: null,
                arguments: { pattern: 'TODO' },
                targetFilePath: null,
                mcpServer: null,
                mcpTool: null,
                result: 'found matches',
                providerToolCallId: 'child_1',
                progress: [],
              },
            }),
            // assistant_message should be filtered out
            makeViewMessage({
              id: 3,
              type: 'assistant_message',
              subagentId: 'agent_2',
              text: 'I found the matches',
            }),
            makeViewMessage({
              id: 4,
              type: 'tool_call',
              subagentId: 'agent_2',
              toolCall: {
                toolName: 'Read',
                toolDisplayName: 'Read',
                status: 'completed',
                description: null,
                arguments: { file_path: '/src/main.ts' },
                targetFilePath: '/src/main.ts',
                mcpServer: null,
                mcpTool: null,
                result: 'file contents',
                providerToolCallId: 'child_2',
                progress: [],
              },
            }),
          ],
        },
      }),
    ];

    const result = convertCanonicalToLegacyMessages(viewMessages);
    expect(result).toHaveLength(1);
    // Only tool_call children should be in childToolCalls, not assistant_message
    expect(result[0].toolCall?.childToolCalls).toHaveLength(2);
    expect(result[0].toolCall?.childToolCalls![0].toolCall?.name).toBe('Grep');
    expect(result[0].toolCall?.childToolCalls![1].toolCall?.name).toBe('Read');
  });

  it('skips turn_ended events', () => {
    const viewMessages: TranscriptViewMessage[] = [
      makeViewMessage({
        type: 'turn_ended',
        turnEnded: {
          contextFill: { inputTokens: 100, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, outputTokens: 50, totalContextTokens: 150 },
          contextWindow: 200000,
          cumulativeUsage: { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.01, webSearchRequests: 0 },
          contextCompacted: false,
        },
      }),
    ];

    const result = convertCanonicalToLegacyMessages(viewMessages);
    expect(result).toHaveLength(0);
  });

  it('handles tool_call with progress events', () => {
    const viewMessages: TranscriptViewMessage[] = [
      makeViewMessage({
        type: 'tool_call',
        toolCall: {
          toolName: 'Bash',
          toolDisplayName: 'Bash',
          status: 'running',
          description: 'Running command',
          arguments: { command: 'npm test' },
          targetFilePath: null,
          mcpServer: null,
          mcpTool: null,
          providerToolCallId: 'tool_789',
          progress: [
            { elapsedSeconds: 5, progressContent: 'Still running...' },
            { elapsedSeconds: 10, progressContent: 'Almost done...' },
          ],
        },
      }),
    ];

    const result = convertCanonicalToLegacyMessages(viewMessages);
    expect(result).toHaveLength(1);
    expect(result[0].toolCall?.toolProgress).toEqual({
      toolName: 'Bash',
      elapsedSeconds: 10,
    });
  });

  it('handles empty input', () => {
    const result = convertCanonicalToLegacyMessages([]);
    expect(result).toHaveLength(0);
  });

  it('converts a mixed conversation correctly', () => {
    const viewMessages: TranscriptViewMessage[] = [
      makeViewMessage({ id: 1, sequence: 0, type: 'user_message', text: 'Help me fix the bug' }),
      makeViewMessage({
        id: 2, sequence: 1, type: 'tool_call',
        toolCall: {
          toolName: 'Read', toolDisplayName: 'Read', status: 'completed',
          description: null, arguments: { file_path: '/src/bug.ts' },
          targetFilePath: '/src/bug.ts', mcpServer: null, mcpTool: null,
          result: 'buggy code', providerToolCallId: 't1', progress: [],
        },
      }),
      makeViewMessage({ id: 3, sequence: 2, type: 'assistant_message', text: 'I found the issue.' }),
    ];

    const result = convertCanonicalToLegacyMessages(viewMessages);
    expect(result).toHaveLength(3);
    expect(result[0].role).toBe('user');
    expect(result[1].role).toBe('tool');
    expect(result[2].role).toBe('assistant');
  });
});
