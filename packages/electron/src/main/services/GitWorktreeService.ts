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
  baseBranch?: string; // Branch to base the worktree on (defaults to repo root's current branch)
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

    // Determine base branch - use the repo root's current branch (not hardcoded)
    let baseBranch: string;
    if (options.baseBranch) {
      baseBranch = options.baseBranch;
    } else {
      // Get the current branch of the repo root
      baseBranch = await this.getCurrentBranch(git);
    }
    logger.info('Using base branch', { baseBranch });

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
  async getWorktreeStatus(worktreePath: string, baseBranchOverride?: string): Promise<WorktreeStatus> {
    if (!worktreePath) {
      throw new Error('worktreePath is required');
    }

    logger.info('Getting worktree status', { worktreePath, baseBranchOverride });

    const git: SimpleGit = simpleGit(worktreePath);

    try {
      // Get current branch
      const currentBranch = await git.revparse(['--abbrev-ref', 'HEAD']);
      logger.info('Current branch', { currentBranch });

      // Get status to check for uncommitted changes
      const status = await git.status();
      const hasUncommittedChanges = !status.isClean();
      const modifiedFileCount = status.files.length;

      // Use provided base branch (from database) or fall back to inferring
      const baseBranch = baseBranchOverride || await this.inferBaseBranch(git);
      logger.info('Using base branch', { baseBranch });

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
    // 128 adjectives x 128 nouns = 16,384 combinations
    const adjectives = [
      // Nature/weather (16)
      'swift', 'bright', 'calm', 'cool', 'warm', 'clear', 'wild', 'crisp',
      'fresh', 'misty', 'sunny', 'windy', 'frosty', 'dusty', 'hazy', 'foggy',
      // Character traits (16)
      'bold', 'brave', 'keen', 'wise', 'kind', 'fair', 'quick', 'clever',
      'sharp', 'neat', 'steady', 'loyal', 'humble', 'noble', 'proud', 'silent',
      // Colors/appearance (16)
      'golden', 'silver', 'copper', 'amber', 'azure', 'coral', 'ivory', 'jade',
      'ruby', 'onyx', 'pearl', 'rusty', 'mossy', 'sandy', 'snowy', 'dusky',
      // Size/intensity (16)
      'vast', 'tiny', 'grand', 'mighty', 'gentle', 'fierce', 'subtle', 'vivid',
      'dense', 'sparse', 'ample', 'narrow', 'broad', 'steep', 'hollow', 'solid',
      // Time/age (16)
      'ancient', 'young', 'ageless', 'early', 'late', 'timely', 'lasting', 'brief',
      'sudden', 'gradual', 'constant', 'fleeting', 'endless', 'daily', 'nightly', 'weekly',
      // Texture/material (16)
      'smooth', 'rough', 'soft', 'hard', 'silky', 'velvet', 'glossy', 'matte',
      'grainy', 'polished', 'woven', 'carved', 'molten', 'frozen', 'liquid', 'crystal',
      // Sound/movement (16)
      'quiet', 'loud', 'still', 'moving', 'dancing', 'flowing', 'rushing', 'gliding',
      'soaring', 'drifting', 'spinning', 'rolling', 'leaping', 'resting', 'humming', 'singing',
      // Abstract qualities (16)
      'pure', 'true', 'deep', 'light', 'dark', 'bright', 'dim', 'radiant',
      'serene', 'tranquil', 'vibrant', 'mellow', 'zesty', 'tangy', 'savory', 'earthy',
    ];

    const nouns = [
      // Birds (16)
      'falcon', 'hawk', 'eagle', 'raven', 'owl', 'crane', 'finch', 'sparrow',
      'heron', 'dove', 'lark', 'wren', 'robin', 'osprey', 'condor', 'cardinal',
      // Landforms (16)
      'mountain', 'valley', 'canyon', 'glacier', 'ridge', 'cliff', 'mesa', 'dune',
      'summit', 'crater', 'bluff', 'gorge', 'basin', 'plateau', 'ravine', 'slope',
      // Water features (16)
      'river', 'stream', 'brook', 'creek', 'lake', 'pond', 'spring', 'bay',
      'cove', 'delta', 'marsh', 'reef', 'tide', 'wave', 'rapids', 'falls',
      // Sky/weather (16)
      'cloud', 'storm', 'thunder', 'wind', 'star', 'moon', 'dawn', 'dusk',
      'aurora', 'comet', 'nova', 'nebula', 'zenith', 'horizon', 'gale', 'breeze',
      // Trees/plants (16)
      'oak', 'pine', 'cedar', 'maple', 'birch', 'willow', 'aspen', 'spruce',
      'elm', 'ash', 'fern', 'moss', 'ivy', 'lotus', 'orchid', 'bamboo',
      // Animals (16)
      'wolf', 'fox', 'bear', 'deer', 'elk', 'moose', 'lynx', 'otter',
      'badger', 'beaver', 'marten', 'ferret', 'mink', 'stoat', 'hare', 'vole',
      // Terrain features (16)
      'path', 'trail', 'pass', 'ford', 'bridge', 'gate', 'arch', 'tower',
      'spire', 'beacon', 'cairn', 'haven', 'grove', 'glade', 'dell', 'hollow',
      // Elements/minerals (16)
      'stone', 'flint', 'quartz', 'granite', 'marble', 'obsidian', 'basalt', 'shale',
      'ember', 'flame', 'spark', 'frost', 'mist', 'vapor', 'smoke', 'shadow',
    ];

    const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];

    return `${adjective}-${noun}`;
  }

  /**
   * Get the current branch of a git repository (private helper)
   * @private
   */
  private async getCurrentBranch(git: SimpleGit): Promise<string> {
    try {
      const branch = await git.revparse(['--abbrev-ref', 'HEAD']);
      return branch.trim();
    } catch (error) {
      logger.error('Failed to get current branch', { error });
      throw new Error(`Failed to get current branch: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get all local branch names (for de-duplication when creating worktrees)
   *
   * @param workspacePath - Path to the git repository
   * @returns Set of branch names (without refs/heads/ prefix)
   */
  async getAllBranchNames(workspacePath: string): Promise<Set<string>> {
    if (!workspacePath) {
      throw new Error('workspacePath is required');
    }

    logger.info('Getting all branch names', { workspacePath });

    const git: SimpleGit = simpleGit(workspacePath);

    try {
      // Get all local branches
      const branchSummary = await git.branchLocal();
      const branchNames = new Set<string>();

      for (const branchName of branchSummary.all) {
        branchNames.add(branchName);

        // Also extract worktree name from worktree branches (worktree/name -> name)
        if (branchName.startsWith('worktree/')) {
          branchNames.add(branchName.substring('worktree/'.length));
        }
      }

      logger.info('Found branch names', { count: branchNames.size });
      return branchNames;
    } catch (error) {
      logger.error('Failed to get branch names', { error, workspacePath });
      throw new Error(`Failed to get branch names: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get all directory names in the worktrees directory (for de-duplication)
   *
   * @param workspacePath - Path to the main git repository
   * @returns Set of existing worktree directory names
   */
  getExistingWorktreeDirectories(workspacePath: string): Set<string> {
    const projectName = path.basename(workspacePath);
    const worktreesDir = path.resolve(workspacePath, '..', `${projectName}_worktrees`);

    const names = new Set<string>();

    if (fs.existsSync(worktreesDir)) {
      try {
        const entries = fs.readdirSync(worktreesDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            names.add(entry.name);
          }
        }
        logger.info('Found existing worktree directories', { count: names.size, worktreesDir });
      } catch (error) {
        logger.warn('Failed to read worktrees directory', { error, worktreesDir });
      }
    }

    return names;
  }

  /**
   * Generate a unique worktree name that doesn't conflict with existing names
   *
   * @param existingNames - Set of names that are already taken (from db, filesystem, branches)
   * @returns A unique worktree name
   */
  generateUniqueWorktreeName(existingNames: Set<string>): string {
    const maxAttempts = 100; // Prevent infinite loop

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const name = this.generateWorktreeName();

      if (!existingNames.has(name)) {
        logger.info('Generated unique worktree name', { name, attempts: attempt + 1 });
        return name;
      }
    }

    // Fallback: append timestamp if we can't find a unique name after many attempts
    const fallbackName = `${this.generateWorktreeName()}-${Date.now()}`;
    logger.warn('Could not find unique name after max attempts, using timestamp fallback', {
      fallbackName,
      existingNamesCount: existingNames.size,
    });
    return fallbackName;
  }

  /**
   * Get the current branch of a repository by path.
   * Public method for use by IPC handlers.
   *
   * @param repoPath - Path to the git repository
   * @returns Current branch name
   */
  async getRepoCurrentBranch(repoPath: string): Promise<string> {
    if (!repoPath) {
      throw new Error('repoPath is required');
    }

    const git: SimpleGit = simpleGit(repoPath);
    return this.getCurrentBranch(git);
  }

  /**
   * Get the base branch for a worktree by reading it from the main repo's current branch.
   * This ensures worktree operations are always relative to the repo root's current branch.
   * @private
   */
  private async inferBaseBranch(git: SimpleGit): Promise<string> {
    // Get the current branch - this is the source of truth
    return this.getCurrentBranch(git);
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
  async getFileDiff(worktreePath: string, filePath: string, baseBranchOverride?: string): Promise<FileDiffResult> {
    if (!worktreePath) {
      throw new Error('worktreePath is required');
    }
    if (!filePath) {
      throw new Error('filePath is required');
    }

    // Validate file path for security
    this.validateFilePath(filePath);

    logger.info('Getting file diff', { worktreePath, filePath, baseBranchOverride });

    const git: SimpleGit = simpleGit(worktreePath);

    try {
      // Use provided base branch (from database) or fall back to inferring
      const baseBranch = baseBranchOverride || await this.inferBaseBranch(git);

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
  async getWorktreeCommits(worktreePath: string, baseBranchOverride?: string): Promise<CommitInfo[]> {
    if (!worktreePath) {
      throw new Error('worktreePath is required');
    }

    logger.info('Getting worktree commits', { worktreePath, baseBranchOverride });

    const git: SimpleGit = simpleGit(worktreePath);

    try {
      // Get current branch and base branch
      const currentBranch = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim();
      // Use provided base branch (from database) or fall back to inferring
      const baseBranch = baseBranchOverride || await this.inferBaseBranch(git);

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
        // Each commit's format line ends with NUL (%x00), so we can split by the NUL-newline pattern
        // The format is: hash\0shorthash\0message\0author\0date\0\nfile1\nfile2\n\nhash2\0...
        // But commits without files won't have the double newline separator
        // Instead, parse by looking for lines that contain NUL characters (metadata lines)
        const allLines = logOutput.trim().split('\n');

        let currentCommit: { parts: string[]; files: string[] } | null = null;

        for (const line of allLines) {
          if (line.includes('\x00')) {
            // This is a metadata line - save previous commit and start new one
            if (currentCommit) {
              const [hash, shortHash, message, author, dateStr] = currentCommit.parts;
              if (hash) {
                let date: Date;
                if (dateStr && dateStr.trim()) {
                  date = new Date(dateStr);
                  if (isNaN(date.getTime())) {
                    logger.warn('Invalid date string from git log, using current date', { dateStr, hash });
                    date = new Date();
                  }
                } else {
                  logger.warn('Missing date string from git log, using current date', { hash, partsCount: currentCommit.parts.length });
                  date = new Date();
                }
                commits.push({
                  hash,
                  shortHash,
                  message,
                  author,
                  date,
                  files: currentCommit.files,
                });
              }
            }
            // Start new commit
            currentCommit = {
              parts: line.split('\x00'),
              files: [],
            };
          } else if (line.trim() && currentCommit) {
            // This is a file line
            currentCommit.files.push(line);
          }
        }

        // Don't forget the last commit
        if (currentCommit) {
          const [hash, shortHash, message, author, dateStr] = currentCommit.parts;
          if (hash) {
            let date: Date;
            if (dateStr && dateStr.trim()) {
              date = new Date(dateStr);
              if (isNaN(date.getTime())) {
                logger.warn('Invalid date string from git log, using current date', { dateStr, hash });
                date = new Date();
              }
            } else {
              logger.warn('Missing date string from git log, using current date', { hash, partsCount: currentCommit.parts.length });
              date = new Date();
            }
            commits.push({
              hash,
              shortHash,
              message,
              author,
              date,
              files: currentCommit.files,
            });
          }
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
      const statusStartTime = Date.now();
      const mainStatus = await mainGit.status();
      const statusDuration = Date.now() - statusStartTime;
      logger.info('Main repo status check complete', { statusDuration, isClean: mainStatus.isClean(), fileCount: mainStatus.files.length });

      // Get worktree branch name and base branch early (need for conflict detection)
      const worktreeBranch = await worktreeGit.revparse(['--abbrev-ref', 'HEAD']);
      const baseBranch = await this.inferBaseBranch(mainGit);

      // CRITICAL: Check if any uncommitted files would be affected by the merge
      // If a file has uncommitted changes AND the worktree branch modifies it, always ask Claude
      if (!mainStatus.isClean()) {
        // Get list of files modified in main (uncommitted)
        const uncommittedFiles = mainStatus.files
          .filter(f => f.working_dir !== ' ' && f.working_dir !== '?') // Modified or new, not untracked
          .map(f => f.path);

        if (uncommittedFiles.length > 0) {
          logger.info('Found uncommitted changes in main', { uncommittedFiles });

          // Get list of files changed in worktree branch compared to base
          try {
            const worktreeDiff = await mainGit.diff([baseBranch, worktreeBranch, '--name-only']);
            const worktreeChangedFiles = worktreeDiff.split('\n').filter(f => f.trim().length > 0);

            logger.info('Files changed in worktree branch', { worktreeChangedFiles });

            // Check if any uncommitted files are also changed in worktree
            const overlappingFiles = uncommittedFiles.filter(f => worktreeChangedFiles.includes(f));

            if (overlappingFiles.length > 0) {
              // Same file(s) modified in both places - always ask Claude to handle it
              logger.warn('Files modified in both main (uncommitted) and worktree (committed)', { overlappingFiles });
              return {
                success: false,
                message: 'merge-conflict-detected',
                conflictedFiles: overlappingFiles,
              };
            }
          } catch (diffError) {
            logger.error('Failed to check worktree changes', { diffError });
            // Fall through to stash and merge
          }
        }

        // No overlapping files - safe to auto-stash
        logger.info('Auto-stashing uncommitted changes in main repository', { fileCount: mainStatus.files.length });
        const stashStartTime = Date.now();
        try {
          // Don't use -u flag to avoid stashing large untracked files (performance issue)
          await mainGit.stash(['push', '-m', 'Auto-stash before merge']);
          const stashDuration = Date.now() - stashStartTime;
          logger.info('Auto-stash successful', { stashDuration });
        } catch (stashError) {
          logger.error('Failed to auto-stash changes', { stashError });

          // Check if this is a merge conflict preventing stash
          const errorMessage = stashError instanceof Error ? stashError.message : String(stashError);
          if (errorMessage.includes('needs merge') || errorMessage.includes('needs update')) {
            // There are merge conflicts in the main repository
            const conflictedFiles = mainStatus.conflicted || [];

            // Return a special error that the IPC handler can detect
            return {
              success: false,
              message: 'merge-conflict-in-main',
              conflictedFiles,
            };
          }

          return {
            success: false,
            message: 'Cannot merge: uncommitted changes in main repository and auto-stash failed. Please commit or stash changes manually.',
          };
        }
      }

      logger.info('Merge details', { worktreeBranch, baseBranch });

      // Switch to base branch in main repo
      const checkoutStartTime = Date.now();
      await mainGit.checkout(baseBranch);
      const checkoutDuration = Date.now() - checkoutStartTime;
      logger.info('Checkout complete', { checkoutDuration, baseBranch });

      // Attempt merge (no remote operations - purely local)
      // Allow fast-forward when possible to keep history clean
      // If base branch has diverged, a merge commit will be created automatically
      try {
        const mergeStartTime = Date.now();
        await mainGit.merge([worktreeBranch]);
        const mergeDuration = Date.now() - mergeStartTime;

        logger.info('Merge completed successfully', { mergeDuration });

        // Pop the stash if we auto-stashed
        if (didStash) {
          try {
            const popStartTime = Date.now();
            await mainGit.stash(['pop']);
            const popDuration = Date.now() - popStartTime;
            logger.info('Auto-stash popped successfully', { popDuration });
          } catch (popError) {
            logger.warn('Failed to pop stash after merge', { popError });
            return {
              success: true,
              message: `Successfully merged ${worktreeBranch} into ${baseBranch}. Warning: Auto-stashed changes could not be restored automatically. Use 'git stash pop' to restore them.`,
            };
          }
          return {
            success: true,
            message: `Successfully merged ${worktreeBranch} into ${baseBranch}. Auto-stashed changes have been restored.`,
          };
        }

        return {
          success: true,
          message: `Successfully merged ${worktreeBranch} into ${baseBranch}`,
        };
      } catch (mergeError) {
        // Check for merge conflicts
        const status = await mainGit.status();
        if (status.conflicted.length > 0) {
          // Abort the merge first, before restoring stash
          await mainGit.merge(['--abort']);

          // If merge failed and we stashed, try to restore the stash AFTER abort
          if (didStash) {
            try {
              await mainGit.stash(['pop']);
              logger.info('Auto-stash popped after merge abort');
            } catch (popError) {
              logger.warn('Failed to pop stash after merge abort', { popError });
            }
          }

          return {
            success: false,
            message: 'Merge conflicts detected. Please resolve conflicts manually.',
            conflictedFiles: status.conflicted,
          };
        }

        // Non-conflict merge error - restore stash before throwing
        if (didStash) {
          try {
            await mainGit.stash(['pop']);
            logger.info('Auto-stash popped after non-conflict merge failure');
          } catch (popError) {
            logger.warn('Failed to pop stash after merge failure', { popError });
          }
        }

        throw mergeError;
      }
    } catch (error) {
      logger.error('Failed to merge to main', { error, worktreePath });
      throw new Error(`Failed to merge to main: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Rebase the worktree branch onto the latest base branch
   * This brings in any new commits from the base branch into the worktree
   *
   * @param worktreePath - Path to the worktree
   * @param baseBranch - The base branch to rebase onto (from database)
   * @returns Rebase result
   */
  async rebaseFromBase(worktreePath: string, baseBranch: string): Promise<{ success: boolean; message: string }> {
    if (!worktreePath) {
      throw new Error('worktreePath is required');
    }
    if (!baseBranch) {
      throw new Error('baseBranch is required');
    }

    logger.info('Rebasing worktree from base branch', { worktreePath, baseBranch });

    const git: SimpleGit = simpleGit(worktreePath);

    try {
      // Check for uncommitted changes
      const status = await git.status();
      if (!status.isClean()) {
        return {
          success: false,
          message: 'Cannot rebase: uncommitted changes in worktree. Please commit or discard changes first.',
        };
      }

      const currentBranch = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim();
      logger.info('Rebase details', { currentBranch, baseBranch });

      // Perform the rebase
      try {
        await git.rebase([baseBranch]);

        logger.info('Rebase completed successfully');
        return {
          success: true,
          message: `Successfully rebased ${currentBranch} onto ${baseBranch}`,
        };
      } catch (rebaseError) {
        // Check for rebase conflicts
        const rebaseStatus = await git.status();
        if (rebaseStatus.conflicted.length > 0) {
          // Abort the rebase
          await git.rebase(['--abort']);

          return {
            success: false,
            message: `Rebase conflicts detected in ${rebaseStatus.conflicted.length} file(s). Please resolve conflicts manually using git rebase.`,
          };
        }

        throw rebaseError;
      }
    } catch (error) {
      logger.error('Failed to rebase from base', { error, worktreePath, baseBranch });
      throw new Error(`Failed to rebase: ${error instanceof Error ? error.message : String(error)}`);
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

  /**
   * Check if commits exist on other branches besides the current one
   *
   * @param worktreePath - Path to the worktree
   * @param commitHashes - Array of commit hashes to check
   * @returns Whether any commits exist on other branches
   */
  async checkCommitsExistElsewhere(worktreePath: string, commitHashes: string[]): Promise<boolean> {
    if (!worktreePath) {
      throw new Error('worktreePath is required');
    }

    if (!commitHashes || commitHashes.length === 0) {
      return false;
    }

    logger.info('Checking if commits exist on other branches', { worktreePath, commitCount: commitHashes.length });

    const git: SimpleGit = simpleGit(worktreePath);

    try {
      // Get current branch
      const currentBranch = await git.revparse(['--abbrev-ref', 'HEAD']);

      // For each commit, check if it exists on any branch other than current
      for (const hash of commitHashes) {
        // Get all branches that contain this commit
        const result = await git.raw(['branch', '--contains', hash, '--all']);
        const branches = result.split('\n').map(b => b.trim().replace(/^\* /, ''));

        // Filter out current branch and check if commit exists elsewhere
        const otherBranches = branches.filter(b =>
          b &&
          b !== currentBranch &&
          !b.startsWith('remotes/origin/' + currentBranch)
        );

        if (otherBranches.length > 0) {
          logger.info('Commit exists on other branches', { hash, otherBranches });
          return true;
        }
      }

      return false;
    } catch (error) {
      logger.error('Failed to check commit existence', { error, worktreePath });
      // If check fails, return false to allow squashing (user can proceed at own risk)
      return false;
    }
  }

  /**
   * Squash multiple commits into a single commit
   *
   * @param worktreePath - Path to the worktree
   * @param commitHashes - Array of commit hashes to squash (must be consecutive)
   * @param message - Commit message for the squashed commit
   * @returns The new commit hash
   */
  async squashCommits(worktreePath: string, commitHashes: string[], message: string): Promise<string> {
    if (!worktreePath) {
      throw new Error('worktreePath is required');
    }

    if (!commitHashes || commitHashes.length < 2) {
      throw new Error('At least 2 commits are required for squashing');
    }

    if (!message) {
      throw new Error('Commit message is required');
    }

    logger.info('Squashing commits', { worktreePath, commitCount: commitHashes.length });

    const git: SimpleGit = simpleGit(worktreePath);

    try {
      // Get all commits to validate the selection is consecutive
      const allCommits = await git.log();
      const commitIndices = commitHashes.map(hash => {
        const index = allCommits.all.findIndex(c => c.hash === hash || c.hash.startsWith(hash));
        if (index === -1) {
          throw new Error(`Commit not found: ${hash}`);
        }
        return index;
      });

      // Sort indices to find the range
      commitIndices.sort((a, b) => a - b);

      // Verify commits are consecutive
      for (let i = 1; i < commitIndices.length; i++) {
        if (commitIndices[i] !== commitIndices[i - 1] + 1) {
          throw new Error('Selected commits must be consecutive');
        }
      }

      // Find the oldest commit (highest index) to use as the base
      const oldestIndex = commitIndices[commitIndices.length - 1];
      const oldestCommit = allCommits.all[oldestIndex];

      // Use reset --soft to move HEAD to the commit before the oldest selected commit
      // This keeps all changes from the squashed commits in the staging area
      const baseCommit = oldestCommit.hash + '~1';

      logger.info('Resetting to base commit', { baseCommit });
      await git.reset(['--soft', baseCommit]);

      // Create a new commit with all the changes
      logger.info('Creating squashed commit', { message });
      await git.commit(message);

      // Get the new commit hash
      const newCommit = await git.revparse(['HEAD']);

      logger.info('Successfully squashed commits', { newCommit });
      return newCommit;
    } catch (error) {
      logger.error('Failed to squash commits', { error, worktreePath });
      throw new Error(`Failed to squash commits: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

// Export singleton instance
export const gitWorktreeService = new GitWorktreeService();
