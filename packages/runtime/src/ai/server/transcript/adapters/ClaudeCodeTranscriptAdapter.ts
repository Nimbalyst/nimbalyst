/**
 * ClaudeCodeTranscriptAdapter
 *
 * Converts Claude Code SDK streaming chunks into canonical TranscriptWriter calls.
 * Instantiated per-session; does NOT modify the provider -- integration comes later.
 *
 * SDK chunk types handled:
 *   assistant  (text blocks, tool_use blocks, tool_result blocks)
 *   system     (init, task_started, task_progress, task_notification, compact_boundary)
 *   result     (turn end with modelUsage / usage)
 *   summary    (compaction or auth summary)
 *   user       (tool_result blocks delivered as user messages)
 *   text       (standalone text chunk)
 *   rate_limit_event
 */

import type { TranscriptWriter } from '../TranscriptWriter';
import { parseMcpToolName as parseSharedMcpToolName } from '../utils';

// ---------------------------------------------------------------------------
// MCP tool name parser
// ---------------------------------------------------------------------------

function parseMcpToolName(name: string): { mcpServer: string; mcpTool: string } | null {
  const parsed = parseSharedMcpToolName(name);
  if (!parsed) return null;
  return { mcpServer: parsed.server, mcpTool: parsed.tool };
}

// ---------------------------------------------------------------------------
// Tool display name helpers
// ---------------------------------------------------------------------------

const SDK_TOOL_DISPLAY_NAMES: Record<string, string> = {
  Bash: 'Bash',
  Read: 'Read',
  Write: 'Write',
  Edit: 'Edit',
  MultiEdit: 'MultiEdit',
  Glob: 'Glob',
  Grep: 'Grep',
  LS: 'LS',
  WebFetch: 'WebFetch',
  WebSearch: 'WebSearch',
  Task: 'Task',
  Agent: 'Agent',
  TaskOutput: 'TaskOutput',
  TaskStop: 'TaskStop',
  TodoRead: 'TodoRead',
  TodoWrite: 'TodoWrite',
  NotebookRead: 'NotebookRead',
  NotebookEdit: 'NotebookEdit',
  EnterPlanMode: 'EnterPlanMode',
  ExitPlanMode: 'ExitPlanMode',
  EnterWorktree: 'EnterWorktree',
  AskUserQuestion: 'AskUserQuestion',
  Skill: 'Skill',
  ToolSearch: 'ToolSearch',
  TaskCreate: 'TaskCreate',
  TaskGet: 'TaskGet',
  TaskUpdate: 'TaskUpdate',
  TaskList: 'TaskList',
  TeammateTool: 'TeammateTool',
  SendMessage: 'SendMessage',
  TeamCreate: 'TeamCreate',
  TeamDelete: 'TeamDelete',
};

function toolDisplayName(toolName: string): string {
  if (SDK_TOOL_DISPLAY_NAMES[toolName]) return SDK_TOOL_DISPLAY_NAMES[toolName];
  const mcp = parseMcpToolName(toolName);
  if (mcp) return mcp.mcpTool;
  return toolName;
}

function extractTargetFilePath(toolName: string, args: Record<string, unknown> | undefined): string | null {
  if (!args) return null;
  // Many tools have a file_path or path argument
  if (typeof args.file_path === 'string') return args.file_path;
  if (typeof args.path === 'string') return args.path;
  if (typeof args.command === 'string' && toolName === 'Bash') return null;
  return null;
}

// Subagent tool names
const SUBAGENT_TOOLS = new Set(['Task', 'Agent']);

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class ClaudeCodeTranscriptAdapter {
  private pendingAssistantText = '';
  private toolCallEventIds = new Map<string, number>();
  private subagentEventIds = new Map<string, number>();
  private promptEventIds = new Map<string, number>();
  private currentMode: 'agent' | 'planning' = 'agent';

  constructor(
    private writer: TranscriptWriter,
    private sessionId: string,
  ) {}

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Called by the provider for each raw SDK chunk.
   */
  async handleChunk(chunk: any): Promise<void> {
    if (typeof chunk === 'string') {
      // Standalone text string -- accumulate
      this.pendingAssistantText += chunk;
      return;
    }

    if (!chunk || typeof chunk !== 'object') return;

    switch (chunk.type) {
      case 'assistant':
        await this.handleAssistantChunk(chunk);
        break;
      case 'system':
        await this.handleSystemChunk(chunk);
        break;
      case 'result':
        await this.handleResultChunk(chunk);
        break;
      case 'summary':
        await this.handleSummaryChunk(chunk);
        break;
      case 'user':
        await this.handleUserChunk(chunk);
        break;
      case 'text':
        this.pendingAssistantText += (chunk.text || chunk.content || '');
        break;
      case 'tool_call':
      case 'tool_use':
        await this.handleStandaloneToolUse(chunk);
        break;
      case 'rate_limit_event':
        await this.handleRateLimitEvent(chunk);
        break;
      default:
        // Unknown chunk types are silently ignored by the adapter
        break;
    }
  }

  /**
   * Called when the user sends input (before it reaches the agent).
   */
  async handleUserInput(
    text: string,
    options?: { mode?: 'agent' | 'planning'; attachments?: any[] },
  ): Promise<void> {
    await this.flush();
    if (options?.mode) this.currentMode = options.mode;

    await this.writer.appendUserMessage(this.sessionId, text, {
      mode: options?.mode ?? this.currentMode,
      attachments: options?.attachments,
    });
  }

  /**
   * Called when an interactive prompt receives a response.
   */
  async handlePromptResponse(requestId: string, response: any): Promise<void> {
    const eventId = this.promptEventIds.get(requestId);
    if (eventId == null) return;

    await this.writer.updateInteractivePrompt(eventId, {
      status: 'resolved',
      ...response,
    });
  }

  /**
   * Flush any accumulated assistant text.
   */
  async flush(): Promise<void> {
    if (this.pendingAssistantText.length > 0) {
      await this.writer.appendAssistantMessage(this.sessionId, this.pendingAssistantText, {
        mode: this.currentMode,
      });
      this.pendingAssistantText = '';
    }
  }

  // -----------------------------------------------------------------------
  // Chunk handlers
  // -----------------------------------------------------------------------

  private async handleAssistantChunk(chunk: any): Promise<void> {
    const message = chunk.message;
    if (!message) return;

    const content = message.content;
    if (!Array.isArray(content)) {
      if (typeof content === 'string') {
        this.pendingAssistantText += content;
      }
      return;
    }

    // parent_tool_use_id lives on the outer chunk, not on individual content blocks
    const parentToolUseId: string | undefined = chunk.parent_tool_use_id;

    for (const block of content) {
      if (block.type === 'text') {
        this.pendingAssistantText += block.text;
      } else if (block.type === 'tool_use') {
        // Flush pending text before tool call
        await this.flush();
        await this.handleToolUseBlock(block, parentToolUseId);
      } else if (block.type === 'tool_result') {
        await this.handleToolResultBlock(block);
      }
    }
  }

  private async handleToolUseBlock(block: any, parentToolUseId?: string): Promise<void> {
    const toolName: string = block.name || 'unknown';
    const toolId: string = block.id || `tool-${Date.now()}`;
    const toolArgs: Record<string, unknown> = block.input ?? {};
    const mcp = parseMcpToolName(toolName);

    // Deduplicate: the SDK sends both streaming and accumulated chunks with the
    // same tool_use block. Skip if we've already processed this tool ID.
    if (SUBAGENT_TOOLS.has(toolName)) {
      if (this.subagentEventIds.has(toolId)) return;
      await this.handleSubagentSpawn(toolId, toolName, toolArgs);
      return;
    }

    if (toolName === 'AskUserQuestion') {
      if (this.promptEventIds.has(toolId)) return;
      await this.handleAskUserQuestionToolUse(toolId, toolArgs);
      return;
    }

    if (this.toolCallEventIds.has(toolId)) return;

    // Resolve parent subagent for nested tool calls.
    // parentToolUseId comes from the outer chunk (assistant message wrapper);
    // block.parent_tool_use_id is a fallback for standalone tool_use chunks.
    const resolvedParent = parentToolUseId ?? block.parent_tool_use_id;
    const subagentId = resolvedParent && this.subagentEventIds.has(resolvedParent) ? resolvedParent : undefined;

    const event = await this.writer.createToolCall(this.sessionId, {
      toolName,
      toolDisplayName: toolDisplayName(toolName),
      description: typeof toolArgs.description === 'string' ? toolArgs.description : null,
      arguments: toolArgs,
      targetFilePath: extractTargetFilePath(toolName, toolArgs),
      mcpServer: mcp?.mcpServer ?? null,
      mcpTool: mcp?.mcpTool ?? null,
      providerToolCallId: toolId,
      subagentId,
    });

    this.toolCallEventIds.set(toolId, event.id);
  }

  private async handleToolResultBlock(block: any): Promise<void> {
    const toolResultId: string = block.tool_use_id || block.id;
    if (!toolResultId) return;

    // Check if it completes a subagent
    const subagentEventId = this.subagentEventIds.get(toolResultId);
    if (subagentEventId != null) {
      const resultText = typeof block.content === 'string'
        ? block.content
        : JSON.stringify(block.content);
      await this.writer.updateSubagent(subagentEventId, {
        status: 'completed',
        resultSummary: resultText?.substring(0, 500),
      });
      return;
    }

    const eventId = this.toolCallEventIds.get(toolResultId);
    if (eventId == null) return;

    const resultText = typeof block.content === 'string'
      ? block.content
      : JSON.stringify(block.content);

    const isError = block.is_error === true
      || (typeof resultText === 'string' && (
        resultText.includes('<tool_use_error>') || resultText.startsWith('Error:')
      ));

    await this.writer.updateToolCall(eventId, {
      status: isError ? 'error' : 'completed',
      result: resultText,
      isError,
    });
  }

  private async handleStandaloneToolUse(chunk: any): Promise<void> {
    await this.flush();
    const toolName: string = chunk.name || 'unknown';
    const toolId: string = chunk.id || `tool-${Date.now()}`;
    const toolArgs: Record<string, unknown> = chunk.input ?? {};
    const mcp = parseMcpToolName(toolName);

    if (SUBAGENT_TOOLS.has(toolName)) {
      if (this.subagentEventIds.has(toolId)) return;
      await this.handleSubagentSpawn(toolId, toolName, toolArgs);
      return;
    }

    // Deduplicate repeated standalone tool_use chunks
    if (this.toolCallEventIds.has(toolId)) return;

    // Resolve parent subagent for nested tool calls
    const parentToolId: string | undefined = chunk.parent_tool_use_id;
    const subagentId = parentToolId && this.subagentEventIds.has(parentToolId) ? parentToolId : undefined;

    const event = await this.writer.createToolCall(this.sessionId, {
      toolName,
      toolDisplayName: toolDisplayName(toolName),
      description: typeof toolArgs.description === 'string' ? toolArgs.description : null,
      arguments: toolArgs,
      targetFilePath: extractTargetFilePath(toolName, toolArgs),
      mcpServer: mcp?.mcpServer ?? null,
      mcpTool: mcp?.mcpTool ?? null,
      providerToolCallId: toolId,
      subagentId,
    });

    this.toolCallEventIds.set(toolId, event.id);
  }

  private async handleSubagentSpawn(toolId: string, toolName: string, args: Record<string, unknown>): Promise<void> {
    const prompt = typeof args.prompt === 'string' ? args.prompt : JSON.stringify(args);
    const teammateName = typeof args.name === 'string' ? args.name : null;
    const teamName = typeof args.team_name === 'string' ? args.team_name : null;
    const teammateMode = typeof args.mode === 'string' ? args.mode : null;
    const isBackground = args.run_in_background === true;

    const event = await this.writer.createSubagent(this.sessionId, {
      subagentId: toolId,
      agentType: toolName,
      teammateName,
      teamName,
      teammateMode,
      isBackground,
      prompt,
    });

    this.subagentEventIds.set(toolId, event.id);
  }

  private async handleAskUserQuestionToolUse(toolId: string, args: Record<string, unknown>): Promise<void> {
    const questions = Array.isArray(args.questions) ? args.questions : [{ question: String(args.question ?? ''), header: '' }];

    const event = await this.writer.createInteractivePrompt(this.sessionId, {
      promptType: 'ask_user_question',
      requestId: toolId,
      status: 'pending',
      questions: questions.map((q: any) => ({
        question: q.question || '',
        header: q.header || '',
        options: q.options,
        multiSelect: q.multiSelect,
      })),
    });

    this.promptEventIds.set(toolId, event.id);
  }

  private async handleSystemChunk(chunk: any): Promise<void> {
    const subtype: string = chunk.subtype || '';

    if (subtype === 'init') {
      await this.writer.appendSystemMessage(this.sessionId, 'Session initialized', {
        systemType: 'init',
        searchable: false,
      });
    } else if (subtype === 'task_started') {
      // SDK-native subagent started
      const taskId: string = chunk.task_id;
      const description: string = chunk.description || '';
      const toolUseId: string | undefined = chunk.tool_use_id;

      // Deduplicate: the SDK sends both a tool_use block (name: "Agent") and a
      // system task_started event for the same subagent. If the tool_use block
      // was already processed, just alias the taskId to the existing event.
      if (toolUseId && this.subagentEventIds.has(toolUseId)) {
        const existingEventId = this.subagentEventIds.get(toolUseId)!;
        this.subagentEventIds.set(taskId, existingEventId);
        return;
      }
      if (this.subagentEventIds.has(taskId)) return;

      const event = await this.writer.createSubagent(this.sessionId, {
        subagentId: taskId,
        agentType: chunk.task_type || 'task',
        prompt: description,
        teammateName: null,
      });

      this.subagentEventIds.set(taskId, event.id);
      // Also map by tool_use_id if present for tool_result correlation
      if (toolUseId) {
        this.subagentEventIds.set(toolUseId, event.id);
      }
    } else if (subtype === 'task_notification') {
      const taskId: string = chunk.task_id;
      const eventId = this.subagentEventIds.get(taskId);
      if (eventId != null) {
        await this.writer.updateSubagent(eventId, {
          status: 'completed',
          resultSummary: chunk.summary,
          toolCallCount: chunk.usage?.tool_uses,
          durationMs: chunk.usage?.duration_ms,
        });
      }
    } else if (subtype === 'compact_boundary') {
      await this.flush();
      // Compaction happened -- record as system message + turn_ended with contextCompacted
      await this.writer.appendSystemMessage(this.sessionId, 'Context compacted', {
        systemType: 'status',
        searchable: false,
      });
    }
    // task_progress is informational and doesn't produce a canonical event
  }

  private async handleResultChunk(chunk: any): Promise<void> {
    await this.flush();

    // Extract usage data
    const usage = chunk.usage;
    const modelUsage = chunk.modelUsage;

    // Compute cumulative usage from modelUsage (more accurate)
    let totalInput = 0;
    let totalOutput = 0;
    let totalCost = 0;
    let cacheRead = 0;
    let cacheCreation = 0;
    let contextWindow = 0;
    let webSearchRequests = 0;

    if (modelUsage && typeof modelUsage === 'object') {
      for (const modelName of Object.keys(modelUsage)) {
        const stats = modelUsage[modelName];
        totalInput += stats.inputTokens || 0;
        totalOutput += stats.outputTokens || 0;
        totalCost += stats.costUSD || 0;
        cacheRead += stats.cacheReadInputTokens || 0;
        cacheCreation += stats.cacheCreationInputTokens || 0;
        if (stats.contextWindow) contextWindow = stats.contextWindow;
        webSearchRequests += stats.webSearchRequests || 0;
      }
    } else if (usage) {
      totalInput = usage.input_tokens || 0;
      totalOutput = usage.output_tokens || 0;
      cacheRead = usage.cache_read_input_tokens || 0;
      cacheCreation = usage.cache_creation_input_tokens || 0;
    }

    // Only record if we have any usage data
    if (totalInput > 0 || totalOutput > 0) {
      await this.writer.recordTurnEnded(this.sessionId, {
        contextFill: {
          inputTokens: totalInput,
          cacheReadInputTokens: cacheRead,
          cacheCreationInputTokens: cacheCreation,
          outputTokens: totalOutput,
          totalContextTokens: totalInput + cacheRead + cacheCreation,
        },
        contextWindow,
        cumulativeUsage: {
          inputTokens: totalInput,
          outputTokens: totalOutput,
          cacheReadInputTokens: cacheRead,
          cacheCreationInputTokens: cacheCreation,
          costUSD: totalCost,
          webSearchRequests,
        },
        contextCompacted: false,
      });
    }
  }

  private async handleSummaryChunk(chunk: any): Promise<void> {
    await this.flush();
    const summary: string = chunk.summary || '';
    await this.writer.appendSystemMessage(this.sessionId, summary, {
      systemType: 'status',
    });
  }

  private async handleUserChunk(chunk: any): Promise<void> {
    const content = chunk.message?.content;
    if (!Array.isArray(content)) return;

    for (const block of content) {
      if (block.type === 'tool_result') {
        await this.handleToolResultBlock(block);
      }
    }
  }

  private async handleRateLimitEvent(chunk: any): Promise<void> {
    const info = chunk.rate_limit_info;
    if (!info) return;
    // Only record non-"allowed" statuses
    if (info.status === 'allowed') return;

    const limitType = info.rateLimitType === 'five_hour' ? '5-hour session' : info.rateLimitType || 'unknown';
    const message = `Rate limit: ${info.status} (${limitType})`;

    await this.writer.appendSystemMessage(this.sessionId, message, {
      systemType: 'error',
    });
  }

  /**
   * Record a tool permission request as an interactive prompt.
   */
  async handlePermissionRequest(request: {
    requestId: string;
    toolName: string;
    rawCommand: string;
    pattern: string;
    patternDisplayName: string;
    isDestructive: boolean;
    warnings: string[];
  }): Promise<void> {
    const event = await this.writer.createInteractivePrompt(this.sessionId, {
      promptType: 'permission_request',
      requestId: request.requestId,
      status: 'pending',
      toolName: request.toolName,
      rawCommand: request.rawCommand,
      pattern: request.pattern,
      patternDisplayName: request.patternDisplayName,
      isDestructive: request.isDestructive,
      warnings: request.warnings,
    });

    this.promptEventIds.set(request.requestId, event.id);
  }

  /**
   * Record a git commit proposal as an interactive prompt.
   */
  async handleGitCommitProposal(proposal: {
    requestId: string;
    commitMessage: string;
    stagedFiles: string[];
  }): Promise<void> {
    const event = await this.writer.createInteractivePrompt(this.sessionId, {
      promptType: 'git_commit_proposal',
      requestId: proposal.requestId,
      status: 'pending',
      commitMessage: proposal.commitMessage,
      stagedFiles: proposal.stagedFiles,
    });

    this.promptEventIds.set(proposal.requestId, event.id);
  }
}
