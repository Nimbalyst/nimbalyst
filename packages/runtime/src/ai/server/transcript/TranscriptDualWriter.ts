/**
 * TranscriptDualWriter -- helper that wraps transcript adapter calls in
 * try/catch so that failures in the canonical write path never break the
 * primary streaming flow.
 *
 * Providers call these methods alongside their existing raw message logging.
 * If the transcript store is not available, all calls are silently no-ops.
 */

import { TranscriptWriter } from './TranscriptWriter';
import { TranscriptEventRepository } from '../../../storage/repositories/TranscriptEventRepository';
import { ClaudeCodeTranscriptAdapter } from './adapters/ClaudeCodeTranscriptAdapter';
import { CodexTranscriptAdapter } from './adapters/CodexTranscriptAdapter';
import { ClaudeChatTranscriptAdapter } from './adapters/ClaudeChatTranscriptAdapter';
import { OpenAIChatTranscriptAdapter } from './adapters/OpenAIChatTranscriptAdapter';

type AnyAdapter =
  | ClaudeCodeTranscriptAdapter
  | CodexTranscriptAdapter
  | ClaudeChatTranscriptAdapter
  | OpenAIChatTranscriptAdapter;

/**
 * Try to create a TranscriptWriter + adapter for the given provider/session.
 * Returns null if the transcript store is not available (e.g., in tests).
 */
export function createTranscriptAdapter(
  provider: 'claude-code',
  sessionId: string,
): ClaudeCodeTranscriptAdapter | null;
export function createTranscriptAdapter(
  provider: 'openai-codex',
  sessionId: string,
): CodexTranscriptAdapter | null;
export function createTranscriptAdapter(
  provider: 'claude',
  sessionId: string,
): ClaudeChatTranscriptAdapter | null;
export function createTranscriptAdapter(
  provider: 'openai' | 'lmstudio',
  sessionId: string,
): OpenAIChatTranscriptAdapter | null;
export function createTranscriptAdapter(
  provider: string,
  sessionId: string,
): AnyAdapter | null {
  if (!TranscriptEventRepository.hasStore()) {
    return null;
  }

  try {
    const store = TranscriptEventRepository.getStore();
    const writer = new TranscriptWriter(store, provider);

    switch (provider) {
      case 'claude-code':
        return new ClaudeCodeTranscriptAdapter(writer, sessionId);
      case 'openai-codex':
        return new CodexTranscriptAdapter(writer, sessionId);
      case 'claude':
        return new ClaudeChatTranscriptAdapter(writer, sessionId);
      case 'openai':
      case 'lmstudio':
        return new OpenAIChatTranscriptAdapter(writer, sessionId);
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/**
 * Safely call an async adapter method. Errors are logged but never propagated.
 * This ensures the canonical write path can never break the primary streaming flow.
 */
export async function safeTranscriptCall(
  fn: () => Promise<void>,
  context?: string,
): Promise<void> {
  try {
    await fn();
  } catch (error) {
    console.warn(`[TranscriptDualWriter] ${context ?? 'adapter call'} failed:`, error);
  }
}
