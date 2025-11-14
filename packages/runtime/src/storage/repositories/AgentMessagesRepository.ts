import type { CreateAgentMessageInput, AgentMessage } from '../../ai/server/types';

export interface AgentMessagesStore {
  create(message: CreateAgentMessageInput): Promise<void>;
  list(sessionId: string, options?: { limit?: number; offset?: number; includeHidden?: boolean }): Promise<AgentMessage[]>;
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
};
