// Type declarations for optional dependencies that are dynamically loaded

declare module '@anthropic-ai/claude-agent-sdk' {
  export function query(params: { prompt: string | AsyncIterable<any>; options?: any }): AsyncGenerator<any, void>;
  export function tool(name: string, description: string, inputSchema: any, handler: any): any;
  export function createSdkMcpServer(options: any): any;
  export class AbortError extends Error {}
  export type Options = any;
  export type SDKMessage = any;
  export type SDKUserMessage = any;
  export type SDKAssistantMessage = any;
  export type McpServerConfig = any;
  export type McpSdkServerConfigWithInstance = any;
  export type SlashCommand = any;
  export type ModelInfo = any;
  export type AccountInfo = any;
  export type AgentDefinition = any;
}

declare module '@modelcontextprotocol/sdk/server/index.js' {
  export class Server {
    constructor(options: any);
    setRequestHandler(method: string, handler: any): void;
    connect(transport: any): Promise<void>;
  }
}

declare module '@modelcontextprotocol/sdk/server/stdio.js' {
  export class StdioServerTransport {
    constructor();
  }
}

declare module '@modelcontextprotocol/sdk/types.js' {
  export type CallToolRequestSchema = any;
  export type ListToolsRequestSchema = any;
  export type Tool = any;
}
