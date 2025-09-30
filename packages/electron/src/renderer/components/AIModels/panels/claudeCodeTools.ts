/**
 * Claude Code built-in tools
 * Based on: https://gist.github.com/wong2/e0f34aac66caf890a332f7b6f9e2ba8f
 */

export interface ClaudeCodeTool {
  name: string;
  description: string;
  category: 'file' | 'search' | 'web' | 'task' | 'notebook' | 'system';
}

export const CLAUDE_CODE_TOOLS: ClaudeCodeTool[] = [
  // File operations
  {
    name: 'Read',
    description: 'Read file contents',
    category: 'file'
  },
  {
    name: 'Write',
    description: 'Write new files',
    category: 'file'
  },
  {
    name: 'Edit',
    description: 'Edit existing files',
    category: 'file'
  },
  {
    name: 'MultiEdit',
    description: 'Edit multiple files at once',
    category: 'file'
  },

  // Search operations
  {
    name: 'Glob',
    description: 'Find files by pattern',
    category: 'search'
  },
  {
    name: 'Grep',
    description: 'Search file contents',
    category: 'search'
  },
  {
    name: 'LS',
    description: 'List directory contents',
    category: 'search'
  },

  // Web operations
  {
    name: 'WebFetch',
    description: 'Fetch web content',
    category: 'web'
  },
  {
    name: 'WebSearch',
    description: 'Search the web',
    category: 'web'
  },

  // Task management
  {
    name: 'TodoRead',
    description: 'Read todo list',
    category: 'task'
  },
  {
    name: 'TodoWrite',
    description: 'Write to todo list',
    category: 'task'
  },
  {
    name: 'Task',
    description: 'Create subtasks for parallel work',
    category: 'task'
  },

  // Notebook operations
  {
    name: 'NotebookRead',
    description: 'Read Jupyter notebooks',
    category: 'notebook'
  },
  {
    name: 'NotebookEdit',
    description: 'Edit Jupyter notebooks',
    category: 'notebook'
  },

  // System operations
  {
    name: 'Bash',
    description: 'Execute shell commands',
    category: 'system'
  },
  {
    name: 'ExitPlanMode',
    description: 'Exit planning mode',
    category: 'system'
  }
];

export const TOOL_CATEGORIES = [
  { id: 'file', name: 'File Operations', description: 'Read, write, and edit files' },
  { id: 'search', name: 'Search & Navigation', description: 'Find files and search contents' },
  { id: 'web', name: 'Web Access', description: 'Fetch and search web content' },
  { id: 'task', name: 'Task Management', description: 'Manage todos and subtasks' },
  { id: 'notebook', name: 'Jupyter Notebooks', description: 'Work with notebook files' },
  { id: 'system', name: 'System Operations', description: 'Execute commands and system tasks' }
] as const;

/**
 * Get default allowed tools
 * Default: Read, Search & Navigation (all), Web Access (all), Task Management (all), ExitPlanMode
 */
export function getDefaultAllowedTools(): string[] {
  return [
    // File operations - only Read
    'Read',

    // Search & Navigation - all
    'Glob',
    'Grep',
    'LS',

    // Web Access - all
    'WebFetch',
    'WebSearch',

    // Task Management - all
    'TodoRead',
    'TodoWrite',
    'Task',

    // System operations - only ExitPlanMode
    'ExitPlanMode'
  ];
}

/**
 * Check if all tools are allowed
 */
export function isAllToolsAllowed(allowedTools?: string[]): boolean {
  if (!allowedTools || allowedTools.length === 0) {
    return false;
  }

  // Check if all tools are selected
  const allToolNames = CLAUDE_CODE_TOOLS.map(t => t.name);
  return allToolNames.every(name => allowedTools.includes(name));
}

/**
 * Get tool names by category
 */
export function getToolsByCategory(category: string): ClaudeCodeTool[] {
  return CLAUDE_CODE_TOOLS.filter(tool => tool.category === category);
}
