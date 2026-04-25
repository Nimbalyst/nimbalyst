/**
 * Descriptor processor -- maps CanonicalEventDescriptor values to TranscriptWriter
 * calls and maintains the tool/subagent ID tracking maps.
 *
 * Shared between TranscriptTransformer (server-side, DB-backed) and
 * projectRawMessages (client-side, in-memory) so both paths produce
 * identical canonical events.
 */

import type { TranscriptWriter } from './TranscriptWriter';
import type { ITranscriptEventStore, TranscriptEvent } from './types';
import type { CanonicalEventDescriptor } from './parsers/IRawMessageParser';

export async function processDescriptor(
  writer: TranscriptWriter,
  store: ITranscriptEventStore,
  sessionId: string,
  desc: CanonicalEventDescriptor,
  toolEventIds: Map<string, number>,
  subagentEventIds: Map<string, number>,
): Promise<TranscriptEvent | null> {
  switch (desc.type) {
    case 'user_message': {
      return writer.appendUserMessage(sessionId, desc.text, {
        mode: desc.mode,
        attachments: desc.attachments,
        createdAt: desc.createdAt,
      });
    }

    case 'assistant_message': {
      return writer.appendAssistantMessage(sessionId, desc.text, {
        mode: desc.mode,
        createdAt: desc.createdAt,
      });
    }

    case 'system_message': {
      return writer.appendSystemMessage(sessionId, desc.text, {
        systemType: desc.systemType,
        searchable: desc.searchable,
        createdAt: desc.createdAt,
        isAuthError: desc.isAuthError,
        reminderKind: desc.reminderKind,
      });
    }

    case 'tool_call_started': {
      if (desc.providerToolCallId && !toolEventIds.has(desc.providerToolCallId)) {
        const existing = await store.findByProviderToolCallId(desc.providerToolCallId, sessionId);
        if (existing) {
          const existingPayload = existing.payload as Record<string, unknown>;
          if (existingPayload.toolName === desc.toolName) {
            toolEventIds.set(desc.providerToolCallId, existing.id);
            return null;
          }
        }
      }
      const event = await writer.createToolCall(sessionId, {
        toolName: desc.toolName,
        toolDisplayName: desc.toolDisplayName,
        arguments: desc.arguments,
        targetFilePath: desc.targetFilePath,
        mcpServer: desc.mcpServer,
        mcpTool: desc.mcpTool,
        providerToolCallId: desc.providerToolCallId,
        subagentId: desc.subagentId,
        createdAt: desc.createdAt,
      });
      if (desc.providerToolCallId) {
        toolEventIds.set(desc.providerToolCallId, event.id);
      }
      return event;
    }

    case 'tool_call_completed': {
      let eventId = toolEventIds.get(desc.providerToolCallId);
      if (!eventId) {
        const existing = await store.findByProviderToolCallId(desc.providerToolCallId, sessionId);
        if (existing) {
          eventId = existing.id;
          toolEventIds.set(desc.providerToolCallId, eventId);
        }
      }
      if (!eventId) return null;

      await writer.updateToolCall(eventId, {
        status: desc.status,
        result: desc.result,
        isError: desc.isError,
        exitCode: desc.exitCode,
        durationMs: desc.durationMs,
      });
      return store.getEventById(eventId);
    }

    case 'tool_progress': {
      const parentEventId = toolEventIds.get(desc.providerToolCallId);
      if (!parentEventId) return null;

      return writer.appendToolProgress(sessionId, {
        parentEventId,
        toolName: desc.toolName,
        elapsedSeconds: desc.elapsedSeconds,
        progressContent: desc.progressContent,
        subagentId: desc.subagentId,
        createdAt: desc.createdAt,
      });
    }

    case 'subagent_started': {
      const event = await writer.createSubagent(sessionId, {
        subagentId: desc.subagentId,
        agentType: desc.agentType,
        teammateName: desc.teammateName,
        teamName: desc.teamName,
        teammateMode: desc.teammateMode,
        isBackground: desc.isBackground,
        prompt: desc.prompt,
        createdAt: desc.createdAt,
      });
      subagentEventIds.set(desc.subagentId, event.id);
      toolEventIds.set(desc.subagentId, event.id);
      return event;
    }

    case 'subagent_completed': {
      const eventId = subagentEventIds.get(desc.subagentId);
      if (!eventId) return null;

      await writer.updateSubagent(eventId, {
        status: desc.status,
        resultSummary: desc.resultSummary,
      });
      return store.getEventById(eventId);
    }

    case 'interactive_prompt_created': {
      return writer.createInteractivePrompt(sessionId, desc.payload, {
        subagentId: desc.subagentId,
        createdAt: desc.createdAt,
      });
    }

    case 'interactive_prompt_updated': {
      return null;
    }

    case 'turn_ended': {
      return writer.recordTurnEnded(sessionId, {
        contextFill: desc.contextFill,
        contextWindow: desc.contextWindow,
        cumulativeUsage: desc.cumulativeUsage,
        contextCompacted: desc.contextCompacted,
        subagentId: desc.subagentId,
      });
    }

    default:
      return null;
  }
}

export function selectRawParser(provider: string): 'codex' | 'copilot' | 'claude-code' | 'opencode' {
  if (provider === 'copilot-cli') {
    return 'copilot';
  }
  if (provider === 'openai-codex') {
    return 'codex';
  }
  if (provider === 'opencode') {
    return 'opencode';
  }
  return 'claude-code';
}
