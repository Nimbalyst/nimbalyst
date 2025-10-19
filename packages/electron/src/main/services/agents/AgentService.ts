import type { Agent } from '@nimbalyst/runtime/agents';
import { AgentRegistry } from './AgentRegistry';
import { AgentExecutor } from './AgentExecutor';
import { ipcMain, BrowserWindow } from 'electron';
import { AIService } from '../ai/AIService';
import * as path from 'path';

export class AgentService {
  private registryByWorkspace = new Map<string, AgentRegistry>();
  private aiService: AIService;

  constructor(aiService: AIService) {
    this.aiService = aiService;
    this.setupIpcHandlers();
  }

  private getOrCreateRegistry(workspacePath?: string): AgentRegistry {
    const key = workspacePath || 'global';

    if (!this.registryByWorkspace.has(key)) {
      const registry = new AgentRegistry({
        workspacePath,
        watchForChanges: true
      });

      // Initialize the registry asynchronously
      registry.initialize().catch(error => {
        console.error(`[AgentService] Failed to initialize registry for ${key}:`, error);
      });

      // Listen for agent changes
      registry.on('agents:reloaded', () => {
        // Notify all windows about the update
        BrowserWindow.getAllWindows().forEach(window => {
          window.webContents.send('agents:updated', workspacePath);
        });
      });

      this.registryByWorkspace.set(key, registry);
    }

    return this.registryByWorkspace.get(key)!;
  }

  private setupIpcHandlers() {
    // Get all agents for a workspace
    ipcMain.handle('agents:getAll', async (event, workspacePath?: string) => {
      try {
        const registry = this.getOrCreateRegistry(workspacePath);
        const agents = registry.getAllAgents();

        // Convert agents to serializable format
        return agents.map(agent => ({
          id: agent.id,
          path: agent.path,
          metadata: agent.metadata,
          content: agent.content,
          lastModified: agent.lastModified?.toISOString()
        }));
      } catch (error) {
        console.error('[AgentService] Failed to get agents:', error);
        return [];
      }
    });

    // Get a specific agent
    ipcMain.handle('agents:get', async (event, agentId: string, workspacePath?: string) => {
      try {
        const registry = this.getOrCreateRegistry(workspacePath);
        const agent = registry.getAgent(agentId);

        if (!agent) return null;

        return {
          id: agent.id,
          path: agent.path,
          metadata: agent.metadata,
          content: agent.content,
          lastModified: agent.lastModified?.toISOString()
        };
      } catch (error) {
        console.error('[AgentService] Failed to get agent:', error);
        return null;
      }
    });

    // Search agents
    ipcMain.handle('agents:search', async (event, query: string, workspacePath?: string) => {
      try {
        const registry = this.getOrCreateRegistry(workspacePath);
        const agents = registry.searchAgents(query);

        return agents.map(agent => ({
          id: agent.id,
          path: agent.path,
          metadata: agent.metadata,
          content: agent.content,
          lastModified: agent.lastModified?.toISOString()
        }));
      } catch (error) {
        console.error('[AgentService] Failed to search agents:', error);
        return [];
      }
    });

    // Execute an agent
    ipcMain.handle('agents:execute', async (event, options: {
      agentId: string;
      parameters?: Record<string, any>;
      documentContext?: string;
      sessionId?: string;
      workspacePath?: string;
    }) => {
      try {
        const registry = this.getOrCreateRegistry(options.workspacePath);
        const agent = registry.getAgent(options.agentId);

        if (!agent) {
          throw new Error(`Agent not found: ${options.agentId}`);
        }

        // Create executor with AI session interface
        const executor = new AgentExecutor((sessionId) => {
          // Get the window that initiated this request
          const window = BrowserWindow.fromWebContents(event.sender);
          if (!window) {
            throw new Error('No window found for agent execution');
          }

          return {
            sendMessage: async (message: string, context: any) => {
              // Notify the window that an agent message is coming
              window.webContents.send('agent:message', {
                sessionId,
                message,
                agentId: options.agentId,
                agentName: agent.metadata.name
              });

              // Return success - the actual AI response will happen in the renderer
              return { success: true };
            },
            getSessionId: () => sessionId || 'new-session'
          };
        });

        const result = await executor.executeAgent(agent, {
          agentId: options.agentId,
          parameters: options.parameters,
          documentContext: options.documentContext,
          sessionId: options.sessionId
        });

        return result;
      } catch (error) {
        console.error('[AgentService] Failed to execute agent:', error);
        return {
          success: false,
          sessionId: options.sessionId || '',
          error: error instanceof Error ? error.message : String(error)
        };
      }
    });

    // Reload agents for a workspace
    ipcMain.handle('agents:reload', async (event, workspacePath?: string) => {
      try {
        const registry = this.getOrCreateRegistry(workspacePath);
        await registry.initialize();
        return true;
      } catch (error) {
        console.error('[AgentService] Failed to reload agents:', error);
        return false;
      }
    });
  }

  async dispose() {
    for (const registry of this.registryByWorkspace.values()) {
      await registry.dispose();
    }
    this.registryByWorkspace.clear();
  }
}