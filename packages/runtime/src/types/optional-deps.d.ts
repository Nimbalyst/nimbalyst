// Type declarations for optional dependencies that are dynamically loaded

declare module '@anthropic-ai/claude-agent-sdk' {
  export const Client: any;
  export type ClientOptions = any;
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
