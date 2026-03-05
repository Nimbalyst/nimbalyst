/**
 * Tool policy constants for Claude Code provider.
 *
 * Keeping these lists centralized avoids burying policy data inside
 * large control-flow methods.
 */
export const DEFAULT_PLANNING_TOOLS: readonly string[] = [
  'Read', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep', 'LS',
  'WebFetch', 'WebSearch',
  'TodoRead', 'Task', 'Agent',
  'ExitPlanMode', 'EnterPlanMode'
];

export const INTERNAL_MCP_TOOLS: readonly string[] = [
  'mcp__nimbalyst-session-naming__update_session_meta',
  'mcp__nimbalyst-mcp__capture_editor_screenshot',
  'mcp__nimbalyst-mcp__display_to_user',
  'mcp__nimbalyst-mcp__voice_agent_speak',
  'mcp__nimbalyst-mcp__voice_agent_stop',
  'mcp__nimbalyst-mcp__get_session_edited_files',
  'mcp__nimbalyst-mcp__developer_git_commit_proposal',
  'mcp__nimbalyst-mcp__developer_git_log',
  'mcp__nimbalyst-session-context__get_session_summary',
  'mcp__nimbalyst-session-context__get_workstream_overview',
  'mcp__nimbalyst-session-context__list_recent_sessions',
  'mcp__nimbalyst-session-context__get_workstream_edited_files',
];

export const TEAM_TOOLS: readonly string[] = [
  'SendMessage',
  'TaskCreate',
  'TaskList',
  'TaskUpdate',
  'TaskGet',
  'TeamCreate',
  'TeamDelete',
  'TeammateTool',
  'TodoRead',
  'TodoWrite',
];
