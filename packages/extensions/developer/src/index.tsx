/**
 * Developer Extension
 *
 * Provides git operations and developer workflows through AI-accessible MCP tools.
 */

import { gitCommitProposalTool } from './mcp/gitCommitProposalTool';
import { gitStatusTool } from './mcp/gitStatusTool';
import { gitLogTool } from './mcp/gitLogTool';

// Export types for consumers
export type { GitStatus, GitCommit, SessionFileEdit, CommitProposal } from './types';

/**
 * Extension activation
 * Called when the extension is loaded
 */
export async function activate() {
  console.log('[Developer] Extension activated');
}

/**
 * Extension deactivation
 * Called when the extension is unloaded
 */
export async function deactivate() {
  console.log('[Developer] Extension deactivated');
}

/**
 * AI tools exported by this extension
 * These enable the coding agent to perform git operations through conversation.
 */
export const aiTools = [gitCommitProposalTool, gitStatusTool, gitLogTool];
