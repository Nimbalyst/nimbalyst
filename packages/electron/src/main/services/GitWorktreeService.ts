/**
 * GitWorktreeService - Manages git worktree operations
 *
 * Provides methods to create, delete, and query git worktrees using simple-git.
 * Worktrees are parallel working directories that share the same git repository.
 *
 * CROSS-PLATFORM NOTES:
 * - Git internally uses forward slashes (/) for paths in all output, even on Windows
 * - All git command output (diff, status, log) returns paths with forward slashes
 * - Manual diff generation also uses forward slashes to match git's format
 * - Local file operations use path.join() for platform-specific path separators
 * - This design ensures consistent diff output across all platforms
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
 * Diff result for a file
 */
export interface FileDiffResult {
  filePath: string;
  diff: string;
  oldContent: string;
  newContent: string;
  status: 'added' | 'modified' | 'deleted';
}

/**
 * Commit information
 */
export interface CommitInfo {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: Date;
  files: string[];
}

/**
 * Result of a merge operation
 */
export interface MergeResult {
  success: boolean;
  message: string;
  conflictedFiles?: string[];
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

  /**
   * Validate file path to prevent path traversal and command injection
   * @private
   */
  private validateFilePath(filePath: string): void {
    // Check for null bytes (command injection)
    if (filePath.includes('\0')) {
      throw new Error('Invalid file path: contains null bytes');
    }

    // Check for path traversal attempts
    const normalized = path.normalize(filePath);
    if (normalized.startsWith('..') || normalized.includes('/../')) {
      throw new Error('Invalid file path: path traversal detected');
    }

    // Check for absolute paths (should be relative)
    if (path.isAbsolute(filePath)) {
      throw new Error('Invalid file path: must be relative');
    }
  }

  /**
   * Get diff for a specific file in a worktree
   *
   * @param worktreePath - Path to the worktree
   * @param filePath - Relative path to the file
   * @returns File diff result with old and new content
   */
  async getFileDiff(worktreePath: string, filePath: string): Promise<FileDiffResult> {
    if (!worktreePath) {
      throw new Error('worktreePath is required');
    }
    if (!filePath) {
      throw new Error('filePath is required');
    }

    // Validate file path for security
    this.validateFilePath(filePath);

    logger.info('Getting file diff', { worktreePath, filePath });

    const git: SimpleGit = simpleGit(worktreePath);

    try {
      // Get base branch
      const baseBranch = await this.inferBaseBranch(git);

      // Get old content from base branch
      let oldContent = '';
      let status: 'added' | 'modified' | 'deleted' = 'modified';

      try {
        oldContent = await git.show([`${baseBranch}:${filePath}`]);
      } catch {
        // File doesn't exist in base branch - it's a new file
        status = 'added';
      }

      // Get new content from current working tree
      let newContent = '';
      const absolutePath = path.join(worktreePath, filePath);
      try {
        if (fs.existsSync(absolutePath)) {
          newContent = fs.readFileSync(absolutePath, 'utf-8');
        } else {
          // File was deleted
          status = 'deleted';
        }
      } catch {
        status = 'deleted';
      }

      // Get the diff - use most efficient approach based on status
      let diff = '';

      // Try diff between base branch and HEAD (committed changes)
      try {
        diff = await git.diff([`${baseBranch}...HEAD`, '--', filePath]);
        if (diff.trim()) {
          // Found committed diff, return early
          return {
            filePath,
            diff,
            oldContent,
            newContent,
            status,
          };
        }
      } catch {
        // Ignore error, try next approach
      }

      // Check for uncommitted changes (working directory)
      try {
        diff = await git.diff(['--', filePath]);
        if (diff.trim()) {
          // Found working directory diff, return early
          return {
            filePath,
            diff,
            oldContent,
            newContent,
            status,
          };
        }
      } catch {
        // Ignore error
      }

      // Check staged changes
      try {
        diff = await git.diff(['--cached', '--', filePath]);
        if (diff.trim()) {
          // Found staged diff, return early
          return {
            filePath,
            diff,
            oldContent,
            newContent,
            status,
          };
        }
      } catch {
        // Ignore error
      }

      // If still no diff but file is new (untracked), generate a simple diff
      if (status === 'added' && newContent) {
        const lines = newContent.split('\n');
        diff = `diff --git a/${filePath} b/${filePath}
new file mode 100644
--- /dev/null
+++ b/${filePath}
@@ -0,0 +1,${lines.length} @@
${lines.map(line => '+' + line).join('\n')}`;

        return {
          filePath,
          diff,
          oldContent,
          newContent,
          status,
        };
      }

      // If file is deleted, generate deletion diff
      if (status === 'deleted' && oldContent) {
        const lines = oldContent.split('\n');
        diff = `diff --git a/${filePath} b/${filePath}
deleted file mode 100644
--- a/${filePath}
+++ /dev/null
@@ -1,${lines.length} +0,0 @@
${lines.map(line => '-' + line).join('\n')}`;

        return {
          filePath,
          diff,
          oldContent,
          newContent,
          status,
        };
      }

      // If we have both old and new content but still no diff, generate one
      if (oldContent !== newContent) {
        // Use git diff to generate the diff between old and new content
        try {
          diff = await git.diff([`${baseBranch}`, '--', filePath]);
          if (diff.trim()) {
            return {
              filePath,
              diff,
              oldContent,
              newContent,
              status,
            };
          }
        } catch {
          // Log warning and fall back to manual diff generation
          logger.warn('Git diff failed, generating manual diff', { filePath });

          // Generate a simple unified diff manually
          // Note: This is a crude fallback and may not be accurate for all cases
          const oldLines = oldContent.split('\n');
          const newLines = newContent.split('\n');
          diff = `diff --git a/${filePath} b/${filePath}
--- a/${filePath}
+++ b/${filePath}
@@ -1,${oldLines.length} +1,${newLines.length} @@
${oldLines.map(line => '-' + line).join('\n')}
${newLines.map(line => '+' + line).join('\n')}`;
        }
      }

      return {
        filePath,
        diff,
        oldContent,
        newContent,
        status,
      };
    } catch (error) {
      logger.error('Failed to get file diff', { error, worktreePath, filePath });
      throw new Error(`Failed to get file diff: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get commits in the worktree branch that are not in the base branch
   *
   * @param worktreePath - Path to the worktree
   * @returns Array of commit information
   */
  async getWorktreeCommits(worktreePath: string): Promise<CommitInfo[]> {
    if (!worktreePath) {
      throw new Error('worktreePath is required');
    }

    logger.info('Getting worktree commits', { worktreePath });

    const git: SimpleGit = simpleGit(worktreePath);

    try {
      // Get current branch and base branch
      const currentBranch = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim();
      const baseBranch = await this.inferBaseBranch(git);

      // Get commits with file information in a single command
      // Format: hash, short hash, subject, author, date, then files separated by NUL
      // Use %x00 (NUL) as delimiter to handle special characters in messages
      const logOutput = await git.raw([
        'log',
        `${baseBranch}..${currentBranch}`,
        '--name-only',
        '--format=%H%x00%h%x00%s%x00%an%x00%aI%x00',
      ]);

      const commits: CommitInfo[] = [];

      if (logOutput.trim()) {
        // Split by double newline to separate commits
        const commitBlocks = logOutput.trim().split('\n\n');

        for (const block of commitBlocks) {
          const lines = block.split('\n');
          if (lines.length === 0) continue;

          // First line contains commit metadata
          const [hash, shortHash, message, author, dateStr] = lines[0].split('\x00');

          if (!hash) continue;

          // Remaining lines are files (skip empty lines)
          const files = lines.slice(1).filter(Boolean);

          commits.push({
            hash,
            shortHash,
            message,
            author,
            date: new Date(dateStr),
            files,
          });
        }
      }

      logger.info('Found worktree commits', { count: commits.length });
      return commits;
    } catch (error) {
      logger.error('Failed to get worktree commits', { error, worktreePath });
      throw new Error(`Failed to get worktree commits: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Commit changes in the worktree
   *
   * @param worktreePath - Path to the worktree
   * @param message - Commit message
   * @param files - Optional array of specific files to commit (commits all changes if not specified)
   * @returns Commit information
   */
  async commitChanges(worktreePath: string, message: string, files?: string[]): Promise<CommitInfo> {
    if (!worktreePath) {
      throw new Error('worktreePath is required');
    }
    if (!message) {
      throw new Error('message is required');
    }

    logger.info('Committing changes', { worktreePath, message, fileCount: files?.length });

    const git: SimpleGit = simpleGit(worktreePath);

    try {
      // Stage files
      if (files && files.length > 0) {
        await git.add(files);
      } else {
        // Stage all changes
        await git.add('-A');
      }

      // Check if there are staged changes
      const status = await git.status();
      if (status.staged.length === 0) {
        throw new Error('No changes to commit');
      }

      // Commit
      const commitResult = await git.commit(message);

      if (!commitResult.commit) {
        throw new Error('Commit failed - no commit hash returned');
      }

      // Get commit details
      const logResult = await git.log(['-1', commitResult.commit]);
      const commit = logResult.latest;

      if (!commit) {
        throw new Error('Failed to get commit details');
      }

      // Get files in commit
      const filesOutput = await git.raw(['show', '--name-only', '--format=', commit.hash]);
      const committedFiles = filesOutput.trim().split('\n').filter(Boolean);

      logger.info('Changes committed successfully', { hash: commit.hash });

      return {
        hash: commit.hash,
        shortHash: commit.hash.substring(0, 7),
        message: commit.message,
        author: commit.author_name,
        date: new Date(commit.date),
        files: committedFiles,
      };
    } catch (error) {
      logger.error('Failed to commit changes', { error, worktreePath });
      throw new Error(`Failed to commit changes: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Merge worktree branch into the base branch
   *
   * @param worktreePath - Path to the worktree
   * @param mainRepoPath - Path to the main repository
   * @returns Merge result
   */
  async mergeToMain(worktreePath: string, mainRepoPath: string): Promise<MergeResult> {
    if (!worktreePath) {
      throw new Error('worktreePath is required');
    }
    if (!mainRepoPath) {
      throw new Error('mainRepoPath is required');
    }

    logger.info('Merging worktree to main', { worktreePath, mainRepoPath });

    const worktreeGit: SimpleGit = simpleGit(worktreePath);
    const mainGit: SimpleGit = simpleGit(mainRepoPath);

    try {
      // Check for uncommitted changes in worktree
      const worktreeStatus = await worktreeGit.status();
      if (!worktreeStatus.isClean()) {
        return {
          success: false,
          message: 'Cannot merge: uncommitted changes in worktree. Please commit or discard changes first.',
        };
      }

      // Check for uncommitted changes in main repo
      const mainStatus = await mainGit.status();
      if (!mainStatus.isClean()) {
        return {
          success: false,
          message: 'Cannot merge: uncommitted changes in main repository. Please commit or stash changes first.',
        };
      }

      // Get worktree branch name
      const worktreeBranch = await worktreeGit.revparse(['--abbrev-ref', 'HEAD']);
      const baseBranch = await this.inferBaseBranch(mainGit);

      logger.info('Merge details', { worktreeBranch, baseBranch });

      // Switch to base branch in main repo
      await mainGit.checkout(baseBranch);

      // Pull latest changes - fail if this fails to avoid merging stale code
      try {
        await mainGit.pull('origin', baseBranch);
        logger.info('Successfully pulled latest changes from remote');
      } catch (pullError) {
        logger.error('Failed to pull latest changes', { pullError });
        return {
          success: false,
          message: 'Failed to pull latest changes from remote. Please update the main branch manually before merging.',
        };
      }

      // Attempt merge
      try {
        await mainGit.merge([worktreeBranch, '--no-ff', '-m', `Merge branch '${worktreeBranch}'`]);

        logger.info('Merge completed successfully');
        return {
          success: true,
          message: `Successfully merged ${worktreeBranch} into ${baseBranch}`,
        };
      } catch (mergeError) {
        // Check for merge conflicts
        const status = await mainGit.status();
        if (status.conflicted.length > 0) {
          // Abort the merge
          await mainGit.merge(['--abort']);

          return {
            success: false,
            message: 'Merge conflicts detected. Please resolve conflicts manually.',
            conflictedFiles: status.conflicted,
          };
        }

        throw mergeError;
      }
    } catch (error) {
      logger.error('Failed to merge to main', { error, worktreePath });
      throw new Error(`Failed to merge to main: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get all changed files in the worktree compared to base branch
   *
   * @param worktreePath - Path to the worktree
   * @returns Array of changed file paths with their status
   */
  async getChangedFiles(worktreePath: string): Promise<Array<{ path: string; status: 'added' | 'modified' | 'deleted' }>> {
    if (!worktreePath) {
      throw new Error('worktreePath is required');
    }

    logger.info('Getting changed files', { worktreePath });

    const git: SimpleGit = simpleGit(worktreePath);

    try {
      // Get only uncommitted changes from git status
      // This shows files that need to be staged/committed, not the full branch diff
      const gitStatus = await git.status();

      const changedFiles: Array<{ path: string; status: 'added' | 'modified' | 'deleted' }> = [];

      for (const file of gitStatus.files) {
        let status: 'added' | 'modified' | 'deleted';

        if (file.index === 'D' || file.working_dir === 'D') {
          status = 'deleted';
        } else if (file.index === '?' || file.index === 'A') {
          status = 'added';
        } else {
          status = 'modified';
        }

        changedFiles.push({ path: file.path, status });
      }

      logger.info('Found changed files', { count: changedFiles.length });
      return changedFiles;
    } catch (error) {
      logger.error('Failed to get changed files', { error, worktreePath });
      throw new Error(`Failed to get changed files: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

// Export singleton instance
export const gitWorktreeService = new GitWorktreeService();
