/**
 * Git Status Tool
 *
 * MCP tool that provides git status information.
 */

import { getGitStatus } from '../utils/gitOperations';

/**
 * AI tool definition for git_status
 */
export const gitStatusTool = {
  name: 'git_status',
  description: `Get git status for the current workspace.

Returns information about:
- Current branch
- Commits ahead/behind remote
- Whether there are uncommitted changes
- For worktrees: base branch and merge status

This is useful before proposing a commit to understand what has changed.`,
  scope: 'global' as const,
  parameters: {
    type: 'object' as const,
    properties: {},
    required: [],
  },
  handler: async (
    _params: Record<string, never>,
    context: { workspacePath?: string }
  ): Promise<{ success: boolean; message?: string; data?: unknown; error?: string }> => {
    if (!context.workspacePath) {
      return {
        success: false,
        error: 'No workspace path available. Cannot get git status.',
      };
    }

    try {
      const status = await getGitStatus(context.workspacePath);

      return {
        success: true,
        message: `On branch ${status.branch}. ${status.hasUncommitted ? 'Has uncommitted changes' : 'Working tree clean'}.`,
        data: status,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to get git status: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};
