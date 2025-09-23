export interface AgentParameter {
  type: 'text' | 'string' | 'select' | 'number' | 'boolean';
  description?: string;
  default?: any;
  required?: boolean;
  options?: string[] | number[]; // For select type
  min?: number; // For number type
  max?: number; // For number type
}

export interface AgentMetadata {
  name: string;
  description: string;
  version?: string;
  author?: string;
  tags?: string[];
  tools?: string[];
  parameters?: Record<string, AgentParameter>;
  origin?: 'user' | 'extension' | 'builtin';
  extensionId?: string;
}

export interface Agent {
  id: string; // Unique identifier (file path or extension:name)
  path?: string; // File path if file-based
  metadata: AgentMetadata;
  content: string; // The actual agent instructions
  lastModified?: Date;
}

export interface AgentExecutionOptions {
  agentId: string;
  parameters?: Record<string, any>;
  documentContext?: string;
  sessionId?: string;
}

export interface AgentExecutionResult {
  success: boolean;
  sessionId: string;
  error?: string;
  outputs?: any;
}

export interface AgentRegistryOptions {
  workspacePath?: string;
  watchForChanges?: boolean;
}