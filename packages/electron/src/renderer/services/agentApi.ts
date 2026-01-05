import type { Agent, AgentExecutionOptions, AgentExecutionResult } from '@nimbalyst/runtime/agents';

class AgentApi {
  private cache = new Map<string, Agent[]>();

  async getAllAgents(workspacePath?: string): Promise<Agent[]> {
    try {
      // TODO: Implement agents:getAll IPC handler
      // const agents = await window.electronAPI.invoke('agents:getAll', workspacePath);
      // this.cache.set(workspacePath || 'global', agents);
      // return agents;
      return this.cache.get(workspacePath || 'global') || [];
    } catch (error) {
      console.error('[AgentApi] Failed to get agents:', error);
      return this.cache.get(workspacePath || 'global') || [];
    }
  }

  async getAgent(agentId: string, workspacePath?: string): Promise<Agent | null> {
    try {
      return await window.electronAPI.invoke('agents:get', agentId, workspacePath);
    } catch (error) {
      console.error('[AgentApi] Failed to get agent:', error);
      return null;
    }
  }

  async searchAgents(query: string, workspacePath?: string): Promise<Agent[]> {
    try {
      return await window.electronAPI.invoke('agents:search', query, workspacePath);
    } catch (error) {
      console.error('[AgentApi] Failed to search agents:', error);
      return [];
    }
  }

  async executeAgent(options: AgentExecutionOptions & { workspacePath?: string }): Promise<AgentExecutionResult> {
    try {
      return await window.electronAPI.invoke('agents:execute', options);
    } catch (error) {
      console.error('[AgentApi] Failed to execute agent:', error);
      return {
        success: false,
        sessionId: options.sessionId || '',
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async reloadAgents(workspacePath?: string): Promise<boolean> {
    try {
      return await window.electronAPI.invoke('agents:reload', workspacePath);
    } catch (error) {
      console.error('[AgentApi] Failed to reload agents:', error);
      return false;
    }
  }

  onAgentsUpdated(callback: (workspacePath?: string) => void): () => void {
    const handler = (_event: any, workspacePath?: string) => {
      callback(workspacePath);
    };

    window.electronAPI.on('agents:updated', handler);

    // Return cleanup function
    return () => {
      window.electronAPI.off('agents:updated', handler);
    };
  }
}

export const agentApi = new AgentApi();
