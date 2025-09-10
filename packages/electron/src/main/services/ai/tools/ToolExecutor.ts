/**
 * ToolExecutor - Handles execution of tools with proper IPC communication
 */

import { WebContents, ipcMain } from 'electron';
import { EventEmitter } from 'events';
import { DiffArgs, DiffResult, ToolDefinition } from '../types';
import { toolRegistry } from './ToolRegistry';

export class ToolExecutor extends EventEmitter {
  private webContents: WebContents;
  private pendingExecutions: Map<string, {
    resolve: (value: any) => void;
    reject: (error: any) => void;
    timeout: NodeJS.Timeout;
  }> = new Map();
  
  constructor(webContents: WebContents) {
    super();
    this.webContents = webContents;
    this.setupHandlers();
  }
  
  private setupHandlers(): void {
    // Clean up any existing handlers to avoid duplicates
    ipcMain.removeAllListeners('tool:execution:result');
  }
  
  /**
   * Execute applyDiff tool
   */
  async applyDiff(args: DiffArgs): Promise<DiffResult> {
    const resultChannel = `applyDiff-result-${Date.now()}`;
    
    return new Promise((resolve, reject) => {
      // Set up timeout
      const timeout = setTimeout(() => {
        ipcMain.removeAllListeners(resultChannel);
        reject(new Error('applyDiff execution timed out'));
      }, 30000);
      
      // Set up one-time listener for result
      ipcMain.once(resultChannel, (event, result: DiffResult) => {
        clearTimeout(timeout);
        resolve(result);
      });
      
      // Send to renderer
      this.webContents.send('ai:applyDiff', {
        replacements: args.replacements,
        resultChannel
      });
    });
  }
  
  /**
   * Execute streamContent tool
   */
  async streamContent(args: {
    content: string;
    position?: string;
    insertAfter?: string;
    mode?: string;
  }): Promise<void> {
    const streamId = `stream-${Date.now()}`;
    
    // Start streaming - let the AI specify insertAfter with actual content
    this.webContents.send('ai:streamEditStart', {
      id: streamId,
      position: args.position || (args.insertAfter ? undefined : 'cursor'),
      insertAfter: args.insertAfter,
      mode: args.mode || 'append',
      insertAtEnd: false
    });
    
    // Stream content in chunks
    const chunkSize = 50;
    const content = args.content;
    
    for (let i = 0; i < content.length; i += chunkSize) {
      const chunk = content.slice(i, Math.min(i + chunkSize, content.length));
      this.webContents.send('ai:streamEditContent', chunk);
      
      // Small delay between chunks for smooth streaming
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    // End streaming
    this.webContents.send('ai:streamEditEnd', { id: streamId });
  }
  
  /**
   * Execute any registered tool
   */
  async executeTool(name: string, args: any): Promise<any> {
    const tool = toolRegistry.get(name);
    if (!tool) {
      throw new Error(`Tool ${name} not found`);
    }
    
    // Handle built-in tools
    switch (name) {
      case 'applyDiff':
        return await this.applyDiff(args);
      case 'streamContent':
        return await this.streamContent(args);
      default:
        // Execute custom tool
        return await this.executeCustomTool(tool, args);
    }
  }
  
  /**
   * Execute a custom/renderer tool
   */
  private async executeCustomTool(tool: ToolDefinition, args: any): Promise<any> {
    const correlationId = `tool-${tool.name}-${Date.now()}`;
    
    return new Promise((resolve, reject) => {
      // Set up timeout
      const timeout = setTimeout(() => {
        this.pendingExecutions.delete(correlationId);
        reject(new Error(`Tool ${tool.name} execution timed out`));
      }, 30000);
      
      // Store pending execution
      this.pendingExecutions.set(correlationId, {
        resolve,
        reject,
        timeout
      });
      
      // Send execution request to renderer
      this.webContents.send('ai:executeTool', {
        toolName: tool.name,
        args,
        correlationId
      });
    });
  }
  
  /**
   * Handle tool execution result from renderer
   */
  handleToolResult(correlationId: string, result: any, error?: string): void {
    const pending = this.pendingExecutions.get(correlationId);
    if (!pending) return;
    
    clearTimeout(pending.timeout);
    this.pendingExecutions.delete(correlationId);
    
    if (error) {
      pending.reject(new Error(error));
    } else {
      pending.resolve(result);
    }
  }
  
  /**
   * Clean up resources
   */
  destroy(): void {
    // Clear all pending executions
    for (const [id, pending] of this.pendingExecutions) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('ToolExecutor destroyed'));
    }
    this.pendingExecutions.clear();
    this.removeAllListeners();
  }
}