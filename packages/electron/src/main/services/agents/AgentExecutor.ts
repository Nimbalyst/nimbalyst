import type {
  Agent,
  AgentExecutionOptions,
  AgentExecutionResult,
} from '@stravu/runtime/agents';
import { AgentValidator } from './AgentSchema';

export interface AISessionInterface {
  sendMessage(message: string, context?: any): Promise<any>;
  getSessionId(): string;
}

export class AgentExecutor {
  constructor(
    private getAISession: (sessionId?: string) => AISessionInterface | undefined
  ) {}

  async executeAgent(
    agent: Agent,
    options: AgentExecutionOptions
  ): Promise<AgentExecutionResult> {
    try {
      // Validate parameters if provided
      const validatedParams = agent.metadata.parameters
        ? AgentValidator.validateParameters(
            options.parameters || {},
            agent.metadata.parameters
          )
        : options.parameters || {};

      // Get or create AI session
      const session = this.getAISession(options.sessionId);
      if (!session) {
        throw new Error('Failed to get AI session');
      }

      // Build the agent prompt with parameters
      let prompt = this.buildAgentPrompt(agent, validatedParams);

      // Add document context if provided
      if (options.documentContext) {
        prompt = `${prompt}\n\n---\nCurrent Document:\n${options.documentContext}`;
      }

      // Execute through AI session
      const result = await session.sendMessage(prompt, {
        isAgentExecution: true,
        agentId: agent.id,
        agentMetadata: agent.metadata,
        tools: agent.metadata.tools,
      });

      return {
        success: true,
        sessionId: session.getSessionId(),
        outputs: result,
      };
    } catch (error) {
      return {
        success: false,
        sessionId: options.sessionId || '',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private buildAgentPrompt(agent: Agent, parameters: Record<string, any>): string {
    let prompt = agent.content;

    // Replace parameter placeholders if any
    if (Object.keys(parameters).length > 0) {
      // Simple template replacement - can be enhanced later
      for (const [key, value] of Object.entries(parameters)) {
        const placeholder = `{{${key}}}`;
        prompt = prompt.replace(new RegExp(placeholder, 'g'), String(value));
      }
    }

    // Add metadata context
    const metadataContext = [
      `# Agent: ${agent.metadata.name}`,
      agent.metadata.description ? `Description: ${agent.metadata.description}` : '',
      agent.metadata.tools?.length ? `Available tools: ${agent.metadata.tools.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    return `${metadataContext}\n\n${prompt}`;
  }

  /**
   * Format agent for display in UI
   */
  static formatAgentForDisplay(agent: Agent): {
    id: string;
    name: string;
    description: string;
    tags: string[];
    hasParameters: boolean;
  } {
    return {
      id: agent.id,
      name: agent.metadata.name,
      description: agent.metadata.description,
      tags: agent.metadata.tags || [],
      hasParameters: !!agent.metadata.parameters && Object.keys(agent.metadata.parameters).length > 0,
    };
  }
}