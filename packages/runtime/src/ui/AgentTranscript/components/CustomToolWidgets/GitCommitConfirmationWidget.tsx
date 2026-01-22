/**
 * GitCommitConfirmationWidget
 *
 * Custom tool widget that renders when AI calls git_commit_proposal.
 * Shows the proposed commit with file selection and message editing.
 *
 * The widget has two modes:
 * 1. Interactive mode: When the tool is pending (no result yet), user can edit and confirm
 * 2. Display mode: When tool has completed, shows the result (committed/cancelled)
 *
 * The tool waits for user confirmation before returning to Claude, so:
 * - tool.result being undefined/null means the proposal is pending
 * - tool.result containing "committed" means user confirmed
 * - tool.result containing "cancelled" means user cancelled
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { MaterialSymbol } from '../../../..';
import type { CustomToolWidgetProps } from './index';
import './GitCommitConfirmationWidget.css';

// ============================================================
// Pending Proposals Store
// ============================================================
// Store pending proposals sent via IPC. The widget looks up its proposal
// by matching the arguments (filesToStage, commitMessage).

interface PendingProposal {
  proposalId: string;
  workspacePath: string;
  filesToStage: string[];
  commitMessage: string;
  reasoning?: string;
  timestamp: number;
}

const pendingProposals = new Map<string, PendingProposal>();

// Track proposals that have been responded to (cancelled or committed)
// This persists in memory to handle the timing gap between response and tool result
// Maps proposal key to the response type ('committed' | 'cancelled')
const respondedProposals = new Map<string, { type: 'committed' | 'cancelled'; commitHash?: string }>();

/**
 * Generate a key for matching proposals based on content.
 */
function generateProposalKey(filesToStage: string[], commitMessage: string): string {
  const filesKey = [...filesToStage].sort().join('|');
  return `${filesKey}::${commitMessage.trim().slice(0, 100)}`;
}

/**
 * Register a pending proposal from IPC.
 * Called by the renderer when it receives mcp:gitCommitProposal.
 */
export function registerPendingProposal(proposal: PendingProposal): void {
  const key = generateProposalKey(proposal.filesToStage, proposal.commitMessage);
  pendingProposals.set(key, proposal);
  console.log('[GitCommitWidget] Registered pending proposal:', proposal.proposalId, key);
}

/**
 * Remove a pending proposal after it's been acted upon.
 * Also marks the key as responded with the response type to handle component re-renders.
 */
export function removePendingProposal(
  filesToStage: string[],
  commitMessage: string,
  responseType: 'committed' | 'cancelled' = 'cancelled',
  commitHash?: string
): void {
  const key = generateProposalKey(filesToStage, commitMessage);
  pendingProposals.delete(key);
  respondedProposals.set(key, { type: responseType, commitHash });
  console.log('[GitCommitWidget] Removed pending proposal and marked as responded:', key, responseType);
}

/**
 * Get the response for a proposal that has already been responded to.
 */
function getProposalResponse(filesToStage: string[], commitMessage: string): { type: 'committed' | 'cancelled'; commitHash?: string } | undefined {
  const key = generateProposalKey(filesToStage, commitMessage);
  return respondedProposals.get(key);
}

/**
 * Get pending proposal matching the given arguments.
 */
function getPendingProposal(filesToStage: string[], commitMessage: string): PendingProposal | undefined {
  const key = generateProposalKey(filesToStage, commitMessage);
  return pendingProposals.get(key);
}

// ============================================================
// Directory Tree Types and Helpers
// ============================================================

interface DirectoryNode {
  path: string;
  displayPath: string;
  files: string[];
  subdirectories: Map<string, DirectoryNode>;
  fileCount: number;
}

/**
 * Build a directory tree from a flat list of file paths.
 * Collapses single-child directories (e.g., packages/electron/src becomes one node).
 */
function buildDirectoryTree(filePaths: string[]): DirectoryNode {
  const root: DirectoryNode = {
    path: '',
    displayPath: '',
    files: [],
    subdirectories: new Map(),
    fileCount: 0
  };

  filePaths.forEach(filePath => {
    const parts = filePath.split('/');

    // If file is at root level (no directory)
    if (parts.length === 1) {
      root.files.push(filePath);
      root.fileCount++;
      return;
    }

    // Build directory tree
    let currentNode = root;
    const dirParts = parts.slice(0, -1);

    dirParts.forEach((part, index) => {
      const pathSoFar = dirParts.slice(0, index + 1).join('/');

      if (!currentNode.subdirectories.has(part)) {
        currentNode.subdirectories.set(part, {
          path: pathSoFar,
          displayPath: part,
          files: [],
          subdirectories: new Map(),
          fileCount: 0
        });
      }

      currentNode = currentNode.subdirectories.get(part)!;
    });

    currentNode.files.push(filePath);
    currentNode.fileCount++;
  });

  // Update file counts up the tree
  const updateCounts = (node: DirectoryNode): number => {
    let count = node.files.length;
    node.subdirectories.forEach(subdir => {
      count += updateCounts(subdir);
    });
    node.fileCount = count;
    return count;
  };
  updateCounts(root);

  return collapseDirectoryTree(root);
}

/**
 * Collapse single-child directory paths (e.g., packages/electron/src -> packages/electron/src)
 */
function collapseDirectoryTree(node: DirectoryNode): DirectoryNode {
  // First, recursively collapse all subdirectories
  node.subdirectories.forEach((subdir, key) => {
    node.subdirectories.set(key, collapseDirectoryTree(subdir));
  });

  // If this node has exactly one subdirectory and no files, collapse it
  if (node.subdirectories.size === 1 && node.files.length === 0) {
    const [, childNode] = Array.from(node.subdirectories.entries())[0];

    // Merge the paths
    const newDisplayPath = node.displayPath
      ? `${node.displayPath}/${childNode.displayPath}`
      : childNode.displayPath;

    return {
      ...childNode,
      displayPath: newDisplayPath
    };
  }

  return node;
}

/**
 * Get all folder paths in a tree (for expand all functionality)
 */
function getAllFolderPaths(node: DirectoryNode, paths: string[] = []): string[] {
  if (node.path) {
    paths.push(node.path);
  }
  node.subdirectories.forEach(subdir => {
    getAllFolderPaths(subdir, paths);
  });
  return paths;
}

// ============================================================
// Widget Component
// ============================================================

export const GitCommitConfirmationWidget: React.FC<CustomToolWidgetProps> = ({
  message,
  workspacePath,
}) => {
  // Extract data from tool call
  const toolCall = message.toolCall;
  if (!toolCall) {
    return null;
  }

  // Get data from arguments (the tool input)
  const args = toolCall.arguments as any;
  if (!args) {
    return null;
  }

  const initialFilesToStage: string[] = args.filesToStage || [];
  const initialCommitMessage: string = args.commitMessage || '';
  const reasoning: string = args.reasoning || '';
  const commitWorkspacePath = workspacePath;

  // Parse the tool result to determine completion state
  const toolResult = toolCall.result;
  const isCompleted = toolResult !== undefined && toolResult !== null && toolResult !== '';

  // Parse completed state from result
  const completedState = useMemo(() => {
    if (!isCompleted || typeof toolResult !== 'string') return null;

    const resultLower = toolResult.toLowerCase();
    if (resultLower.includes('committed') || resultLower.includes('commit hash')) {
      // Extract commit hash if present
      const hashMatch = toolResult.match(/commit hash[:\s]+([a-f0-9]+)/i);
      return {
        type: 'committed' as const,
        commitHash: hashMatch?.[1],
      };
    } else if (resultLower.includes('cancelled') || resultLower.includes('canceled')) {
      return { type: 'cancelled' as const };
    } else if (resultLower.includes('failed') || resultLower.includes('error')) {
      return { type: 'error' as const, error: toolResult };
    }
    return null;
  }, [isCompleted, toolResult]);

  // Look up pending proposal to get the proposalId for sending response
  // Re-check on every render to detect when proposal is removed
  const pendingProposal = getPendingProposal(initialFilesToStage, initialCommitMessage);

  // Check if we've already responded to this proposal (persists in module-level Map)
  const previousResponse = getProposalResponse(initialFilesToStage, initialCommitMessage);
  const alreadyResponded = !!previousResponse;

  // Local state for editing
  const [filesToStage, setFilesToStage] = useState<Set<string>>(new Set(initialFilesToStage));
  const [commitMessage, setCommitMessage] = useState(initialCommitMessage);
  const [isCommitting, setIsCommitting] = useState(false);
  const [hasResponded, setHasResponded] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [localResult, setLocalResult] = useState<{
    success: boolean;
    commitHash?: string;
    error?: string;
  } | null>(null);

  // Build directory tree from files
  const directoryTree = useMemo(() => {
    return buildDirectoryTree(initialFilesToStage);
  }, [initialFilesToStage]);

  // Auto-expand all folders on mount
  useEffect(() => {
    const allPaths = getAllFolderPaths(directoryTree);
    setExpandedFolders(new Set(allPaths));
  }, [directoryTree]);

  // Determine which result to show (local takes precedence while waiting for tool to complete)
  const displayResult = localResult || (completedState ? {
    success: completedState.type === 'committed',
    commitHash: completedState.type === 'committed' ? completedState.commitHash : undefined,
    error: completedState.type === 'cancelled' ? 'Cancelled' :
           completedState.type === 'error' ? completedState.error : undefined,
  } : null);

  const toggleFile = useCallback((filePath: string) => {
    setFilesToStage((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      return next;
    });
  }, []);

  const toggleFolder = useCallback((folderPath: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderPath)) {
        next.delete(folderPath);
      } else {
        next.add(folderPath);
      }
      return next;
    });
  }, []);

  // Get all files in a directory node (recursively)
  const getFilesInNode = useCallback((node: DirectoryNode): string[] => {
    let files = [...node.files];
    node.subdirectories.forEach(subdir => {
      files = files.concat(getFilesInNode(subdir));
    });
    return files;
  }, []);

  // Toggle all files in a directory
  const toggleDirectoryFiles = useCallback((node: DirectoryNode) => {
    const filesInDir = getFilesInNode(node);
    const allSelected = filesInDir.every(f => filesToStage.has(f));

    setFilesToStage((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        // Deselect all
        filesInDir.forEach(f => next.delete(f));
      } else {
        // Select all
        filesInDir.forEach(f => next.add(f));
      }
      return next;
    });
  }, [filesToStage, getFilesInNode]);

  // Render a single file item
  const renderFile = (filePath: string) => {
    const isSelected = filesToStage.has(filePath);
    const fileName = filePath.split('/').pop() || filePath;
    return (
      <div
        key={filePath}
        className={`git-commit-widget__file ${isSelected ? 'git-commit-widget__file--selected' : ''}`}
        onClick={() => toggleFile(filePath)}
      >
        <div className={`git-commit-widget__file-checkbox ${isSelected ? 'git-commit-widget__file-checkbox--checked' : ''}`}>
          {isSelected && <MaterialSymbol icon="check" size={12} />}
        </div>
        <span className="git-commit-widget__file-name">{fileName}</span>
      </div>
    );
  };

  // Render a directory node recursively
  const renderDirectoryNode = (node: DirectoryNode): React.ReactNode => {
    const isExpanded = expandedFolders.has(node.path);
    const hasContent = node.files.length > 0 || node.subdirectories.size > 0;
    const filesInDir = getFilesInNode(node);
    const selectedCount = filesInDir.filter(f => filesToStage.has(f)).length;
    const allSelected = selectedCount === filesInDir.length;
    const someSelected = selectedCount > 0 && !allSelected;

    // Root node - just render children
    if (!node.displayPath) {
      return (
        <>
          {Array.from(node.subdirectories.values()).map(subdir =>
            renderDirectoryNode(subdir)
          )}
          {node.files.map(file => renderFile(file))}
        </>
      );
    }

    return (
      <div key={node.path} className="git-commit-widget__directory">
        <div
          className="git-commit-widget__directory-header"
          onClick={() => toggleFolder(node.path)}
        >
          <MaterialSymbol
            icon={isExpanded ? 'expand_more' : 'chevron_right'}
            size={16}
            className="git-commit-widget__directory-chevron"
          />
          <div
            className={`git-commit-widget__file-checkbox ${allSelected ? 'git-commit-widget__file-checkbox--checked' : ''} ${someSelected ? 'git-commit-widget__file-checkbox--partial' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              toggleDirectoryFiles(node);
            }}
          >
            {allSelected && <MaterialSymbol icon="check" size={12} />}
            {someSelected && <MaterialSymbol icon="remove" size={12} />}
          </div>
          <MaterialSymbol
            icon={isExpanded ? 'folder_open' : 'folder'}
            size={16}
            className="git-commit-widget__directory-icon"
          />
          <span className="git-commit-widget__directory-path">{node.displayPath}</span>
          <span className="git-commit-widget__directory-count">
            {selectedCount}/{node.fileCount}
          </span>
        </div>

        {isExpanded && hasContent && (
          <div className="git-commit-widget__directory-children">
            {Array.from(node.subdirectories.values()).map(subdir =>
              renderDirectoryNode(subdir)
            )}
            {node.files.map(file => renderFile(file))}
          </div>
        )}
      </div>
    );
  };

  const handleConfirm = useCallback(async () => {
    if (filesToStage.size === 0 || !commitMessage.trim() || !commitWorkspacePath) {
      return;
    }

    setIsCommitting(true);
    try {
      if (window.electronAPI) {
        // Execute the git commit
        const result = await window.electronAPI.invoke(
          'git:commit',
          commitWorkspacePath,
          commitMessage,
          Array.from(filesToStage)
        ) as { success: boolean; commitHash?: string; error?: string };

        setLocalResult(result);
        setHasResponded(true);

        // Send the result back to httpServer to complete the MCP tool call
        if (pendingProposal && window.electronAPI.sendMcpGitCommitProposalResult) {
          window.electronAPI.sendMcpGitCommitProposalResult(pendingProposal.proposalId, {
            action: result.success ? 'committed' : 'cancelled',
            commitHash: result.commitHash,
            error: result.error,
            filesCommitted: result.success ? Array.from(filesToStage) : undefined,
            commitMessage: result.success ? commitMessage : undefined,
          });
          // Remove from pending with response type
          removePendingProposal(
            initialFilesToStage,
            initialCommitMessage,
            result.success ? 'committed' : 'cancelled',
            result.commitHash
          );
        }
      }
    } catch (error) {
      const errorResult = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
      setLocalResult(errorResult);

      // Send error result back
      if (pendingProposal && window.electronAPI?.sendMcpGitCommitProposalResult) {
        window.electronAPI.sendMcpGitCommitProposalResult(pendingProposal.proposalId, {
          action: 'cancelled',
          error: errorResult.error,
        });
        removePendingProposal(initialFilesToStage, initialCommitMessage, 'cancelled');
      }
    } finally {
      setIsCommitting(false);
    }
  }, [commitWorkspacePath, filesToStage, commitMessage, pendingProposal, initialFilesToStage, initialCommitMessage]);

  const handleCancel = useCallback(() => {
    if (hasResponded) return; // Prevent double-response

    setLocalResult({ success: false, error: 'Cancelled' });
    setHasResponded(true);

    // Send cancel result back to httpServer
    if (pendingProposal && window.electronAPI?.sendMcpGitCommitProposalResult) {
      window.electronAPI.sendMcpGitCommitProposalResult(pendingProposal.proposalId, {
        action: 'cancelled',
      });
      removePendingProposal(initialFilesToStage, initialCommitMessage, 'cancelled');
    }
  }, [pendingProposal, initialFilesToStage, initialCommitMessage, hasResponded]);

  if (!commitWorkspacePath) {
    return null;
  }

  // Show completed/cancelled state (or if we've responded but waiting for tool result)
  if (displayResult || hasResponded || alreadyResponded) {
    // If we've responded but no displayResult yet, use the stored response type
    // This handles the case where we committed/cancelled but tool result hasn't come back yet
    let effectiveResult = displayResult;
    if (!effectiveResult && (hasResponded || alreadyResponded)) {
      // Use the stored response from previousResponse if available
      if (previousResponse) {
        effectiveResult = {
          success: previousResponse.type === 'committed',
          commitHash: previousResponse.commitHash,
          error: previousResponse.type === 'cancelled' ? 'Cancelled' : undefined,
        };
      } else {
        // Fallback for hasResponded (localResult should be set, but just in case)
        effectiveResult = { success: false, error: 'Cancelled' };
      }
    }
    if (!effectiveResult) {
      return null;
    }
    const result = effectiveResult;
    if (result.error === 'Cancelled') {
      return (
        <div className="git-commit-widget git-commit-widget--cancelled">
          <div className="git-commit-widget__header">
            <MaterialSymbol icon="close" size={16} />
            <span className="git-commit-widget__title">Commit Proposal</span>
            <span className="git-commit-widget__status git-commit-widget__status--cancelled">
              Cancelled
            </span>
          </div>
        </div>
      );
    }

    return (
      <div className={`git-commit-widget ${result.success ? 'git-commit-widget--success' : 'git-commit-widget--error'}`}>
        <div className="git-commit-widget__header">
          <MaterialSymbol
            icon={result.success ? 'check_circle' : 'error'}
            size={16}
            className={result.success ? 'git-commit-widget__icon--success' : 'git-commit-widget__icon--error'}
          />
          <span className="git-commit-widget__title">
            {result.success ? 'Changes Committed' : 'Commit Failed'}
          </span>
          {result.success && result.commitHash && (
            <span className="git-commit-widget__commit-hash-badge">
              {result.commitHash.slice(0, 7)}
            </span>
          )}
        </div>
        {result.success ? (
          <div className="git-commit-widget__success-summary">
            <div className="git-commit-widget__success-message">{commitMessage.split('\n')[0]}</div>
            <div className="git-commit-widget__success-files">
              {filesToStage.size} file{filesToStage.size !== 1 ? 's' : ''} committed
            </div>
          </div>
        ) : (
          <div className="git-commit-widget__error-summary">
            {result.error}
          </div>
        )}
      </div>
    );
  }

  // If there's no pending proposal and no result, we're in a race condition state
  // (e.g., after HMR when the module-level Map was cleared but tool result isn't populated yet)
  // Show a "Response pending" state rather than the interactive UI
  if (!pendingProposal) {
    return (
      <div className="git-commit-widget git-commit-widget--pending">
        <div className="git-commit-widget__header">
          <MaterialSymbol icon="commit" size={16} className="git-commit-widget__icon--primary" />
          <span className="git-commit-widget__title">Commit Proposal</span>
          <span className="git-commit-widget__status git-commit-widget__status--waiting">
            Response pending...
          </span>
        </div>
      </div>
    );
  }

  // Show interactive UI for pending proposals
  return (
    <div className="git-commit-widget">
      <div className="git-commit-widget__header">
        <MaterialSymbol icon="commit" size={16} className="git-commit-widget__icon--primary" />
        <span className="git-commit-widget__title">Commit Proposal</span>
      </div>

      <div className="git-commit-widget__body">
        {/* Reasoning */}
        {reasoning && (
          <div className="git-commit-widget__section">
            <div className="git-commit-widget__section-label">Analysis</div>
            <div className="git-commit-widget__reasoning">{reasoning}</div>
          </div>
        )}

        {/* Files to Stage */}
        <div className="git-commit-widget__section">
          <div className="git-commit-widget__section-label">
            Files to Stage ({filesToStage.size}/{initialFilesToStage.length})
          </div>
          <div className="git-commit-widget__files">
            {renderDirectoryNode(directoryTree)}
          </div>
        </div>

        {/* Commit Message */}
        <div className="git-commit-widget__section">
          <div className="git-commit-widget__section-label">Commit Message</div>
          <textarea
            className="git-commit-widget__textarea"
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            rows={6}
            placeholder="Enter commit message..."
          />
        </div>

        {/* Actions */}
        <div className="git-commit-widget__actions">
          <button
            className="git-commit-widget__btn git-commit-widget__btn--cancel"
            onClick={handleCancel}
            disabled={isCommitting}
          >
            Cancel
          </button>
          <button
            className="git-commit-widget__btn git-commit-widget__btn--confirm"
            onClick={handleConfirm}
            disabled={isCommitting || filesToStage.size === 0 || !commitMessage.trim()}
          >
            <MaterialSymbol icon="check" size={14} />
            {isCommitting ? 'Committing...' : 'Confirm & Commit'}
          </button>
        </div>
      </div>
    </div>
  );
};
