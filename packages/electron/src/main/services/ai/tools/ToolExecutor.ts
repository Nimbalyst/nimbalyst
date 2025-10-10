/**
 * ToolExecutor - Handles execution of tools with proper IPC communication
 */

import { WebContents, ipcMain } from 'electron';
import { EventEmitter } from 'events';
import type { DiffArgs, DiffResult, ToolDefinition } from '@stravu/runtime/ai/server/types';
import { toolRegistry } from './ToolRegistry';
import { logger } from '../../../utils/logger';

const LOG_PREVIEW_LENGTH = 400;

function previewForLog(value?: string, max: number = LOG_PREVIEW_LENGTH): string {
  if (!value) return '';
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

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
  async applyDiff(args: DiffArgs & { targetFilePath?: string }): Promise<DiffResult> {
    const resultChannel = `applyDiff-result-${Date.now()}`;
    const replacementCount = Array.isArray(args?.replacements) ? args.replacements.length : undefined;
    logger.ai.info('[ToolExecutor] applyDiff invoked', {
      replacements: replacementCount,
      targetFilePath: args.targetFilePath,
      preview: previewForLog(JSON.stringify(args ?? {}))
    });
    if (replacementCount === undefined || replacementCount === 0) {
      logger.ai.warn('[ToolExecutor] applyDiff called without replacements');
    }

    return new Promise((resolve, reject) => {
      // Set up timeout
      const timeout = setTimeout(() => {
        ipcMain.removeAllListeners(resultChannel);
        logger.ai.error('[ToolExecutor] applyDiff timed out');
        reject(new Error('applyDiff execution timed out'));
      }, 30000);

      // Set up one-time listener for result
      ipcMain.once(resultChannel, (event, result: DiffResult) => {
        clearTimeout(timeout);
        logger.ai.info('[ToolExecutor] applyDiff result received', result);
        resolve(result);
      });

      // Send to renderer with explicit targetFilePath
      console.log(`[ToolExecutor] Sending applyDiff to renderer with targetFilePath:`, args.targetFilePath);
      this.webContents.send('ai:applyDiff', {
        replacements: args.replacements,
        resultChannel,
        targetFilePath: args.targetFilePath
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
   * Execute getDocumentContent tool
   */
  async getDocumentContent(args: any): Promise<{ content: string }> {
    const resultChannel = `getDocumentContent-result-${Date.now()}`;
    logger.ai.info('[ToolExecutor] getDocumentContent invoked');

    return new Promise((resolve, reject) => {
      // Set up timeout
      const timeout = setTimeout(() => {
        ipcMain.removeAllListeners(resultChannel);
        logger.ai.error('[ToolExecutor] getDocumentContent timed out');
        reject(new Error('getDocumentContent execution timed out'));
      }, 5000);

      // Set up one-time listener for result
      ipcMain.once(resultChannel, (event, result: { content: string }) => {
        clearTimeout(timeout);
        logger.ai.info('[ToolExecutor] getDocumentContent result received', {
          contentLength: result?.content?.length || 0
        });
        resolve(result);
      });

      // Send to renderer
      this.webContents.send('ai:getDocumentContent', {
        resultChannel
      });
    });
  }

  /**
   * Execute updateFrontmatter tool
   */
  async updateFrontmatter(args: { updates: Record<string, any> }): Promise<DiffResult> {
    const resultChannel = `updateFrontmatter-result-${Date.now()}`;
    logger.ai.info('[ToolExecutor] updateFrontmatter invoked', {
      updates: args?.updates
    });

    return new Promise((resolve, reject) => {
      // Set up timeout
      const timeout = setTimeout(() => {
        ipcMain.removeAllListeners(resultChannel);
        logger.ai.error('[ToolExecutor] updateFrontmatter timed out');
        reject(new Error('updateFrontmatter execution timed out'));
      }, 30000);

      // Set up one-time listener for result
      ipcMain.once(resultChannel, (event, result: DiffResult) => {
        clearTimeout(timeout);
        logger.ai.info('[ToolExecutor] updateFrontmatter result received', result);
        resolve(result);
      });

      // Send to renderer
      this.webContents.send('ai:updateFrontmatter', {
        updates: args.updates,
        resultChannel
      });
    });
  }

  /**
   * Execute createDocument tool
   */
  async createDocument(args: { filePath: string; initialContent?: string; switchToFile?: boolean }): Promise<any> {
    const resultChannel = `createDocument-result-${Date.now()}`;
    logger.ai.info('[ToolExecutor] createDocument invoked', {
      filePath: args?.filePath,
      hasContent: !!args?.initialContent,
      switchToFile: args?.switchToFile !== false
    });

    return new Promise((resolve, reject) => {
      // Set up timeout
      const timeout = setTimeout(() => {
        ipcMain.removeAllListeners(resultChannel);
        logger.ai.error('[ToolExecutor] createDocument timed out');
        reject(new Error('Tool createDocument execution timed out'));
      }, 10000);

      // Set up one-time listener for result
      ipcMain.once(resultChannel, (event, result: any) => {
        clearTimeout(timeout);
        logger.ai.info('[ToolExecutor] createDocument result received', result);
        resolve(result);
      });

      // Send to renderer
      this.webContents.send('ai:createDocument', {
        filePath: args.filePath,
        initialContent: args.initialContent,
        switchToFile: args.switchToFile !== false,
        resultChannel
      });
    });
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
      case 'getDocumentContent':
        return await this.getDocumentContent(args);
      case 'updateFrontmatter':
        return await this.updateFrontmatter(args);
      case 'createDocument':
        return await this.createDocument(args);
      default:
        // Check if tool has a handler (e.g., file tools)
        if (typeof tool.handler === 'function') {
          logger.ai.info(`[ToolExecutor] Executing tool with handler: ${name}`);
          try {
            return await tool.handler(args);
          } catch (error) {
            logger.ai.error(`[ToolExecutor] Tool ${name} execution failed:`, error);
            throw error;
          }
        }
        // Execute custom/renderer tool
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
