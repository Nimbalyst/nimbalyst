import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ClaudeCodeTranscriptAdapter } from '../adapters/ClaudeCodeTranscriptAdapter';
import { TranscriptWriter } from '../TranscriptWriter';
import type { ITranscriptEventStore } from '../types';
import { createMockStore } from './helpers/createMockStore';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ClaudeCodeTranscriptAdapter', () => {
  let store: ITranscriptEventStore;
  let writer: TranscriptWriter;
  let adapter: ClaudeCodeTranscriptAdapter;
  const sessionId = 'test-session-1';

  beforeEach(() => {
    store = createMockStore();
    writer = new TranscriptWriter(store, 'claude-code');
    adapter = new ClaudeCodeTranscriptAdapter(writer, sessionId);
  });

  // -----------------------------------------------------------------------
  // User input
  // -----------------------------------------------------------------------

  it('should record user input via handleUserInput', async () => {
    await adapter.handleUserInput('Hello world', { mode: 'agent' });

    const events = await store.getSessionEvents(sessionId);
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('user_message');
    expect(events[0].searchableText).toBe('Hello world');
    expect((events[0].payload as any).mode).toBe('agent');
  });

  it('should include attachments in user input', async () => {
    const attachments = [{ id: '1', filename: 'test.ts', filepath: '/test.ts', mimeType: 'text/typescript', size: 100, type: 'file' }];
    await adapter.handleUserInput('Check this file', { attachments });

    const events = await store.getSessionEvents(sessionId);
    expect((events[0].payload as any).attachments).toHaveLength(1);
  });

  // -----------------------------------------------------------------------
  // Assistant text accumulation
  // -----------------------------------------------------------------------

  it('should accumulate text from string chunks and flush', async () => {
    await adapter.handleChunk('Hello ');
    await adapter.handleChunk('world');
    await adapter.flush();

    const events = await store.getSessionEvents(sessionId);
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('assistant_message');
    expect(events[0].searchableText).toBe('Hello world');
  });

  it('should accumulate text from assistant chunk with text blocks', async () => {
    await adapter.handleChunk({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'First part. ' },
          { type: 'text', text: 'Second part.' },
        ],
      },
    });
    await adapter.flush();

    const events = await store.getSessionEvents(sessionId);
    expect(events).toHaveLength(1);
    expect(events[0].searchableText).toBe('First part. Second part.');
  });

  it('should accumulate text from standalone text chunk', async () => {
    await adapter.handleChunk({ type: 'text', text: 'standalone text' });
    await adapter.flush();

    const events = await store.getSessionEvents(sessionId);
    expect(events).toHaveLength(1);
    expect(events[0].searchableText).toBe('standalone text');
  });

  it('should flush pending text before tool call', async () => {
    await adapter.handleChunk('Before tool');
    await adapter.handleChunk({
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: '/foo.ts' } }],
      },
    });

    const events = await store.getSessionEvents(sessionId);
    expect(events[0].eventType).toBe('assistant_message');
    expect(events[0].searchableText).toBe('Before tool');
    expect(events[1].eventType).toBe('tool_call');
  });

  // -----------------------------------------------------------------------
  // Tool call create/update lifecycle
  // -----------------------------------------------------------------------

  it('should create a tool call from tool_use block in assistant chunk', async () => {
    await adapter.handleChunk({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: '/src/main.ts' } },
        ],
      },
    });

    const events = await store.getSessionEvents(sessionId);
    const toolEvent = events.find((e) => e.eventType === 'tool_call');
    expect(toolEvent).toBeDefined();
    const payload = toolEvent!.payload as any;
    expect(payload.toolName).toBe('Read');
    expect(payload.targetFilePath).toBe('/src/main.ts');
    expect(payload.status).toBe('running');
    expect(toolEvent!.providerToolCallId).toBe('tool-1');
  });

  it('should update tool call when tool_result arrives', async () => {
    // Create tool call
    await adapter.handleChunk({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'ls' } },
        ],
      },
    });

    // Tool result arrives
    await adapter.handleChunk({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 'tool-1', content: 'file1.ts\nfile2.ts', is_error: false },
        ],
      },
    });

    const events = await store.getSessionEvents(sessionId);
    const toolEvent = events.find((e) => e.eventType === 'tool_call');
    const payload = toolEvent!.payload as any;
    expect(payload.status).toBe('completed');
    expect(payload.result).toBe('file1.ts\nfile2.ts');
    expect(payload.isError).toBe(false);
  });

  it('should detect error tool results', async () => {
    await adapter.handleChunk({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'tool-err', name: 'Read', input: { file_path: '/missing.ts' } },
        ],
      },
    });
    await adapter.handleChunk({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 'tool-err', content: 'Error: File not found', is_error: true },
        ],
      },
    });

    const events = await store.getSessionEvents(sessionId);
    const payload = events.find((e) => e.eventType === 'tool_call')!.payload as any;
    expect(payload.status).toBe('error');
    expect(payload.isError).toBe(true);
  });

  it('should handle tool_result in user chunk', async () => {
    await adapter.handleChunk({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'tool-u1', name: 'Bash', input: { command: 'echo hi' } },
        ],
      },
    });

    // Result arrives in user message
    await adapter.handleChunk({
      type: 'user',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 'tool-u1', content: 'hi', is_error: false },
        ],
      },
    });

    const events = await store.getSessionEvents(sessionId);
    const payload = events.find((e) => e.eventType === 'tool_call')!.payload as any;
    expect(payload.status).toBe('completed');
    expect(payload.result).toBe('hi');
  });

  it('should handle standalone tool_use chunk', async () => {
    await adapter.handleChunk({
      type: 'tool_use',
      id: 'tool-s1',
      name: 'Glob',
      input: { pattern: '**/*.ts' },
    });

    const events = await store.getSessionEvents(sessionId);
    const toolEvent = events.find((e) => e.eventType === 'tool_call');
    expect(toolEvent).toBeDefined();
    expect((toolEvent!.payload as any).toolName).toBe('Glob');
  });

  // -----------------------------------------------------------------------
  // MCP tool parsing
  // -----------------------------------------------------------------------

  it('should parse MCP tool names into mcpServer/mcpTool', async () => {
    await adapter.handleChunk({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'mcp-1', name: 'mcp__nimbalyst__database_query', input: { query: 'SELECT 1' } },
        ],
      },
    });

    const events = await store.getSessionEvents(sessionId);
    const payload = events.find((e) => e.eventType === 'tool_call')!.payload as any;
    expect(payload.mcpServer).toBe('nimbalyst');
    expect(payload.mcpTool).toBe('database_query');
  });

  // -----------------------------------------------------------------------
  // Subagent lifecycle
  // -----------------------------------------------------------------------

  it('should create subagent from Agent tool_use', async () => {
    await adapter.handleChunk({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'agent-1',
            name: 'Agent',
            input: { prompt: 'Find all TODO comments', name: 'todo-finder', run_in_background: true },
          },
        ],
      },
    });

    const events = await store.getSessionEvents(sessionId);
    const subagentEvent = events.find((e) => e.eventType === 'subagent');
    expect(subagentEvent).toBeDefined();
    const payload = subagentEvent!.payload as any;
    expect(payload.agentType).toBe('Agent');
    expect(payload.prompt).toBe('Find all TODO comments');
    expect(payload.teammateName).toBe('todo-finder');
    expect(payload.isBackground).toBe(true);
    expect(payload.status).toBe('running');
  });

  it('should update subagent when tool_result arrives', async () => {
    await adapter.handleChunk({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'agent-2', name: 'Task', input: { prompt: 'Run tests' } },
        ],
      },
    });

    await adapter.handleChunk({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 'agent-2', content: 'All tests passed' },
        ],
      },
    });

    const events = await store.getSessionEvents(sessionId);
    const subagentEvent = events.find((e) => e.eventType === 'subagent');
    const payload = subagentEvent!.payload as any;
    expect(payload.status).toBe('completed');
    expect(payload.resultSummary).toBe('All tests passed');
  });

  it('should create subagent from task_started system chunk', async () => {
    await adapter.handleChunk({
      type: 'system',
      subtype: 'task_started',
      task_id: 'task-xyz',
      task_type: 'agent',
      description: 'Researching codebase',
      tool_use_id: 'tool-abc',
    });

    const events = await store.getSessionEvents(sessionId);
    const subagentEvent = events.find((e) => e.eventType === 'subagent');
    expect(subagentEvent).toBeDefined();
    expect((subagentEvent!.payload as any).agentType).toBe('agent');
    expect((subagentEvent!.payload as any).prompt).toBe('Researching codebase');
    expect(subagentEvent!.subagentId).toBe('task-xyz');
  });

  it('should update subagent from task_notification system chunk', async () => {
    await adapter.handleChunk({
      type: 'system',
      subtype: 'task_started',
      task_id: 'task-n1',
      description: 'Some work',
    });

    await adapter.handleChunk({
      type: 'system',
      subtype: 'task_notification',
      task_id: 'task-n1',
      status: 'completed',
      summary: 'Done with work',
      usage: { tool_uses: 5, duration_ms: 3000 },
    });

    const events = await store.getSessionEvents(sessionId);
    const subagentEvent = events.find((e) => e.eventType === 'subagent');
    const payload = subagentEvent!.payload as any;
    expect(payload.status).toBe('completed');
    expect(payload.resultSummary).toBe('Done with work');
    expect(payload.toolCallCount).toBe(5);
    expect(payload.durationMs).toBe(3000);
  });

  it('should deduplicate when tool_use Agent and task_started refer to same subagent', async () => {
    // tool_use block arrives first
    await adapter.handleChunk({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'toolu_abc', name: 'Agent', input: { prompt: 'search code', subagent_type: 'Explore' } },
        ],
      },
    });

    // Then task_started arrives with matching tool_use_id
    await adapter.handleChunk({
      type: 'system',
      subtype: 'task_started',
      task_id: 'task-123',
      task_type: 'agent',
      description: 'search code',
      tool_use_id: 'toolu_abc',
    });

    const events = await store.getSessionEvents(sessionId);
    const subagentEvents = events.filter((e) => e.eventType === 'subagent');
    expect(subagentEvents).toHaveLength(1);
    // The first (tool_use) event should be kept since it has richer metadata
    expect(subagentEvents[0].subagentId).toBe('toolu_abc');
  });

  it('should deduplicate when task_started arrives before tool_use Agent', async () => {
    // task_started arrives first
    await adapter.handleChunk({
      type: 'system',
      subtype: 'task_started',
      task_id: 'task-456',
      task_type: 'agent',
      description: 'search code',
      tool_use_id: 'toolu_def',
    });

    // Then tool_use block arrives with the same id
    await adapter.handleChunk({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'toolu_def', name: 'Agent', input: { prompt: 'search code' } },
        ],
      },
    });

    const events = await store.getSessionEvents(sessionId);
    const subagentEvents = events.filter((e) => e.eventType === 'subagent');
    expect(subagentEvents).toHaveLength(1);
  });

  // -----------------------------------------------------------------------
  // Sub-agent child tool calls
  // -----------------------------------------------------------------------

  it('should tag child tool calls with subagentId when parent_tool_use_id matches a subagent', async () => {
    // Spawn a sub-agent
    await adapter.handleChunk({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'agent-child-1', name: 'Agent', input: { prompt: 'Explore files', subagent_type: 'Explore' } },
        ],
      },
    });

    // Sub-agent's tool call arrives with parent_tool_use_id on the outer chunk
    await adapter.handleChunk({
      type: 'assistant',
      parent_tool_use_id: 'agent-child-1',
      message: {
        content: [
          { type: 'tool_use', id: 'child-tool-1', name: 'Glob', input: { pattern: '*.ts' } },
        ],
      },
    });

    const events = await store.getSessionEvents(sessionId);
    const toolEvent = events.find((e) => e.eventType === 'tool_call' && (e.payload as any).toolName === 'Glob');
    expect(toolEvent).toBeDefined();
    expect(toolEvent!.subagentId).toBe('agent-child-1');
  });

  it('should tag standalone tool_use child calls with subagentId', async () => {
    // Spawn a sub-agent
    await adapter.handleChunk({
      type: 'tool_use',
      id: 'agent-standalone',
      name: 'Agent',
      input: { prompt: 'Search code' },
    });

    // Sub-agent's standalone tool call
    await adapter.handleChunk({
      type: 'tool_use',
      id: 'child-standalone-1',
      name: 'Grep',
      input: { pattern: 'TODO' },
      parent_tool_use_id: 'agent-standalone',
    });

    const events = await store.getSessionEvents(sessionId);
    const toolEvent = events.find((e) => e.eventType === 'tool_call' && (e.payload as any).toolName === 'Grep');
    expect(toolEvent).toBeDefined();
    expect(toolEvent!.subagentId).toBe('agent-standalone');
  });

  it('should not set subagentId for tool calls without parent_tool_use_id', async () => {
    await adapter.handleChunk({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'agent-x', name: 'Agent', input: { prompt: 'do stuff' } },
        ],
      },
    });

    // Regular tool call (no parent_tool_use_id)
    await adapter.handleChunk({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'top-level-tool', name: 'Read', input: { file_path: '/foo.ts' } },
        ],
      },
    });

    const events = await store.getSessionEvents(sessionId);
    const toolEvent = events.find((e) => e.eventType === 'tool_call' && (e.payload as any).toolName === 'Read');
    expect(toolEvent).toBeDefined();
    expect(toolEvent!.subagentId).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Interactive prompts
  // -----------------------------------------------------------------------

  it('should create AskUserQuestion interactive prompt from tool_use', async () => {
    await adapter.handleChunk({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'ask-1',
            name: 'AskUserQuestion',
            input: { question: 'Which database?', questions: [{ question: 'Which database?', header: 'DB Choice' }] },
          },
        ],
      },
    });

    const events = await store.getSessionEvents(sessionId);
    const promptEvent = events.find((e) => e.eventType === 'interactive_prompt');
    expect(promptEvent).toBeDefined();
    const payload = promptEvent!.payload as any;
    expect(payload.promptType).toBe('ask_user_question');
    expect(payload.requestId).toBe('ask-1');
    expect(payload.status).toBe('pending');
    expect(payload.questions[0].question).toBe('Which database?');
  });

  it('should update interactive prompt on response', async () => {
    await adapter.handleChunk({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'ask-2',
            name: 'AskUserQuestion',
            input: { questions: [{ question: 'Continue?', header: '' }] },
          },
        ],
      },
    });

    await adapter.handlePromptResponse('ask-2', {
      answers: { '0': 'yes' },
      respondedBy: 'desktop',
    });

    const events = await store.getSessionEvents(sessionId);
    const promptEvent = events.find((e) => e.eventType === 'interactive_prompt');
    const payload = promptEvent!.payload as any;
    expect(payload.status).toBe('resolved');
    expect(payload.answers).toEqual({ '0': 'yes' });
  });

  it('should create permission_request interactive prompt', async () => {
    await adapter.handlePermissionRequest({
      requestId: 'perm-1',
      toolName: 'Bash',
      rawCommand: 'rm -rf /tmp/test',
      pattern: 'rm *',
      patternDisplayName: 'Remove files',
      isDestructive: true,
      warnings: ['Destructive operation'],
    });

    const events = await store.getSessionEvents(sessionId);
    const promptEvent = events.find((e) => e.eventType === 'interactive_prompt');
    const payload = promptEvent!.payload as any;
    expect(payload.promptType).toBe('permission_request');
    expect(payload.isDestructive).toBe(true);
    expect(payload.toolName).toBe('Bash');
  });

  it('should create git_commit_proposal interactive prompt', async () => {
    await adapter.handleGitCommitProposal({
      requestId: 'git-1',
      commitMessage: 'feat: add feature',
      stagedFiles: ['src/main.ts'],
    });

    const events = await store.getSessionEvents(sessionId);
    const payload = events.find((e) => e.eventType === 'interactive_prompt')!.payload as any;
    expect(payload.promptType).toBe('git_commit_proposal');
    expect(payload.commitMessage).toBe('feat: add feature');
    expect(payload.stagedFiles).toEqual(['src/main.ts']);
  });

  // -----------------------------------------------------------------------
  // System chunks
  // -----------------------------------------------------------------------

  it('should record init system message', async () => {
    await adapter.handleChunk({ type: 'system', subtype: 'init' });

    const events = await store.getSessionEvents(sessionId);
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('system_message');
    expect((events[0].payload as any).systemType).toBe('init');
  });

  it('should record compact_boundary as system message', async () => {
    await adapter.handleChunk({ type: 'system', subtype: 'compact_boundary', compact_metadata: { pre_tokens: 50000 } });

    const events = await store.getSessionEvents(sessionId);
    const systemEvent = events.find((e) => e.eventType === 'system_message');
    expect(systemEvent).toBeDefined();
    expect(systemEvent!.searchableText).toBe('Context compacted');
  });

  // -----------------------------------------------------------------------
  // Turn ended (result chunk)
  // -----------------------------------------------------------------------

  it('should record turn_ended from result chunk with modelUsage', async () => {
    await adapter.handleChunk({
      type: 'result',
      modelUsage: {
        'claude-opus-4-6': {
          inputTokens: 1000,
          outputTokens: 500,
          cacheReadInputTokens: 200,
          cacheCreationInputTokens: 100,
          costUSD: 0.05,
          contextWindow: 200000,
          webSearchRequests: 0,
        },
      },
    });

    const events = await store.getSessionEvents(sessionId);
    const turnEvent = events.find((e) => e.eventType === 'turn_ended');
    expect(turnEvent).toBeDefined();
    const payload = turnEvent!.payload as any;
    expect(payload.contextFill.inputTokens).toBe(1000);
    expect(payload.contextFill.cacheReadInputTokens).toBe(200);
    expect(payload.cumulativeUsage.costUSD).toBe(0.05);
    expect(payload.contextWindow).toBe(200000);
  });

  it('should record turn_ended from result chunk with basic usage', async () => {
    await adapter.handleChunk({
      type: 'result',
      usage: {
        input_tokens: 500,
        output_tokens: 200,
        cache_read_input_tokens: 50,
        cache_creation_input_tokens: 10,
      },
    });

    const events = await store.getSessionEvents(sessionId);
    const turnEvent = events.find((e) => e.eventType === 'turn_ended');
    expect(turnEvent).toBeDefined();
    const payload = turnEvent!.payload as any;
    expect(payload.contextFill.inputTokens).toBe(500);
    expect(payload.contextFill.cacheReadInputTokens).toBe(50);
  });

  it('should skip turn_ended when no usage data', async () => {
    await adapter.handleChunk({ type: 'result' });

    const events = await store.getSessionEvents(sessionId);
    expect(events.filter((e) => e.eventType === 'turn_ended')).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Summary chunk
  // -----------------------------------------------------------------------

  it('should record summary as system message', async () => {
    await adapter.handleChunk({ type: 'summary', summary: 'Session completed successfully' });

    const events = await store.getSessionEvents(sessionId);
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('system_message');
    expect(events[0].searchableText).toBe('Session completed successfully');
  });

  // -----------------------------------------------------------------------
  // Rate limit event
  // -----------------------------------------------------------------------

  it('should record rate_limit_event as error system message', async () => {
    await adapter.handleChunk({
      type: 'rate_limit_event',
      rate_limit_info: { status: 'blocked', rateLimitType: 'five_hour' },
    });

    const events = await store.getSessionEvents(sessionId);
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('system_message');
    expect((events[0].payload as any).systemType).toBe('error');
    expect(events[0].searchableText).toContain('Rate limit');
  });

  it('should skip allowed rate limit events', async () => {
    await adapter.handleChunk({
      type: 'rate_limit_event',
      rate_limit_info: { status: 'allowed' },
    });

    const events = await store.getSessionEvents(sessionId);
    expect(events).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Deduplication of accumulated chunks
  // -----------------------------------------------------------------------

  it('should deduplicate tool_use blocks with the same tool ID', async () => {
    // Streaming chunk (has model/id on message)
    await adapter.handleChunk({
      type: 'assistant',
      message: {
        model: 'claude-opus-4-6',
        id: 'msg_123',
        content: [
          { type: 'tool_use', id: 'tool-dup', name: 'Read', input: { file_path: '/foo.ts' } },
        ],
      },
    });

    // Accumulated echo chunk (no model/id) with same tool_use
    await adapter.handleChunk({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'tool-dup', name: 'Read', input: { file_path: '/foo.ts' } },
        ],
      },
    });

    const events = await store.getSessionEvents(sessionId);
    const toolEvents = events.filter((e) => e.eventType === 'tool_call');
    expect(toolEvents).toHaveLength(1);
  });

  it('should deduplicate Agent/Task subagent tool_use blocks', async () => {
    await adapter.handleChunk({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'agent-dup', name: 'Agent', input: { prompt: 'search' } },
        ],
      },
    });

    // Same Agent tool_use arrives again
    await adapter.handleChunk({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'agent-dup', name: 'Agent', input: { prompt: 'search' } },
        ],
      },
    });

    const events = await store.getSessionEvents(sessionId);
    const subagentEvents = events.filter((e) => e.eventType === 'subagent');
    expect(subagentEvents).toHaveLength(1);
  });

  it('should deduplicate AskUserQuestion tool_use blocks', async () => {
    await adapter.handleChunk({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'ask-dup', name: 'AskUserQuestion', input: { questions: [{ question: 'Proceed?' }] } },
        ],
      },
    });

    await adapter.handleChunk({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'ask-dup', name: 'AskUserQuestion', input: { questions: [{ question: 'Proceed?' }] } },
        ],
      },
    });

    const events = await store.getSessionEvents(sessionId);
    const promptEvents = events.filter((e) => e.eventType === 'interactive_prompt');
    expect(promptEvents).toHaveLength(1);
  });

  it('should deduplicate standalone tool_use chunks', async () => {
    await adapter.handleChunk({
      type: 'tool_use',
      id: 'standalone-dup',
      name: 'Grep',
      input: { pattern: 'TODO' },
    });

    await adapter.handleChunk({
      type: 'tool_use',
      id: 'standalone-dup',
      name: 'Grep',
      input: { pattern: 'TODO' },
    });

    const events = await store.getSessionEvents(sessionId);
    const toolEvents = events.filter((e) => e.eventType === 'tool_call');
    expect(toolEvents).toHaveLength(1);
  });

  // -----------------------------------------------------------------------
  // Mode tracking
  // -----------------------------------------------------------------------

  it('should track mode across user input and assistant messages', async () => {
    await adapter.handleUserInput('Plan this', { mode: 'planning' });
    await adapter.handleChunk('Planning response');
    await adapter.flush();

    const events = await store.getSessionEvents(sessionId);
    expect((events[1].payload as any).mode).toBe('planning');
  });
});
