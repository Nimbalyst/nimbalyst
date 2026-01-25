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

// ============================================================
// File Status Types
// ============================================================

type FileStatus = 'added' | 'modified' | 'deleted';

interface FileWithStatus {
  path: string;
  status: FileStatus;
}

type FileInput = string | FileWithStatus;

/**
 * Normalize file input to extract path and status
 */
function normalizeFileInput(file: FileInput): FileWithStatus {
  if (typeof file === 'string') {
    return { path: file, status: 'modified' }; // Default to modified for backward compatibility
  }
  return file;
}

/**
 * Extract just the path from a file input
 */
function getFilePath(file: FileInput): string {
  return typeof file === 'string' ? file : file.path;
}

// ============================================================
// Pending Proposals Store
// ============================================================
// Store pending proposals sent via IPC. The widget looks up its proposal
// by matching the arguments (filesToStage, commitMessage).

interface PendingProposal {
  proposalId: string;
  workspacePath: string;
  sessionId: string;  // Required: proposals must be scoped to a specific session
  filesToStage: string[];  // Always normalized to paths only
  commitMessage: string;
  reasoning?: string;
  timestamp: number;
}

// Input type for registerPendingProposal - can have objects or strings
interface PendingProposalInput {
  proposalId: string;
  workspacePath: string;
  sessionId: string;  // Required: proposals must be scoped to a specific session
  filesToStage: (string | { path: string; status?: string })[];
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
 * Generate a key for matching proposals based on content and session.
 * Including sessionId ensures proposals from different sessions don't collide.
 */
function generateProposalKey(sessionId: string, filesToStage: string[], commitMessage: string): string {
  const filesKey = [...filesToStage].sort().join('|');
  return `${sessionId}::${filesKey}::${commitMessage.trim().slice(0, 100)}`;
}

/**
 * Register a pending proposal from IPC.
 * Called by the renderer when it receives mcp:gitCommitProposal.
 * Normalizes filesToStage to string paths for consistent key matching.
 */
export function registerPendingProposal(input: PendingProposalInput): void {
  // Normalize filesToStage to string paths
  const normalizedFiles = input.filesToStage.map(f =>
    typeof f === 'string' ? f : f.path
  );

  const proposal: PendingProposal = {
    ...input,
    filesToStage: normalizedFiles,
  };

  const key = generateProposalKey(proposal.sessionId, proposal.filesToStage, proposal.commitMessage);
  pendingProposals.set(key, proposal);
  console.log('[GitCommitWidget] Registered pending proposal:', proposal.proposalId, 'sessionId:', proposal.sessionId, 'key:', key);
}

/**
 * Remove a pending proposal after it's been acted upon.
 * Also marks the key as responded with the response type to handle component re-renders.
 */
export function removePendingProposal(
  sessionId: string,
  filesToStage: string[],
  commitMessage: string,
  responseType: 'committed' | 'cancelled' = 'cancelled',
  commitHash?: string
): void {
  const key = generateProposalKey(sessionId, filesToStage, commitMessage);
  pendingProposals.delete(key);
  respondedProposals.set(key, { type: responseType, commitHash });
  console.log('[GitCommitWidget] Removed pending proposal and marked as responded:', key, responseType);
}

/**
 * Get the response for a proposal that has already been responded to.
 */
function getProposalResponse(sessionId: string, filesToStage: string[], commitMessage: string): { type: 'committed' | 'cancelled'; commitHash?: string } | undefined {
  const key = generateProposalKey(sessionId, filesToStage, commitMessage);
  return respondedProposals.get(key);
}

/**
 * Get pending proposal matching the given arguments.
 */
function getPendingProposal(sessionId: string, filesToStage: string[], commitMessage: string): PendingProposal | undefined {
  const key = generateProposalKey(sessionId, filesToStage, commitMessage);
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
  sessionId,
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

  // Parse files - can be strings or objects with path and status
  const rawFiles: FileInput[] = args.filesToStage || [];
  const filesWithStatus: FileWithStatus[] = useMemo(
    () => rawFiles.map(normalizeFileInput),
    [rawFiles]
  );
  const initialFilesToStage: string[] = useMemo(
    () => filesWithStatus.map(f => f.path),
    [filesWithStatus]
  );
  // Create a map for quick status lookup
  const fileStatusMap = useMemo(
    () => new Map(filesWithStatus.map(f => [f.path, f.status])),
    [filesWithStatus]
  );
  const initialCommitMessage: string = args.commitMessage || '';
  const reasoning: string = args.reasoning || '';
  const commitWorkspacePath = workspacePath;

  // Parse the tool result to determine completion state
  // The result can be a string or an array of content blocks [{type: 'text', text: '...'}]
  const rawToolResult = toolCall.result;
  const toolResult = useMemo(() => {
    if (typeof rawToolResult === 'string') return rawToolResult;
    if (Array.isArray(rawToolResult)) {
      // Extract text from content blocks
      return rawToolResult
        .filter((block: any) => block.type === 'text' && block.text)
        .map((block: any) => block.text)
        .join('\n');
    }
    return '';
  }, [rawToolResult]);
  const isCompleted = toolResult !== undefined && toolResult !== null && toolResult !== '';

  // Parse completed state from result
  const completedState = useMemo(() => {
    if (!isCompleted || !toolResult) return null;

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
  // Uses sessionId to ensure we only match proposals from THIS session
  const pendingProposal = getPendingProposal(sessionId, initialFilesToStage, initialCommitMessage);

  // Check if we've already responded to this proposal (persists in module-level Map)
  const previousResponse = getProposalResponse(sessionId, initialFilesToStage, initialCommitMessage);
  const alreadyResponded = !!previousResponse;

  // Track whether we're waiting for the pending proposal to be registered
  // This handles the race condition where the widget renders before the IPC message arrives
  const [waitingForProposal, setWaitingForProposal] = useState(!pendingProposal && !isCompleted && !alreadyResponded);

  // Effect to check for pending proposal registration
  useEffect(() => {
    if (pendingProposal || isCompleted || alreadyResponded) {
      setWaitingForProposal(false);
      return;
    }

    // Poll for pending proposal registration (IPC message may arrive shortly after render)
    const checkInterval = setInterval(() => {
      const proposal = getPendingProposal(sessionId, initialFilesToStage, initialCommitMessage);
      const response = getProposalResponse(sessionId, initialFilesToStage, initialCommitMessage);
      if (proposal || response) {
        setWaitingForProposal(false);
        clearInterval(checkInterval);
      }
    }, 50); // Check every 50ms

    // Stop waiting after 2 seconds - if no proposal by then, it's genuinely completed
    const timeout = setTimeout(() => {
      setWaitingForProposal(false);
      clearInterval(checkInterval);
    }, 2000);

    return () => {
      clearInterval(checkInterval);
      clearTimeout(timeout);
    };
  }, [sessionId, pendingProposal, isCompleted, alreadyResponded, initialFilesToStage, initialCommitMessage]);

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

  // Get status label for tooltip
  const getStatusLabel = (status: FileStatus): string => {
    switch (status) {
      case 'added': return 'New file';
      case 'modified': return 'Modified';
      case 'deleted': return 'Deleted';
      default: return 'Modified';
    }
  };

  // Get status color class
  const getStatusColorClass = (status: FileStatus): string => {
    switch (status) {
      case 'added': return 'text-nim-success';
      case 'modified': return 'text-nim-info';
      case 'deleted': return 'text-nim-error';
      default: return 'text-nim';
    }
  };

  // Render a single file item
  const renderFile = (filePath: string) => {
    const isSelected = filesToStage.has(filePath);
    const fileName = filePath.split('/').pop() || filePath;
    const status = fileStatusMap.get(filePath) || 'modified';
    return (
      <div
        key={filePath}
        className={`git-commit-widget__file flex items-start gap-2 py-2 px-2.5 rounded border cursor-pointer transition-all duration-150 ${
          isSelected
            ? 'border-nim-primary bg-[color-mix(in_srgb,var(--nim-primary)_8%,var(--nim-bg-secondary))]'
            : 'border-nim bg-nim-secondary hover:bg-nim-tertiary'
        }`}
        onClick={() => toggleFile(filePath)}
        title={getStatusLabel(status)}
      >
        <div className={`w-4 h-4 mt-0.5 shrink-0 border rounded-sm flex items-center justify-center ${
          isSelected
            ? 'bg-nim-primary border-nim-primary text-white'
            : 'bg-nim border-nim text-nim-primary'
        }`}>
          {isSelected && <MaterialSymbol icon="check" size={12} />}
        </div>
        <span className={`text-[0.8125rem] font-medium leading-snug ${getStatusColorClass(status)}`}>{fileName}</span>
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
      <div key={node.path} className="flex flex-col">
        <div
          className="flex items-center gap-1 py-1.5 px-2 rounded cursor-pointer select-none transition-colors duration-150 hover:bg-nim-tertiary"
          onClick={() => toggleFolder(node.path)}
        >
          <MaterialSymbol
            icon={isExpanded ? 'expand_more' : 'chevron_right'}
            size={16}
            className="text-nim-faint shrink-0"
          />
          <div
            className={`w-4 h-4 shrink-0 border rounded-sm flex items-center justify-center mr-0.5 ${
              allSelected
                ? 'bg-nim-primary border-nim-primary text-white'
                : someSelected
                  ? 'bg-nim-primary border-nim-primary text-white'
                  : 'bg-nim border-nim text-nim-primary'
            }`}
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
            className="text-nim-muted shrink-0"
          />
          <span className="text-[0.8125rem] font-medium text-nim flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{node.displayPath}</span>
          <span className="text-[0.6875rem] font-medium text-nim-faint bg-nim-tertiary py-0.5 px-1.5 rounded-full shrink-0">
            {selectedCount}/{node.fileCount}
          </span>
        </div>

        {isExpanded && hasContent && (
          <div className="pl-[2.375rem] flex flex-col gap-0.5">
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
          console.log('[GitCommitWidget] Sending result back to httpServer:', pendingProposal.proposalId, result.success ? 'committed' : 'cancelled');
          window.electronAPI.sendMcpGitCommitProposalResult(pendingProposal.proposalId, {
            action: result.success ? 'committed' : 'cancelled',
            commitHash: result.commitHash,
            error: result.error,
            filesCommitted: result.success ? Array.from(filesToStage) : undefined,
            commitMessage: result.success ? commitMessage : undefined,
          });
          // Remove from pending with response type (now session-scoped)
          removePendingProposal(
            sessionId,
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
        removePendingProposal(sessionId, initialFilesToStage, initialCommitMessage, 'cancelled');
      }
    } finally {
      setIsCommitting(false);
    }
  }, [sessionId, commitWorkspacePath, filesToStage, commitMessage, pendingProposal, initialFilesToStage, initialCommitMessage]);

  const handleCancel = useCallback(() => {
    if (hasResponded) return; // Prevent double-response

    setLocalResult({ success: false, error: 'Cancelled' });
    setHasResponded(true);

    // Send cancel result back to httpServer
    if (pendingProposal && window.electronAPI?.sendMcpGitCommitProposalResult) {
      window.electronAPI.sendMcpGitCommitProposalResult(pendingProposal.proposalId, {
        action: 'cancelled',
      });
      removePendingProposal(sessionId, initialFilesToStage, initialCommitMessage, 'cancelled');
    }
  }, [sessionId, pendingProposal, initialFilesToStage, initialCommitMessage, hasResponded]);

  if (!commitWorkspacePath) {
    return null;
  }

  // If we're waiting for the pending proposal to be registered, show a loading state
  // This MUST come before other checks to handle the race condition where widget renders
  // before the IPC message arrives to register the proposal
  if (waitingForProposal) {
    return (
      <div className="git-commit-widget rounded-lg bg-nim-secondary border border-nim overflow-hidden">
        <div className="flex items-center gap-2 py-3 px-4 border-b border-nim bg-nim-tertiary">
          <MaterialSymbol icon="commit" size={16} className="text-nim-primary" />
          <span className="text-sm font-semibold text-nim flex-1">Commit Proposal</span>
          <span className="text-xs font-medium text-nim-muted py-1 px-2">Loading...</span>
        </div>
      </div>
    );
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
        <div className="git-commit-widget rounded-lg bg-nim-secondary border border-nim overflow-hidden opacity-70">
          <div className="flex items-center gap-2 py-3 px-4 border-b border-nim bg-nim-tertiary">
            <MaterialSymbol icon="close" size={16} />
            <span className="text-sm font-semibold text-nim flex-1">Commit Proposal</span>
            <span className="flex items-center gap-1 text-xs font-medium text-nim-muted py-1 px-2 bg-nim-tertiary rounded-full">
              Cancelled
            </span>
          </div>
        </div>
      );
    }

    // Format the commit timestamp
    const commitTimestamp = new Date().toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });

    return (
      <div className={`git-commit-widget rounded-lg bg-nim-secondary border overflow-hidden ${result.success ? 'border-nim-success' : 'border-nim-error'}`}>
        <div className="flex items-center gap-2 py-3 px-4 border-b border-nim bg-nim-tertiary">
          <MaterialSymbol
            icon={result.success ? 'check_circle' : 'error'}
            size={16}
            className={result.success ? 'text-nim-success' : 'text-nim-error'}
          />
          <span className="text-sm font-semibold text-nim flex-1">
            {result.success ? 'Changes Committed' : 'Commit Failed'}
          </span>
          {result.success && result.commitHash && (
            <span className="font-mono text-[0.6875rem] font-semibold text-nim-success bg-[color-mix(in_srgb,var(--nim-success)_12%,transparent)] py-0.5 px-2 rounded-full">
              {result.commitHash.slice(0, 7)}
            </span>
          )}
        </div>
        {result.success ? (
          <div className="p-3 bg-[color-mix(in_srgb,var(--nim-success)_8%,var(--nim-bg))] flex flex-col gap-2">
            <div className="text-[0.6875rem] text-nim-faint">{commitTimestamp}</div>
            <div className="text-[0.8125rem] font-medium text-nim leading-normal whitespace-pre-wrap font-mono">{commitMessage}</div>
            <div className="mt-1 pt-2 border-t border-nim">
              <div className="text-[0.6875rem] font-semibold uppercase tracking-wide text-nim-muted mb-1.5">
                {filesToStage.size} file{filesToStage.size !== 1 ? 's' : ''} committed
              </div>
              <div className="flex flex-wrap gap-1">
                {Array.from(filesToStage).map((filePath) => {
                  const fileName = filePath.split('/').pop() || filePath;
                  const status = fileStatusMap.get(filePath) || 'modified';
                  return (
                    <div key={filePath} className="text-xs" title={filePath}>
                      <span className={`font-mono ${getStatusColorClass(status)}`}>
                        {fileName}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="p-3 bg-[color-mix(in_srgb,var(--nim-error)_8%,var(--nim-bg))] text-nim-error text-[0.8125rem]">
            {result.error}
          </div>
        )}
      </div>
    );
  }

  // If there's no pending proposal and no result, the tool result wasn't persisted properly
  // or hasn't been loaded yet. Don't show the interactive UI (user can't respond anyway).
  // This matches AskUserQuestionWidget behavior which returns null when not completed.
  if (!pendingProposal) {
    // Return a minimal "completed" state since the user already responded
    // (we just can't tell if it was committed or cancelled)
    return (
      <div className="git-commit-widget rounded-lg bg-nim-secondary border border-nim overflow-hidden opacity-70">
        <div className="flex items-center gap-2 py-3 px-4 border-b border-nim bg-nim-tertiary">
          <MaterialSymbol icon="commit" size={16} />
          <span className="text-sm font-semibold text-nim flex-1">Commit Proposal</span>
          <span className="text-xs font-medium text-nim-muted py-1 px-2">Completed</span>
        </div>
      </div>
    );
  }

  // Show interactive UI for pending proposals
  return (
    <div className="git-commit-widget rounded-lg bg-nim-secondary border border-nim overflow-hidden">
      <div className="flex items-center gap-2 py-3 px-4 border-b border-nim bg-nim-tertiary">
        <MaterialSymbol icon="commit" size={16} className="text-nim-primary" />
        <span className="text-sm font-semibold text-nim flex-1">Commit Proposal</span>
      </div>

      <div className="p-3 flex flex-col gap-3">
        {/* Reasoning */}
        {reasoning && (
          <div className="flex flex-col gap-2">
            <div className="text-[0.6875rem] font-semibold uppercase tracking-wide text-nim-muted">Analysis</div>
            <div className="p-3 bg-nim border border-nim rounded-md text-[0.8125rem] text-nim-muted leading-normal">{reasoning}</div>
          </div>
        )}

        {/* Files to Stage */}
        <div className="flex flex-col gap-2">
          <div className="text-[0.6875rem] font-semibold uppercase tracking-wide text-nim-muted">
            Files to Stage ({filesToStage.size}/{initialFilesToStage.length})
          </div>
          <div className="flex flex-col gap-1.5 max-h-[200px] overflow-y-auto">
            {renderDirectoryNode(directoryTree)}
          </div>
        </div>

        {/* Commit Message */}
        <div className="flex flex-col gap-2">
          <div className="text-[0.6875rem] font-semibold uppercase tracking-wide text-nim-muted">Commit Message</div>
          <textarea
            className="w-full p-3 border border-nim rounded-md bg-nim text-nim text-[0.8125rem] font-mono resize-y leading-snug focus:outline-none focus:border-nim-primary focus:shadow-[0_0_0_2px_color-mix(in_srgb,var(--nim-primary)_20%,transparent)] placeholder:text-nim-faint"
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            rows={6}
            placeholder="Enter commit message..."
          />
        </div>

        {/* Actions */}
        <div className="flex gap-2 justify-end pt-2 border-t border-nim">
          <button
            className="flex items-center gap-1.5 py-2 px-4 text-[0.8125rem] font-medium border border-nim rounded bg-nim text-nim cursor-pointer transition-all duration-150 hover:bg-nim-tertiary disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleCancel}
            disabled={isCommitting}
          >
            Cancel
          </button>
          <button
            className="flex items-center gap-1.5 py-2 px-4 text-[0.8125rem] font-medium border-none rounded bg-nim-primary text-white cursor-pointer transition-all duration-150 hover:bg-[color-mix(in_srgb,var(--nim-primary)_85%,black)] disabled:opacity-50 disabled:cursor-not-allowed"
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
