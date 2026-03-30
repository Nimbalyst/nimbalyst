import { TranscriptMigrationRepository } from '@nimbalyst/runtime';
import type { Message } from '@nimbalyst/runtime/ai/server/types';

/**
 * Load legacy UI messages for a session via the transcript migration service.
 * Shared helper used by ExportHandlers and ShareHandlers.
 */
export async function loadLegacyMessages(
  sessionId: string,
  provider: string,
): Promise<{ success: true; messages: Message[] } | { success: false; error: string }> {
  if (!TranscriptMigrationRepository.hasService()) {
    return { success: false, error: 'TranscriptMigrationService not available' };
  }
  const messages = await TranscriptMigrationRepository.getService().getLegacyMessages(sessionId, provider);
  return { success: true, messages };
}
