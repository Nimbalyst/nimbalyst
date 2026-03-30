/**
 * CanonicalTranscriptConverter -- bridge layer that converts TranscriptViewMessage[]
 * (from the canonical TranscriptProjector) back to the legacy Message[] format
 * that the renderer currently expects.
 *
 * This ensures zero visual regression while the read path migrates from
 * raw ai_agent_messages to canonical ai_transcript_events.
 */

import type { TranscriptViewMessage } from './TranscriptProjector';
import type { Message, ToolCall, ToolResult } from '../types';

/**
 * Convert projected canonical transcript view messages into the legacy
 * Message[] format consumed by the renderer.
 */
/**
 * Parse a tool result string back into an object if it was JSON-stringified.
 *
 * The canonical store always writes tool results as strings (via JSON.stringify
 * in the transcript adapters). The legacy Message format expects the result as
 * its original shape -- e.g. an MCP content array `[{type:"text", text:"..."}]`
 * or a ToolResult object. Custom widgets rely on this structured format.
 *
 * Plain text results (e.g. "file contents here") that aren't valid JSON are
 * returned as-is.
 */
function parseToolResult(result?: string): ToolResult | string | undefined {
  if (result == null) return undefined;
  try {
    return JSON.parse(result) as ToolResult;
  } catch {
    return result;
  }
}

export function convertCanonicalToLegacyMessages(viewMessages: TranscriptViewMessage[]): Message[] {
  const messages: Message[] = [];

  for (const vm of viewMessages) {
    const converted = convertViewMessage(vm);
    if (converted) {
      messages.push(converted);
    }
  }

  return messages;
}

function convertViewMessage(vm: TranscriptViewMessage): Message | null {
  const timestamp = vm.createdAt.getTime();

  switch (vm.type) {
    case 'user_message':
      return {
        role: 'user',
        content: vm.text ?? '',
        timestamp,
        mode: vm.mode === 'agent' ? 'agent' : vm.mode === 'planning' ? 'planning' : undefined,
        isUserInput: true,
        attachments: vm.attachments as Message['attachments'],
      };

    case 'assistant_message':
      return {
        role: 'assistant',
        content: vm.text ?? '',
        timestamp,
        mode: vm.mode === 'agent' ? 'agent' : vm.mode === 'planning' ? 'planning' : undefined,
        isComplete: true,
      };

    case 'system_message': {
      const systemType = vm.systemMessage?.systemType;
      if (systemType === 'init') {
        return null; // Internal bookkeeping, not user-facing
      }
      if (systemType === 'error') {
        return {
          role: 'assistant',
          content: vm.text ?? '',
          timestamp,
          isError: true,
          errorMessage: vm.text ?? '',
        };
      }
      return {
        role: 'system',
        content: vm.text ?? '',
        timestamp,
        isSystem: true,
        isUserInput: false,
      };
    }

    case 'tool_call': {
      if (!vm.toolCall) return null;

      const tc = vm.toolCall;
      const isTaskAgent = tc.toolName === 'Task' || tc.toolName === 'Agent';

      const toolCall: ToolCall = {
        id: tc.providerToolCallId ?? undefined,
        name: tc.toolName,
        arguments: tc.arguments,
        result: parseToolResult(tc.result),
        targetFilePath: tc.targetFilePath ?? undefined,
        isSubAgent: isTaskAgent || undefined,
        subAgentType: isTaskAgent ? String(tc.arguments?.subagent_type || '') : undefined,
        childToolCalls: [],
      };

      // Populate sub-agent team metadata from arguments
      if (isTaskAgent) {
        const args = tc.arguments as Record<string, unknown>;
        toolCall.teammateName = args?.name as string | undefined;
        toolCall.teamName = args?.team_name as string | undefined;
        toolCall.teammateMode = args?.mode as string | undefined;
        if (args?.name && args?.team_name) {
          toolCall.teammateAgentId = `${args.name}@${args.team_name}`;
          toolCall.teammateColor = 'blue';
        }
      }

      // Attach tool progress
      if (tc.progress && tc.progress.length > 0) {
        const lastProgress = tc.progress[tc.progress.length - 1];
        toolCall.toolProgress = {
          toolName: tc.toolName,
          elapsedSeconds: lastProgress.elapsedSeconds,
        };
      }

      const msg: Message = {
        role: 'tool',
        content: '',
        timestamp,
        toolCall,
        isError: tc.isError,
      };

      return msg;
    }

    case 'interactive_prompt': {
      if (!vm.interactivePrompt) return null;

      // Interactive prompts are stored as nimbalyst_tool_use messages
      // with the prompt data in arguments
      const prompt = vm.interactivePrompt;
      const toolCall: ToolCall = {
        id: prompt.requestId,
        name: prompt.promptType === 'permission_request'
          ? 'ToolPermission'
          : prompt.promptType === 'ask_user_question'
            ? 'AskUserQuestion'
            : 'GitCommitProposal',
        arguments: prompt as unknown as Record<string, unknown>,
        childToolCalls: [],
      };

      // Add result based on status
      if (prompt.status === 'resolved') {
        if (prompt.promptType === 'permission_request') {
          toolCall.result = JSON.stringify({
            decision: prompt.decision,
            scope: prompt.scope,
          });
        } else if (prompt.promptType === 'ask_user_question') {
          toolCall.result = JSON.stringify({
            answers: prompt.answers,
            cancelled: prompt.cancelled,
          });
        } else if (prompt.promptType === 'git_commit_proposal') {
          toolCall.result = {
            success: prompt.decision === 'committed',
            result: {
              action: prompt.decision,
              commitHash: prompt.commitSha,
              commitMessage: prompt.commitMessage,
            },
          };
        }
      }

      return {
        role: 'tool',
        content: '',
        timestamp,
        toolCall,
      };
    }

    case 'subagent': {
      if (!vm.subagent) return null;

      const sub = vm.subagent;
      const toolCall: ToolCall = {
        id: vm.subagentId ?? undefined,
        name: 'Agent',
        arguments: {
          subagent_type: sub.agentType,
          name: sub.teammateName,
          team_name: sub.teamName,
          mode: sub.teammateMode,
          description: sub.agentType || undefined,
          prompt: sub.prompt || undefined,
          run_in_background: sub.isBackground || undefined,
        },
        isSubAgent: true,
        subAgentType: sub.agentType,
        teammateName: sub.teammateName ?? undefined,
        teamName: sub.teamName ?? undefined,
        teammateMode: sub.teammateMode ?? undefined,
        teammateColor: sub.color ?? undefined,
        childToolCalls: sub.childEvents
          .filter(child => child.type === 'tool_call')
          .map(child => {
            const converted = convertViewMessage(child);
            return converted ?? {
              role: 'tool' as const,
              content: '',
              timestamp: child.createdAt.getTime(),
            };
          }),
      };

      // Set result summary if completed
      if (sub.status === 'completed' && sub.resultSummary) {
        toolCall.result = sub.resultSummary;
      }

      return {
        role: 'tool',
        content: '',
        timestamp,
        toolCall,
      };
    }

    case 'turn_ended': {
      // Turn ended events carry context usage data.
      // The legacy path treats these as metadata on the last assistant message,
      // but they aren't rendered directly. We can skip them in the message list.
      // The token usage is handled via SessionManager.updateSessionTokenUsage.
      return null;
    }

    default:
      return null;
  }
}
