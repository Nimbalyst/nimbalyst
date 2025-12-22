/**
 * GitWorktreeService - Manages git worktree operations
 *
 * Provides methods to create, delete, and query git worktrees using simple-git.
 * Worktrees are parallel working directories that share the same git repository.
 */

import simpleGit, { SimpleGit } from 'simple-git';
import * as path from 'path';
import * as fs from 'fs';
import { ulid } from 'ulid';
import log from 'electron-log';

const logger = log.scope('GitWorktreeService');

/**
 * Worktree data structure (matches runtime types)
 */
export interface Worktree {
  id: string;
  name: string;
  path: string;
  branch: string;
  baseBranch: string;
  projectPath: string;
  createdAt: number;
}

/**
 * Git status summary for a worktree
 */
export interface WorktreeStatus {
  hasUncommittedChanges: boolean;
  modifiedFileCount: number;
  commitsAhead: number;
  commitsBehind: number;
  isMerged: boolean;
}

/**
 * Options for creating a worktree
 */
export interface CreateWorktreeOptions {
  name?: string; // Optional custom name (defaults to random adjective-noun)
  baseBranch?: string; // Branch to compare against (defaults to 'main')
}

/**
 * Service for managing git worktrees
 */
export class GitWorktreeService {
  /**
   * Create a new git worktree
   *
   * Creates a new worktree in the default worktrees directory:
   * ../<project_name>_worktrees/<worktree_name>
   *
   * @param workspacePath - Path to the main git repository
   * @param options - Optional configuration
   * @returns Worktree data
   */
  async createWorktree(workspacePath: string, options: CreateWorktreeOptions = {}): Promise<Worktree> {
    if (!workspacePath) {
      throw new Error('workspacePath is required');
    }

    logger.info('Creating worktree', { workspacePath, options });

    // Ensure this is a git repository
    const git: SimpleGit = simpleGit(workspacePath);
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      throw new Error(`Not a git repository: ${workspacePath}`);
    }

    // Generate unique worktree name if not provided
    const worktreeName = options.name || this.generateWorktreeName();
    logger.info('Generated worktree name', { worktreeName });

    // Determine base branch (default to 'main', fallback to 'master')
    let baseBranch = options.baseBranch || 'main';
    try {
      const branches = await git.branch();
      if (!branches.all.includes(baseBranch) && branches.all.includes('master')) {
        baseBranch = 'master';
        logger.info('Base branch not found, using master', { requestedBranch: options.baseBranch });
      }
    } catch (error) {
      logger.warn('Failed to check branches, using default base branch', { baseBranch, error });
    }

    // Create worktrees directory if it doesn't exist
    const projectName = path.basename(workspacePath);
    const worktreesDir = path.resolve(workspacePath, '..', `${projectName}_worktrees`);

    if (!fs.existsSync(worktreesDir)) {
      logger.info('Creating worktrees directory', { worktreesDir });
      fs.mkdirSync(worktreesDir, { recursive: true });
    }

    // Full path to new worktree (handle duplicates with incrementing numbers)
    let worktreePath = path.join(worktreesDir, worktreeName);
    let finalWorktreeName = worktreeName;
    let counter = 1;

    // If path exists, append incrementing number until we find an available path
    while (fs.existsSync(worktreePath)) {
      finalWorktreeName = `${worktreeName}-${counter}`;
      worktreePath = path.join(worktreesDir, finalWorktreeName);
      counter++;
    }

    if (counter > 1) {
      logger.info('Worktree path already existed, using incremented name', {
        originalName: worktreeName,
        finalName: finalWorktreeName
      });
    }

    // Create a new branch name for this worktree (ensure uniqueness)
    const branchName = `worktree/${finalWorktreeName}`;

    try {
      // Create the worktree with a new branch
      logger.info('Creating git worktree', { worktreePath, branchName, baseBranch });
      await git.raw(['worktree', 'add', '-b', branchName, worktreePath, baseBranch]);

      logger.info('Worktree created successfully', { worktreePath });

      // Return worktree data
      const worktree: Worktree = {
        id: ulid(),
        name: finalWorktreeName,
        path: worktreePath,
        branch: branchName,
        baseBranch,
        projectPath: workspacePath,
        createdAt: Date.now(),
      };

      return worktree;
    } catch (error) {
      logger.error('Failed to create worktree', { error, worktreePath, branchName });

      // Clean up if worktree directory was created but git command failed
      if (fs.existsSync(worktreePath)) {
        try {
          fs.rmSync(worktreePath, { recursive: true, force: true });
          logger.info('Cleaned up failed worktree directory', { worktreePath });
        } catch (cleanupError) {
          logger.warn('Failed to clean up worktree directory', { cleanupError, worktreePath });
        }
      }

      throw new Error(`Failed to create worktree: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get the status of a worktree compared to its base branch
   *
   * @param worktreePath - Path to the worktree
   * @returns Status summary
   */
  async getWorktreeStatus(worktreePath: string): Promise<WorktreeStatus> {
    if (!worktreePath) {
      throw new Error('worktreePath is required');
    }

    logger.info('Getting worktree status', { worktreePath });

    const git: SimpleGit = simpleGit(worktreePath);

    try {
      // Get current branch
      const currentBranch = await git.revparse(['--abbrev-ref', 'HEAD']);
      logger.info('Current branch', { currentBranch });

      // Get status to check for uncommitted changes
      const status = await git.status();
      const hasUncommittedChanges = !status.isClean();
      const modifiedFileCount = status.files.length;

      // Get base branch from worktree metadata
      // For now, we'll extract it from branch name or default to 'main'
      const baseBranch = await this.inferBaseBranch(git);
      logger.info('Inferred base branch', { baseBranch });

      // Get commits ahead/behind base branch
      let commitsAhead = 0;
      let commitsBehind = 0;
      let isMerged = false;

      try {
        // Check if branch exists in remote
        const revList = await git.raw(['rev-list', '--left-right', '--count', `${baseBranch}...${currentBranch}`]);
        const [behind, ahead] = revList.trim().split('\t').map(Number);
        commitsBehind = behind || 0;
        commitsAhead = ahead || 0;

        logger.info('Commits ahead/behind', { commitsAhead, commitsBehind });

        // Check if branch is merged
        const mergedBranches = await git.raw(['branch', '--merged', baseBranch]);
        isMerged = mergedBranches.includes(currentBranch);
      } catch (error) {
        logger.warn('Failed to get ahead/behind counts', { error });
        // Continue with default values
      }

      return {
        hasUncommittedChanges,
        modifiedFileCount,
        commitsAhead,
        commitsBehind,
        isMerged,
      };
    } catch (error) {
      logger.error('Failed to get worktree status', { error, worktreePath });
      throw new Error(`Failed to get worktree status: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Delete a worktree and its branch
   *
   * @param worktreePath - Path to the worktree to delete
   * @param workspacePath - Path to the main repository (needed for git operations)
   */
  async deleteWorktree(worktreePath: string, workspacePath: string): Promise<void> {
    if (!worktreePath) {
      throw new Error('worktreePath is required');
    }
    if (!workspacePath) {
      throw new Error('workspacePath is required');
    }

    logger.info('Deleting worktree', { worktreePath, workspacePath });

    const git: SimpleGit = simpleGit(workspacePath);

    try {
      // Get the branch name before removing
      const worktreeGit: SimpleGit = simpleGit(worktreePath);
      let branchName: string | null = null;

      try {
        branchName = await worktreeGit.revparse(['--abbrev-ref', 'HEAD']);
        logger.info('Found branch for worktree', { branchName });
      } catch (error) {
        logger.warn('Failed to get branch name, continuing with worktree removal', { error });
      }

      // Remove the worktree
      await git.raw(['worktree', 'remove', worktreePath, '--force']);
      logger.info('Worktree removed', { worktreePath });

      // Delete the branch if we found it
      if (branchName && branchName !== 'HEAD') {
        try {
          await git.deleteLocalBranch(branchName, true); // force delete
          logger.info('Branch deleted', { branchName });
        } catch (error) {
          logger.warn('Failed to delete branch', { error, branchName });
          // Continue even if branch deletion fails
        }
      }

      logger.info('Worktree deletion complete', { worktreePath });
    } catch (error) {
      logger.error('Failed to delete worktree', { error, worktreePath });
      throw new Error(`Failed to delete worktree: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * List all worktrees for a repository
   *
   * @param workspacePath - Path to the main git repository
   * @returns Array of worktree paths and branches
   */
  async listWorktrees(workspacePath: string): Promise<Array<{ path: string; branch: string; isMain: boolean }>> {
    if (!workspacePath) {
      throw new Error('workspacePath is required');
    }

    logger.info('Listing worktrees', { workspacePath });

    const git: SimpleGit = simpleGit(workspacePath);

    try {
      // Get worktree list in porcelain format
      const output = await git.raw(['worktree', 'list', '--porcelain']);

      const worktrees: Array<{ path: string; branch: string; isMain: boolean }> = [];
      let currentPath: string | null = null;
      let currentBranch: string | null = null;
      let isMain = false;

      // Parse porcelain output
      const lines = output.split('\n');
      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          currentPath = line.substring('worktree '.length).trim();
          isMain = false; // Will be set by 'HEAD' or 'branch' line
        } else if (line.startsWith('HEAD ')) {
          isMain = true; // Main worktree
        } else if (line.startsWith('branch ')) {
          currentBranch = line.substring('branch '.length).replace('refs/heads/', '').trim();
        } else if (line === '' && currentPath) {
          // End of worktree entry
          worktrees.push({
            path: currentPath,
            branch: currentBranch || 'HEAD',
            isMain,
          });
          currentPath = null;
          currentBranch = null;
          isMain = false;
        }
      }

      logger.info('Found worktrees', { count: worktrees.length });
      return worktrees;
    } catch (error) {
      logger.error('Failed to list worktrees', { error, workspacePath });
      throw new Error(`Failed to list worktrees: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Generate a random worktree name using adjective-noun pattern
   * @private
   */
  private generateWorktreeName(): string {
    const adjectives = [
      'swift', 'bright', 'clever', 'quick', 'bold', 'keen', 'wise', 'neat',
      'cool', 'fair', 'calm', 'warm', 'kind', 'brave', 'sharp', 'clear',
    ];

    const nouns = [
      'falcon', 'river', 'mountain', 'forest', 'ocean', 'thunder', 'wind', 'star',
      'cloud', 'dawn', 'storm', 'meadow', 'canyon', 'glacier', 'valley', 'peak',
    ];

    const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];

    return `${adjective}-${noun}`;
  }

  /**
   * Infer the base branch from git configuration or default to 'main'
   * @private
   */
  private async inferBaseBranch(git: SimpleGit): Promise<string> {
    try {
      // Try to get default branch from remote
      const remotes = await git.getRemotes(true);
      if (remotes.length > 0) {
        const defaultRemote = remotes.find(r => r.name === 'origin') || remotes[0];
        const remoteBranches = await git.branch(['-r']);

        // Check for common default branches
        const defaultBranches = ['main', 'master', 'develop'];
        for (const branch of defaultBranches) {
          const remoteBranch = `${defaultRemote.name}/${branch}`;
          if (remoteBranches.all.includes(remoteBranch)) {
            return branch;
          }
        }
      }
    } catch (error) {
      logger.warn('Failed to infer base branch from remote', { error });
    }

    // Fallback to 'main'
    return 'main';
  }
}

// Export singleton instance
export const gitWorktreeService = new GitWorktreeService();
