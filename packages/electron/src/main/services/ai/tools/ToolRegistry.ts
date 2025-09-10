/**
 * ToolRegistry - Manages dynamic tool registration and execution
 */

import { EventEmitter } from 'events';
import { ToolDefinition } from '../types';
import { ipcMain, WebContents } from 'electron';

export class ToolRegistry extends EventEmitter {
  private tools: Map<string, ToolDefinition> = new Map();
  private correlationCounter = 0;
  
  constructor() {
    super();
    this.registerBuiltInTools();
    this.setupRendererToolBridge();
  }
  
  /**
   * Register built-in tools that all providers should have
   */
  private registerBuiltInTools(): void {
    // Document editing tool
    this.register({
      name: 'applyDiff',
      description: 'Apply text replacements to the current document. REQUIRED for adding rows to tables - replace the entire table.',
      parameters: {
        type: 'object',
        properties: {
          replacements: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                oldText: { type: 'string', description: 'Text to replace (for tables: the COMPLETE existing table including all rows)' },
                newText: { type: 'string', description: 'Replacement text (for tables: the COMPLETE updated table with new rows added)' }
              },
              required: ['oldText', 'newText']
            }
          }
        },
        required: ['replacements']
      },
      source: 'main'
    });
    
    // Content streaming tool
    this.register({
      name: 'streamContent',
      description: 'Stream new content to the editor. For tables: set insertAfter to the COMPLETE table, content to ONLY the new rows.',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'The content to stream (for tables: ONLY the new rows like "| Cell1 | Cell2 |")' },
          position: {
            type: 'string',
            enum: ['cursor', 'end', 'after-selection'],
            description: 'Where to insert the content'
          },
          insertAfter: { type: 'string', description: 'Text to insert after (for tables: the COMPLETE table including all rows)' },
          mode: {
            type: 'string',
            enum: ['append', 'replace', 'insert'],
            description: 'How to handle the content'
          }
        },
        required: ['content']
      },
      source: 'main'
    });
  }
  
  /**
   * Set up IPC bridge for renderer-side tools
   */
  private setupRendererToolBridge(): void {
    // Listen for tool registration from renderer
    ipcMain.handle('ai:registerTool', (event, tool: ToolDefinition) => {
      // Mark as renderer tool and register
      tool.source = 'renderer';
      this.register(tool);
      return { success: true };
    });
    
    // Listen for tool unregistration
    ipcMain.handle('ai:unregisterTool', (event, toolName: string) => {
      this.unregister(toolName);
      return { success: true };
    });
  }
  
  /**
   * Register a tool
   */
  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
    this.emit('tool:registered', tool);
  }
  
  /**
   * Unregister a tool
   */
  unregister(toolName: string): void {
    const tool = this.tools.get(toolName);
    if (tool) {
      this.tools.delete(toolName);
      this.emit('tool:unregistered', tool);
    }
  }
  
  /**
   * Get all registered tools
   */
  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }
  
  /**
   * Get a specific tool
   */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }
  
  /**
   * Check if a tool exists
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }
  
  /**
   * Execute a tool with correlation tracking
   */
  async execute(
    name: string, 
    args: any, 
    webContents?: WebContents
  ): Promise<any> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool ${name} not found`);
    }
    
    const correlationId = this.generateCorrelationId(name);
    
    // Emit start event
    this.emit('execution:start', {
      correlationId,
      toolName: name,
      args,
      source: tool.source
    });
    
    try {
      let result: any;
      
      if (tool.source === 'renderer' && webContents) {
        // Execute in renderer process
        result = await this.executeInRenderer(name, args, webContents, correlationId);
      } else if (tool.handler) {
        // Execute with provided handler
        result = await tool.handler(args);
      } else {
        // Forward to provider-specific handler
        throw new Error(`No handler for tool ${name}`);
      }
      
      // Emit completion event
      this.emit('execution:complete', {
        correlationId,
        toolName: name,
        result
      });
      
      return result;
    } catch (error) {
      // Emit error event
      this.emit('execution:error', {
        correlationId,
        toolName: name,
        error
      });
      throw error;
    }
  }
  
  /**
   * Execute a tool in the renderer process
   */
  private async executeInRenderer(
    name: string,
    args: any,
    webContents: WebContents,
    correlationId: string
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const responseChannel = `tool:response:${correlationId}`;
      
      // Set up one-time listener for response
      ipcMain.once(responseChannel, (event, result) => {
        if (result.error) {
          reject(new Error(result.error));
        } else {
          resolve(result.data);
        }
      });
      
      // Send tool execution request to renderer
      webContents.send('ai:executeTool', {
        toolName: name,
        args,
        correlationId,
        responseChannel
      });
      
      // Timeout after 30 seconds
      setTimeout(() => {
        ipcMain.removeAllListeners(responseChannel);
        reject(new Error(`Tool ${name} execution timed out`));
      }, 30000);
    });
  }
  
  /**
   * Generate a correlation ID for tracking
   */
  private generateCorrelationId(toolName: string): string {
    return `${toolName}-${Date.now()}-${++this.correlationCounter}`;
  }
  
  /**
   * Convert tools to Anthropic format
   */
  toAnthropicFormat(): any[] {
    return this.getAll().map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters
    }));
  }
  
  /**
   * Convert tools to OpenAI format
   */
  toOpenAIFormat(): any[] {
    return this.getAll().map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }
    }));
  }
  
  /**
   * Clean up
   */
  destroy(): void {
    this.tools.clear();
    this.removeAllListeners();
  }
}

// Singleton instance
export const toolRegistry = new ToolRegistry();