import type { CreateAgentMessageInput, AgentMessage } from '../../ai/server/types';

export interface AgentMessagesStore {
  create(message: CreateAgentMessageInput): Promise<void>;
  list(sessionId: string, options?: { limit?: number; offset?: number; includeHidden?: boolean }): Promise<AgentMessage[]>;
  /** Get message counts for multiple sessions in a single query */
  getMessageCounts?(sessionIds: string[]): Promise<Map<string, number>>;
}

let storeInstance: AgentMessagesStore | null = null;

function requireStore(): AgentMessagesStore {
  if (!storeInstance) {
    throw new Error('Agent messages store adapter has not been provided to the runtime');
  }
  return storeInstance;
}

export const AgentMessagesRepository = {
  setStore(store: AgentMessagesStore): void {
    storeInstance = store;
  },

  registerStore(store: AgentMessagesStore): void {
    storeInstance = store;
  },

  clearStore(): void {
    storeInstance = null;
  },

  getStore(): AgentMessagesStore {
    return requireStore();
  },

  async create(message: CreateAgentMessageInput): Promise<void> {
    await requireStore().create(message);
  },

  async list(sessionId: string, options?: { limit?: number; offset?: number; includeHidden?: boolean }): Promise<AgentMessage[]> {
    return await requireStore().list(sessionId, options);
  },

  async getMessageCounts(sessionIds: string[]): Promise<Map<string, number>> {
    const store = requireStore();
    if (store.getMessageCounts) {
      return await store.getMessageCounts(sessionIds);
    }
    // Fallback: query each session individually (N+1, but works for stores without batch support)
    const counts = new Map<string, number>();
    for (const sessionId of sessionIds) {
      const messages = await store.list(sessionId);
      counts.set(sessionId, messages.length);
    }
    return counts;
  },
};
