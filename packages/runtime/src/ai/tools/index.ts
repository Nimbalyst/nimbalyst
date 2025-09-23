import type { StreamingConfig } from '../types';
import { applyReplacements, endStreamingEdit, startStreamingEdit, streamContent, getDocumentContent } from '../editorBridge';
import { FILE_TOOLS } from './fileTools';
import { DOCUMENT_TOOLS } from './documentTools';

export type ToolSource = 'runtime' | 'renderer' | 'main';

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
  handler?: (args: any) => Promise<any> | any;
  source?: ToolSource;
}

export const BUILT_IN_TOOLS: ToolDefinition[] = [
  {
    name: 'applyDiff',
    description:
      'Apply text replacements to the current document. REQUIRED for adding rows to tables - replace the entire table.',
    parameters: {
      type: 'object',
      properties: {
        replacements: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              oldText: {
                type: 'string',
                description:
                  'Text to replace (for tables: the COMPLETE existing table including all rows)',
              },
              newText: {
                type: 'string',
                description:
                  'Replacement text (for tables: the COMPLETE updated table with new rows added)',
              },
            },
            required: ['oldText', 'newText'],
          },
        },
      },
      required: ['replacements'],
    },
    source: 'runtime',
  },
  {
    name: 'streamContent',
    description:
      'Stream new content to the editor. For tables: set insertAfter to the COMPLETE table, content to ONLY the new rows.',
    parameters: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'The content to stream (for tables: ONLY the new rows like "| Cell1 | Cell2 |")',
        },
        position: {
          type: 'string',
          enum: ['cursor', 'end', 'after-selection'],
          description: 'Where to insert the content',
        },
        insertAfter: {
          type: 'string',
          description:
            'Text to insert after (for tables: the COMPLETE table including all rows)',
        },
        mode: {
          type: 'string',
          enum: ['append', 'replace', 'insert'],
          description: 'How to handle the content',
        },
      },
      required: ['content'],
    },
    source: 'runtime',
  },
  // Add document tools
  ...DOCUMENT_TOOLS,
  // Add file operation tools
  ...FILE_TOOLS,
];

type ToolRegistryEventName = 'tool:registered' | 'tool:unregistered';

type ToolRegistryEventListener = (tool: ToolDefinition) => void;

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();
  private listeners = new Map<ToolRegistryEventName, Set<ToolRegistryEventListener>>();

  constructor(initialTools: ToolDefinition[] = BUILT_IN_TOOLS) {
    initialTools.forEach(tool => this.tools.set(tool.name, tool));
  }

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
    this.emit('tool:registered', tool);
  }

  registerMany(tools: ToolDefinition[]): void {
    tools.forEach(tool => this.register(tool));
  }

  unregister(toolName: string): void {
    const tool = this.tools.get(toolName);
    if (tool) {
      this.tools.delete(toolName);
      this.emit('tool:unregistered', tool);
    }
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  clear(): void {
    this.tools.clear();
  }

  toOpenAI(): any[] {
    return toOpenAITools(this.getAll());
  }

  toAnthropic(): any[] {
    return toAnthropicTools(this.getAll());
  }

  on(event: ToolRegistryEventName, listener: ToolRegistryEventListener): void {
    const listeners = this.listeners.get(event) ?? new Set<ToolRegistryEventListener>();
    listeners.add(listener);
    this.listeners.set(event, listeners);
  }

  off(event: ToolRegistryEventName, listener: ToolRegistryEventListener): void {
    const listeners = this.listeners.get(event);
    if (!listeners) return;
    listeners.delete(listener);
    if (listeners.size === 0) {
      this.listeners.delete(event);
    }
  }

  private emit(event: ToolRegistryEventName, tool: ToolDefinition): void {
    const listeners = this.listeners.get(event);
    if (!listeners) return;
    listeners.forEach(listener => listener(tool));
  }
}

export interface ToolExecutionStartEvent {
  correlationId: string;
  toolName: string;
  args: any;
  source?: ToolSource;
}

export interface ToolExecutionCompleteEvent {
  correlationId: string;
  toolName: string;
  result: any;
}

export interface ToolExecutionErrorEvent {
  correlationId: string;
  toolName: string;
  error: unknown;
}

type ToolExecutorEventMap = {
  'execution:start': ToolExecutionStartEvent;
  'execution:complete': ToolExecutionCompleteEvent;
  'execution:error': ToolExecutionErrorEvent;
};

type ToolExecutorEventName = keyof ToolExecutorEventMap;

type ToolExecutorListener<E extends ToolExecutorEventName> = (event: ToolExecutorEventMap[E]) => void;

export class RuntimeToolExecutor {
  private listeners = new Map<ToolExecutorEventName, Set<ToolExecutorListener<ToolExecutorEventName>>>();
  private correlationCounter = 0;

  constructor(private registry: ToolRegistry) {}

  async execute(name: string, args: any): Promise<any> {
    const tool = this.registry.get(name);
    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }

    const correlationId = this.createCorrelationId(name);
    this.emit('execution:start', {
      correlationId,
      toolName: name,
      args,
      source: tool.source,
    });

    try {
      const result = await this.executeTool(tool, args);
      this.emit('execution:complete', { correlationId, toolName: name, result });
      this.dispatchBrowserEvent(name, args, result);
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.dispatchBrowserEvent(name, args, {
        success: false,
        error: errorMessage,
        ...(error && typeof error === 'object' && 'toolResult' in (error as any)
          ? { result: (error as any).toolResult }
          : {})
      });
      this.emit('execution:error', { correlationId, toolName: name, error });
      throw error;
    }
  }

  on<E extends ToolExecutorEventName>(event: E, listener: ToolExecutorListener<E>): void {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener as ToolExecutorListener<ToolExecutorEventName>);
    this.listeners.set(event, listeners);
  }

  off<E extends ToolExecutorEventName>(event: E, listener: ToolExecutorListener<E>): void {
    const listeners = this.listeners.get(event);
    if (!listeners) return;
    listeners.delete(listener as ToolExecutorListener<ToolExecutorEventName>);
    if (listeners.size === 0) {
      this.listeners.delete(event);
    }
  }

  private async executeTool(tool: ToolDefinition, args: any): Promise<any> {
    if (typeof tool.handler === 'function') {
      return await tool.handler(args);
    }

    switch (tool.name) {
      case 'applyDiff':
        return await this.executeApplyDiff(args);
      case 'streamContent':
        return await this.executeStreamContent(args);
      case 'getDocumentContent':
        return await this.executeGetDocumentContent(args);
      case 'updateFrontmatter':
        return await this.executeUpdateFrontmatter(args);
      case 'createDocument':
        return await this.executeCreateDocument(args);
      default:
        throw new Error(`Tool ${tool.name} has no handler`);
    }
  }

  private async executeApplyDiff(args: { replacements: Array<{ oldText: string; newText: string }> }): Promise<any> {
    if (!args || !Array.isArray(args.replacements)) {
      throw new Error('applyDiff requires replacements array');
    }

    const replacementCount = args.replacements.length;
    if (replacementCount === 0) {
      throw new Error('applyDiff requires at least one replacement');
    }

    try {
      // eslint-disable-next-line no-console
      console.info('[runtime][tool] applyDiff invoked', { replacements: replacementCount });
    } catch {}

    const result = await applyReplacements(args.replacements);

    try {
      // eslint-disable-next-line no-console
      console.info('[runtime][tool] applyDiff result', result);
    } catch {}

    if (!result?.success) {
      const error = new Error(result?.error || 'applyDiff failed to apply replacements');
      (error as any).toolResult = result;
      throw error;
    }

    return result;
  }

  private async executeStreamContent(args: {
    content: string;
    position?: StreamingConfig['position'];
    insertAfter?: string;
    mode?: StreamingConfig['mode'];
  }): Promise<{ success: boolean }> {
    const streamId = `tool_${Date.now()}_${++this.correlationCounter}`;
    startStreamingEdit({
      id: streamId,
      position: args?.position ?? (args?.insertAfter ? 'cursor' : 'cursor'),
      mode: args?.mode ?? 'append',
      insertAfter: args?.insertAfter,
    });

    if (args?.content) {
      streamContent(streamId, args.content);
    }

    endStreamingEdit(streamId);
    return { success: true };
  }

  private async executeGetDocumentContent(args: any): Promise<{ content: string }> {
    try {
      // eslint-disable-next-line no-console
      console.log('[runtime][tool] getDocumentContent called');
      const content = getDocumentContent();
      // eslint-disable-next-line no-console
      console.log('[runtime][tool] Got content, length:', content?.length);
      return { content };
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[runtime][tool] getDocumentContent error:', error);
      throw error;
    }
  }

  private async executeUpdateFrontmatter(args: {
    updates: Record<string, any>;
  }): Promise<any> {
    // eslint-disable-next-line no-console
    console.log('[runtime][tool] updateFrontmatter called with updates:', args?.updates);

    if (!args || !args.updates) {
      throw new Error('updateFrontmatter requires updates object');
    }

    try {
      // Get current document content
      const content = getDocumentContent();

      // Find frontmatter
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!frontmatterMatch) {
        // If no frontmatter exists, create one at the beginning
        const newFrontmatter = `---\n${Object.entries(args.updates)
          .map(([key, value]) => `${key}: "${value}"`)
          .join('\n')}\n---\n\n`;

        // Use streamContent to add frontmatter at the beginning
        const streamId = `frontmatter_${Date.now()}`;
        startStreamingEdit({
          id: streamId,
          position: 'cursor',
          mode: 'insert',
        });
        streamContent(streamId, newFrontmatter);
        endStreamingEdit(streamId);

        const result = { success: true };

        // eslint-disable-next-line no-console
        console.log('[runtime][tool] Created new frontmatter, result:', result);
        return result;
      }

      const originalFrontmatter = frontmatterMatch[0];
      let frontmatterContent = frontmatterMatch[1];

      // Update each field in the frontmatter
      for (const [key, value] of Object.entries(args.updates)) {
        const fieldRegex = new RegExp(`^${key}:\\s*(.*)$`, 'm');
        const match = frontmatterContent.match(fieldRegex);

        if (match) {
          // Replace existing field
          frontmatterContent = frontmatterContent.replace(
            fieldRegex,
            `${key}: "${value}"`
          );
        } else {
          // Add new field
          frontmatterContent += `\n${key}: "${value}"`;
        }
      }

      const newFrontmatter = `---\n${frontmatterContent}\n---`;

      // Apply the replacement
      const result = await applyReplacements([{
        oldText: originalFrontmatter,
        newText: newFrontmatter
      }]);

      // eslint-disable-next-line no-console
      console.log('[runtime][tool] updateFrontmatter result:', result);

      if (!result?.success) {
        const error = new Error(result?.error || 'updateFrontmatter failed');
        (error as any).toolResult = result;
        throw error;
      }

      return result;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[runtime][tool] updateFrontmatter error:', error);
      throw error;
    }
  }

  private async executeCreateDocument(args: {
    filePath: string;
    initialContent?: string;
    switchToFile?: boolean;
  }): Promise<any> {
    // eslint-disable-next-line no-console
    console.log('[runtime][tool] createDocument called with:', args);

    if (!args || !args.filePath) {
      throw new Error('createDocument requires filePath');
    }

    // Dispatch event to renderer to handle document creation
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      return new Promise((resolve, reject) => {
        const correlationId = this.createCorrelationId('createDocument');

        // eslint-disable-next-line no-console
        console.log('[runtime][tool] Setting up response listener with correlationId:', correlationId);

        // Set up listener for response
        const handleResponse = (event: any) => {
          // eslint-disable-next-line no-console
          console.log('[runtime][tool] Received response event:', event.detail);
          if (event.detail?.correlationId === correlationId) {
            window.removeEventListener('aiToolResponse:createDocument', handleResponse);

            if (event.detail.success) {
              resolve(event.detail);
            } else {
              reject(new Error(event.detail.error || 'Failed to create document'));
            }
          }
        };

        window.addEventListener('aiToolResponse:createDocument', handleResponse);

        // Dispatch request
        // eslint-disable-next-line no-console
        console.log('[runtime][tool] Dispatching createDocument request with:', {
          correlationId,
          filePath: args.filePath,
          initialContent: args.initialContent ? `${args.initialContent.substring(0, 100)}...` : '',
          switchToFile: args.switchToFile !== false
        });

        window.dispatchEvent(new CustomEvent('aiToolRequest:createDocument', {
          detail: {
            correlationId,
            filePath: args.filePath,
            initialContent: args.initialContent || '',
            switchToFile: args.switchToFile !== false // Default to true
          }
        }));

        // Timeout after 10 seconds
        setTimeout(() => {
          window.removeEventListener('aiToolResponse:createDocument', handleResponse);
          reject(new Error('createDocument timed out'));
        }, 10000);
      });
    } else {
      throw new Error('createDocument can only be called in browser context');
    }
  }

  private createCorrelationId(name: string): string {
    return `${name}-${Date.now()}-${++this.correlationCounter}`;
  }

  private emit<E extends ToolExecutorEventName>(event: E, payload: ToolExecutorEventMap[E]): void {
    const listeners = this.listeners.get(event);
    if (!listeners) return;
    listeners.forEach(listener => (listener as ToolExecutorListener<E>)(payload));
  }

  private dispatchBrowserEvent(name: string, args: any, result: any): void {
    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') {
      return;
    }

    const detail = { name, args, result };
    try {
      window.dispatchEvent(new CustomEvent('aiToolCall', { detail }));
    } catch {
      // Ignore dispatch errors (e.g., CustomEvent not available)
    }
  }
}

export const toolRegistry = new ToolRegistry();
export const ToolExecutor = new RuntimeToolExecutor(toolRegistry);

export function toOpenAITools(tools: ToolDefinition[]): any[] {
  return tools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

export function toAnthropicTools(tools: ToolDefinition[]): any[] {
  return tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  }));
}
