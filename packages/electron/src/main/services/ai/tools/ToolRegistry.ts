import { EventEmitter } from 'events';
import { ipcMain } from 'electron';
import type { ToolDefinition } from '@stravu/runtime/ai/server/types';
import {
  ToolRegistry as RuntimeToolRegistry,
  toolRegistry as runtimeToolRegistry,
} from '@stravu/runtime/ai/tools';
import {AnalyticsService} from "../../analytics/AnalyticsService.ts";

let bridgeInitialized = false;

function setupRendererToolBridge(registry: ToolRegistry): void {
  if (bridgeInitialized) return;
  bridgeInitialized = true;

  ipcMain.handle('ai:registerTool', (_event, tool: ToolDefinition) => {
    tool.source = 'renderer';
    registry.register(tool);
    return { success: true };
  });

  ipcMain.handle('ai:unregisterTool', (_event, toolName: string) => {
    registry.unregister(toolName);
    return { success: true };
  });
}

export class ToolRegistry extends EventEmitter {
  private correlationCounter = 0;
  private readonly analytics = AnalyticsService.getInstance();

  constructor(private readonly registry: RuntimeToolRegistry) {
    super();
    setupRendererToolBridge(this);
  }

  register(tool: ToolDefinition): void {
    this.analytics.sendEvent('register_tool')
    this.registry.register(tool);
    this.emit('tool:registered', tool);
  }

  registerMany(tools: ToolDefinition[]): void {
    tools.forEach(tool => this.register(tool));
  }

  unregister(toolName: string): void {
    this.analytics.sendEvent('unregister_tool')
    const existing = this.registry.get(toolName);
    if (existing) {
      this.registry.unregister(toolName);
      this.emit('tool:unregistered', existing);
    }
  }

  get(name: string): ToolDefinition | undefined {
    return this.registry.get(name);
  }

  has(name: string): boolean {
    return this.registry.has(name);
  }

  getAll(): ToolDefinition[] {
    return this.registry.getAll();
  }

  clear(): void {
    this.registry.clear();
  }

  toOpenAIFormat(): any[] {
    return this.registry.toOpenAI();
  }

  toAnthropicFormat(): any[] {
    return this.registry.toAnthropic();
  }

  generateCorrelationId(toolName: string): string {
    return `${toolName}-${Date.now()}-${++this.correlationCounter}`;
  }
}

export const toolRegistry = new ToolRegistry(runtimeToolRegistry);
