/**
 * Static singleton repository for transcript event store access.
 * Follows the same pattern as AgentMessagesRepository: the Electron main
 * process calls setStore() at startup, and providers/services access
 * the store via the static methods.
 */

import type { ITranscriptEventStore } from '../../ai/server/transcript/types';

let storeInstance: ITranscriptEventStore | null = null;

function requireStore(): ITranscriptEventStore {
  if (!storeInstance) {
    throw new Error('Transcript event store adapter has not been provided to the runtime');
  }
  return storeInstance;
}

export const TranscriptEventRepository = {
  setStore(store: ITranscriptEventStore): void {
    storeInstance = store;
  },

  clearStore(): void {
    storeInstance = null;
  },

  getStore(): ITranscriptEventStore {
    return requireStore();
  },

  hasStore(): boolean {
    return storeInstance != null;
  },
};
