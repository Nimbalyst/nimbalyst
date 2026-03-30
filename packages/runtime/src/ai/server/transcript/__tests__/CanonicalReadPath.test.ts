import { describe, it, expect, beforeEach } from 'vitest';
import { TranscriptWriter } from '../TranscriptWriter';
import { TranscriptProjector } from '../TranscriptProjector';
import { convertCanonicalToLegacyMessages } from '../CanonicalTranscriptConverter';
import type { ITranscriptEventStore } from '../types';
import { createMockStore } from './helpers/createMockStore';

// ---------------------------------------------------------------------------
// Helper: full pipeline read
// ---------------------------------------------------------------------------

async function readCanonicalPipeline(store: ITranscriptEventStore, sessionId: string) {
  const events = await store.getSessionEvents(sessionId);
  const viewModel = TranscriptProjector.project(events);
  const legacyMessages = convertCanonicalToLegacyMessages(viewModel.messages);
  return { events, viewModel, legacyMessages };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Canonical Read Path Integration', () => {
  let store: ITranscriptEventStore;
  let writer: TranscriptWriter;
  const SESSION = 'test-session';

  beforeEach(() => {
    store = createMockStore();
    writer = new TranscriptWriter(store, 'claude-code');
  });

  describe('simple conversation', () => {
    it('user message followed by assistant response produces correct legacy messages', async () => {
      await writer.appendUserMessage(SESSION, 'What does this function do?');
      await writer.appendAssistantMessage(SESSION, 'It calculates the factorial of a number.');

      const { legacyMessages } = await readCanonicalPipeline(store, SESSION);

      expect(legacyMessages).toHaveLength(2);

      expect(legacyMessages[0].role).toBe('user');
      expect(legacyMessages[0].content).toBe('What does this function do?');
      expect(legacyMessages[0].isUserInput).toBe(true);

      expect(legacyMessages[1].role).toBe('assistant');
      expect(legacyMessages[1].content).toBe('It calculates the factorial of a number.');
      expect(legacyMessages[1].isComplete).toBe(true);
    });

    it('preserves mode on messages', async () => {
      await writer.appendUserMessage(SESSION, 'Plan the refactoring', { mode: 'planning' });
      await writer.appendAssistantMessage(SESSION, 'Here is my plan', { mode: 'planning' });

      const { legacyMessages } = await readCanonicalPipeline(store, SESSION);

      expect(legacyMessages[0].mode).toBe('planning');
      expect(legacyMessages[1].mode).toBe('planning');
    });
  });

  describe('tool call lifecycle', () => {
    it('createToolCall then updateToolCall produces a complete tool message', async () => {
      await writer.appendUserMessage(SESSION, 'Read the config file');

      const toolEvent = await writer.createToolCall(SESSION, {
        toolName: 'Read',
        toolDisplayName: 'Read File',
        description: 'Reading config.ts',
        arguments: { file_path: '/src/config.ts' },
        targetFilePath: '/src/config.ts',
        providerToolCallId: 'tc_001',
      });

      await writer.updateToolCall(toolEvent.id, {
        status: 'completed',
        result: 'export const config = { port: 3000 };',
        durationMs: 50,
      });

      await writer.appendAssistantMessage(SESSION, 'The config exports a port setting.');

      const { legacyMessages } = await readCanonicalPipeline(store, SESSION);

      expect(legacyMessages).toHaveLength(3);

      // User message
      expect(legacyMessages[0].role).toBe('user');

      // Tool call
      const toolMsg = legacyMessages[1];
      expect(toolMsg.role).toBe('tool');
      expect(toolMsg.toolCall).toBeDefined();
      expect(toolMsg.toolCall!.name).toBe('Read');
      expect(toolMsg.toolCall!.id).toBe('tc_001');
      expect(toolMsg.toolCall!.arguments).toEqual({ file_path: '/src/config.ts' });
      expect(toolMsg.toolCall!.result).toBe('export const config = { port: 3000 };');
      expect(toolMsg.toolCall!.targetFilePath).toBe('/src/config.ts');

      // Assistant response
      expect(legacyMessages[2].role).toBe('assistant');
    });

    it('tool call with progress attaches progress data', async () => {
      const toolEvent = await writer.createToolCall(SESSION, {
        toolName: 'Bash',
        toolDisplayName: 'Bash',
        arguments: { command: 'npm run build' },
        providerToolCallId: 'tc_002',
      });

      await writer.appendToolProgress(SESSION, {
        parentEventId: toolEvent.id,
        toolName: 'Bash',
        elapsedSeconds: 5,
        progressContent: 'Compiling...',
      });

      await writer.appendToolProgress(SESSION, {
        parentEventId: toolEvent.id,
        toolName: 'Bash',
        elapsedSeconds: 15,
        progressContent: 'Linking...',
      });

      await writer.updateToolCall(toolEvent.id, {
        status: 'completed',
        result: 'Build succeeded',
        durationMs: 20000,
      });

      const { legacyMessages } = await readCanonicalPipeline(store, SESSION);

      expect(legacyMessages).toHaveLength(1);
      const tc = legacyMessages[0].toolCall!;
      expect(tc.toolProgress).toEqual({ toolName: 'Bash', elapsedSeconds: 15 });
    });

    it('tool call with error status sets isError', async () => {
      const toolEvent = await writer.createToolCall(SESSION, {
        toolName: 'Bash',
        toolDisplayName: 'Bash',
        arguments: { command: 'exit 1' },
      });

      await writer.updateToolCall(toolEvent.id, {
        status: 'error',
        result: 'Command failed',
        isError: true,
        exitCode: 1,
      });

      const { legacyMessages } = await readCanonicalPipeline(store, SESSION);

      expect(legacyMessages[0].isError).toBe(true);
    });
  });

  describe('interactive prompt lifecycle', () => {
    it('permission request produces correct widget data', async () => {
      const promptEvent = await writer.createInteractivePrompt(SESSION, {
        promptType: 'permission_request',
        requestId: 'perm-1',
        status: 'pending',
        toolName: 'Bash',
        rawCommand: 'git push origin main',
        pattern: 'Bash(git:*)',
        patternDisplayName: 'git commands',
        isDestructive: false,
        warnings: [],
      });

      await writer.updateInteractivePrompt(promptEvent.id, {
        status: 'resolved',
        decision: 'allow',
        scope: 'session',
      } as any);

      const { legacyMessages } = await readCanonicalPipeline(store, SESSION);

      expect(legacyMessages).toHaveLength(1);
      expect(legacyMessages[0].role).toBe('tool');
      expect(legacyMessages[0].toolCall!.name).toBe('ToolPermission');
      expect(legacyMessages[0].toolCall!.id).toBe('perm-1');

      // Result contains decision
      const result = JSON.parse(legacyMessages[0].toolCall!.result as string);
      expect(result.decision).toBe('allow');
      expect(result.scope).toBe('session');
    });

    it('ask user question produces correct widget data', async () => {
      const promptEvent = await writer.createInteractivePrompt(SESSION, {
        promptType: 'ask_user_question',
        requestId: 'ask-1',
        status: 'pending',
        questions: [{ question: 'Which file?', header: 'File selection' }],
      });

      await writer.updateInteractivePrompt(promptEvent.id, {
        status: 'resolved',
        answers: { '0': 'src/index.ts' },
      } as any);

      const { legacyMessages } = await readCanonicalPipeline(store, SESSION);

      expect(legacyMessages).toHaveLength(1);
      expect(legacyMessages[0].toolCall!.name).toBe('AskUserQuestion');

      const result = JSON.parse(legacyMessages[0].toolCall!.result as string);
      expect(result.answers).toEqual({ '0': 'src/index.ts' });
    });

    it('git commit proposal produces correct widget data', async () => {
      const promptEvent = await writer.createInteractivePrompt(SESSION, {
        promptType: 'git_commit_proposal',
        requestId: 'commit-1',
        status: 'pending',
        commitMessage: 'fix: resolve auth bug',
        stagedFiles: ['src/auth.ts'],
      });

      await writer.updateInteractivePrompt(promptEvent.id, {
        status: 'resolved',
        decision: 'committed',
        commitSha: 'abc123',
      } as any);

      const { legacyMessages } = await readCanonicalPipeline(store, SESSION);

      expect(legacyMessages).toHaveLength(1);
      expect(legacyMessages[0].toolCall!.name).toBe('GitCommitProposal');

      const result = legacyMessages[0].toolCall!.result as any;
      expect(result.success).toBe(true);
      expect(result.result.action).toBe('committed');
      expect(result.result.commitHash).toBe('abc123');
    });
  });

  describe('subagent with children', () => {
    it('creates nested structure in legacy format', async () => {
      await writer.appendUserMessage(SESSION, 'Find all test files');

      const subagentEvent = await writer.createSubagent(SESSION, {
        subagentId: 'agent-1',
        agentType: 'Explore',
        teammateName: 'explorer',
        color: 'blue',
        prompt: 'Find test files in the project',
      });

      // Child tool call within subagent
      await writer.createToolCall(SESSION, {
        toolName: 'Glob',
        toolDisplayName: 'Glob',
        arguments: { pattern: '**/*.test.ts' },
        providerToolCallId: 'child-tc-1',
        subagentId: 'agent-1',
      });

      await writer.updateSubagent(subagentEvent.id, {
        status: 'completed',
        resultSummary: 'Found 12 test files',
        toolCallCount: 1,
        durationMs: 3000,
      });

      await writer.appendAssistantMessage(SESSION, 'The subagent found 12 test files.');

      const { legacyMessages } = await readCanonicalPipeline(store, SESSION);

      // User, subagent, assistant
      expect(legacyMessages).toHaveLength(3);

      expect(legacyMessages[0].role).toBe('user');

      // Subagent message
      const subMsg = legacyMessages[1];
      expect(subMsg.role).toBe('tool');
      expect(subMsg.toolCall!.isSubAgent).toBe(true);
      expect(subMsg.toolCall!.subAgentType).toBe('Explore');
      expect(subMsg.toolCall!.teammateName).toBe('explorer');
      expect(subMsg.toolCall!.result).toBe('Found 12 test files');

      // Child tool calls nested
      expect(subMsg.toolCall!.childToolCalls).toHaveLength(1);
      expect(subMsg.toolCall!.childToolCalls![0].toolCall?.name).toBe('Glob');

      expect(legacyMessages[2].role).toBe('assistant');
    });
  });

  describe('mixed conversation', () => {
    it('interleaves user, assistant, tools, prompts, and subagents correctly', async () => {
      // User starts
      await writer.appendUserMessage(SESSION, 'Help me refactor this module');

      // Assistant reads a file
      const readTool = await writer.createToolCall(SESSION, {
        toolName: 'Read',
        toolDisplayName: 'Read',
        arguments: { file_path: '/src/module.ts' },
        providerToolCallId: 'tc-read',
      });
      await writer.updateToolCall(readTool.id, {
        status: 'completed',
        result: 'module code here',
      });

      // Assistant explains
      await writer.appendAssistantMessage(SESSION, 'I see the issue. Let me fix it.');

      // Permission prompt
      const permEvent = await writer.createInteractivePrompt(SESSION, {
        promptType: 'permission_request',
        requestId: 'perm-fix',
        status: 'pending',
        toolName: 'Edit',
        rawCommand: 'edit /src/module.ts',
        pattern: 'Edit(*)',
        patternDisplayName: 'Edit files',
        isDestructive: false,
        warnings: [],
      });
      await writer.updateInteractivePrompt(permEvent.id, {
        status: 'resolved',
        decision: 'allow',
        scope: 'once',
      } as any);

      // Edit tool
      const editTool = await writer.createToolCall(SESSION, {
        toolName: 'Edit',
        toolDisplayName: 'Edit',
        arguments: { file_path: '/src/module.ts', old_string: 'old', new_string: 'new' },
        providerToolCallId: 'tc-edit',
      });
      await writer.updateToolCall(editTool.id, {
        status: 'completed',
        result: 'File edited',
      });

      // Subagent for verification
      const subEvent = await writer.createSubagent(SESSION, {
        subagentId: 'verify-agent',
        agentType: 'general-purpose',
        prompt: 'Verify the changes',
      });
      await writer.updateSubagent(subEvent.id, {
        status: 'completed',
        resultSummary: 'All tests pass',
      });

      // System message
      await writer.appendSystemMessage(SESSION, 'Session saved');

      // Final assistant message
      await writer.appendAssistantMessage(SESSION, 'The refactoring is complete.');

      const { legacyMessages } = await readCanonicalPipeline(store, SESSION);

      const roles = legacyMessages.map((m) => m.role);
      expect(roles).toEqual(['user', 'tool', 'assistant', 'tool', 'tool', 'tool', 'system', 'assistant']);

      // Verify specific messages
      expect(legacyMessages[0].content).toBe('Help me refactor this module');
      expect(legacyMessages[1].toolCall!.name).toBe('Read');
      expect(legacyMessages[2].content).toBe('I see the issue. Let me fix it.');
      expect(legacyMessages[3].toolCall!.name).toBe('ToolPermission');
      expect(legacyMessages[4].toolCall!.name).toBe('Edit');
      expect(legacyMessages[5].toolCall!.isSubAgent).toBe(true);
      expect(legacyMessages[6].isSystem).toBe(true);
      expect(legacyMessages[7].content).toBe('The refactoring is complete.');
    });
  });

  describe('turn ended data', () => {
    it('turn_ended events are available in projected view model but skipped in legacy', async () => {
      await writer.appendUserMessage(SESSION, 'Hello');
      await writer.appendAssistantMessage(SESSION, 'Hi there');

      await writer.recordTurnEnded(SESSION, {
        contextFill: {
          inputTokens: 500,
          cacheReadInputTokens: 200,
          cacheCreationInputTokens: 100,
          outputTokens: 150,
          totalContextTokens: 950,
        },
        contextWindow: 200000,
        cumulativeUsage: {
          inputTokens: 500,
          outputTokens: 150,
          cacheReadInputTokens: 200,
          cacheCreationInputTokens: 100,
          costUSD: 0.02,
          webSearchRequests: 0,
        },
      });

      const { viewModel, legacyMessages } = await readCanonicalPipeline(store, SESSION);

      // View model includes turn_ended
      const turnEndedMsg = viewModel.messages.find((m) => m.type === 'turn_ended');
      expect(turnEndedMsg).toBeDefined();
      expect(turnEndedMsg!.turnEnded!.contextWindow).toBe(200000);
      expect(turnEndedMsg!.turnEnded!.cumulativeUsage.costUSD).toBe(0.02);

      // Legacy messages skip turn_ended
      expect(legacyMessages).toHaveLength(2);
      expect(legacyMessages.every((m) => m.role !== 'turn_ended')).toBe(true);
    });
  });

  describe('empty session', () => {
    it('produces empty message list', async () => {
      const { events, viewModel, legacyMessages } = await readCanonicalPipeline(store, SESSION);

      expect(events).toHaveLength(0);
      expect(viewModel.messages).toHaveLength(0);
      expect(legacyMessages).toHaveLength(0);
    });
  });
});
