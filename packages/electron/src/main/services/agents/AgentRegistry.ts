import { EventEmitter } from 'events';
import * as path from 'path';
import * as fs from 'fs/promises';
import { Agent, AgentRegistryOptions } from '@nimbalyst/runtime/agents';
import { AgentValidator } from './AgentSchema';

export class AgentRegistry extends EventEmitter {
  private agents = new Map<string, Agent>();
  private workspacePath?: string;
  private watcherAbortController?: AbortController;
  private failedAgents = new Set<string>(); // Track failed files to avoid retry loops
  private lastScanTime = 0;

  constructor(private options: AgentRegistryOptions = {}) {
    super();
    this.workspacePath = options.workspacePath;
  }

  async initialize(): Promise<void> {
    if (this.workspacePath) {
      await this.loadWorkspaceAgents();

      if (this.options.watchForChanges) {
        this.startWatching();
      }
    }

    // Load builtin agents if any
    await this.loadBuiltinAgents();
  }

  private async loadWorkspaceAgents(): Promise<void> {
    if (!this.workspacePath) return;

    const agentsDir = path.join(this.workspacePath, 'agents');

    try {
      const stats = await fs.stat(agentsDir);
      if (!stats.isDirectory()) return;
    } catch {
      // Agents directory doesn't exist yet
      return;
    }

    await this.scanDirectory(agentsDir);
  }

  private async scanDirectory(dirPath: string): Promise<void> {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          // Recursively scan subdirectories
          await this.scanDirectory(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          await this.loadAgentFile(fullPath);
        }
      }
    } catch (error) {
      console.error(`Error scanning agents directory ${dirPath}:`, error);
    }
  }

  private async loadAgentFile(filePath: string): Promise<void> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const agent = AgentValidator.parseAgentFile(content, filePath);

      // Add origin if not specified
      if (!agent.metadata.origin) {
        agent.metadata.origin = 'user';
      }

      // Get file stats for last modified time
      const stats = await fs.stat(filePath);
      agent.lastModified = stats.mtime;

      this.registerAgent(agent);
      // Clear from failed list if successful
      this.failedAgents.delete(filePath);
    } catch (error) {
      // Only log error once per file to prevent spam
      if (!this.failedAgents.has(filePath)) {
        console.error(`[AgentRegistry] Error loading agent file ${filePath}:`, error);
        this.failedAgents.add(filePath);
        this.emit('error', { filePath, error });
      }
    }
  }

  private async loadBuiltinAgents(): Promise<void> {
    // TODO: Load any builtin agents that ship with the app
    // These would be hardcoded or loaded from app resources
  }

  registerAgent(agent: Agent): void {
    this.agents.set(agent.id, agent);
    this.emit('agent:registered', agent);
  }

  unregisterAgent(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      this.agents.delete(agentId);
      this.emit('agent:unregistered', agent);
    }
  }

  getAgent(agentId: string): Agent | undefined {
    return this.agents.get(agentId);
  }

  getAllAgents(): Agent[] {
    return Array.from(this.agents.values());
  }

  getAgentsByTag(tag: string): Agent[] {
    return this.getAllAgents().filter(agent =>
      agent.metadata.tags?.includes(tag)
    );
  }

  searchAgents(query: string): Agent[] {
    const lowerQuery = query.toLowerCase();
    return this.getAllAgents().filter(agent => {
      const metadata = agent.metadata;
      return (
        metadata.name.toLowerCase().includes(lowerQuery) ||
        metadata.description.toLowerCase().includes(lowerQuery) ||
        metadata.tags?.some(tag => tag.toLowerCase().includes(lowerQuery))
      );
    });
  }

  private startWatching(): void {
    if (!this.workspacePath) return;

    // Use the existing file watcher infrastructure
    // This is a simplified version - in production would integrate with FileWatcherService
    this.watcherAbortController = new AbortController();
    const agentsDir = path.join(this.workspacePath, 'agents');

    // Smart polling with file change detection
    const pollInterval = setInterval(async () => {
      if (this.watcherAbortController?.signal.aborted) {
        clearInterval(pollInterval);
        return;
      }

      try {
        // Check if directory has been modified since last scan
        const stats = await fs.stat(agentsDir).catch(() => null);
        if (!stats) return; // Directory doesn't exist yet

        const modTime = stats.mtimeMs;
        if (modTime > this.lastScanTime) {
          // Directory has changed, rescan
          this.lastScanTime = modTime;

          // Don't clear all agents - just reload
          const previousAgentCount = this.agents.size;
          await this.loadWorkspaceAgents();

          // Only emit if agents actually changed
          if (this.agents.size !== previousAgentCount) {
            this.emit('agents:reloaded');
          }
        }
      } catch (error) {
        console.error('[AgentRegistry] Error in file watcher:', error);
      }
    }, 5000); // Poll every 5 seconds instead of 2

    // Store interval ID for cleanup
    (this.watcherAbortController as any).intervalId = pollInterval;
  }

  async dispose(): Promise<void> {
    if (this.watcherAbortController) {
      this.watcherAbortController.abort();
      const intervalId = (this.watcherAbortController as any).intervalId;
      if (intervalId) {
        clearInterval(intervalId);
      }
    }
    this.agents.clear();
    this.removeAllListeners();
  }
}