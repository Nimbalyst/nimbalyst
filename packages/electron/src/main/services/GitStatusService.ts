import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join, resolve } from 'path';

export interface FileGitStatus {
  filePath: string;
  status: 'modified' | 'staged' | 'untracked' | 'unchanged' | 'deleted';
  gitStatusCode?: string; // Raw git status code (M, A, D, ??, etc.)
}

export interface GitStatusResult {
  [filePath: string]: FileGitStatus;
}

/**
 * GitStatusService provides git status information for files.
 *
 * Inspired by Crystal's GitStatusManager, but simplified for our use case
 * of showing git status for edited files in the AgenticPanel.
 */
export class GitStatusService {
  private cache: Map<string, { status: GitStatusResult; timestamp: number }> = new Map();
  private readonly CACHE_TTL_MS = 5000; // 5 seconds cache

  /**
   * Get git status for a list of files in a workspace.
   *
   * @param workspacePath The workspace/repository path
   * @param filePaths Array of file paths (relative to workspace) to check
   * @returns Map of file paths to their git status
   */
  async getFileStatus(workspacePath: string, filePaths: string[]): Promise<GitStatusResult> {
    if (!workspacePath || filePaths.length === 0) {
      return {};
    }

    // Check if this is a git repository
    if (!this.isGitRepository(workspacePath)) {
      // Not a git repo, return all as unchanged
      return this.createEmptyResult(filePaths);
    }

    // Check cache
    const cacheKey = `${workspacePath}:${filePaths.sort().join(',')}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
      return cached.status;
    }

    try {
      // Get git status for the entire repository using porcelain format
      const statusOutput = this.executeGitStatus(workspacePath);

      // Parse status output
      const statusMap = this.parseGitStatus(statusOutput);

      // Build result for requested files
      const result: GitStatusResult = {};
      for (const filePath of filePaths) {
        const normalizedPath = this.normalizePath(filePath);
        result[filePath] = statusMap.get(normalizedPath) || {
          filePath,
          status: 'unchanged'
        };
      }

      // Cache the result
      this.cache.set(cacheKey, { status: result, timestamp: Date.now() });

      return result;
    } catch (error) {
      console.error('[GitStatusService] Error getting git status:', error);
      // On error, return empty status (treat as unchanged)
      return this.createEmptyResult(filePaths);
    }
  }

  /**
   * Execute git status --porcelain command and return raw output
   * @private
   */
  private executeGitStatus(workspacePath: string): string {
    // IMPORTANT: Don't trim() here as it removes the leading space from status codes
    return execSync('git status --porcelain', {
      cwd: workspacePath,
      encoding: 'utf8',
      timeout: 5000 // 5 second timeout
    });
  }

  /**
   * Parse git status --porcelain output into a map.
   *
   * Format: XY PATH
   * where XY is a two-character status code:
   * - First character: status in index (staged)
   * - Second character: status in working tree
   *
   * Common codes:
   * - ' M' = modified in working tree (not staged)
   * - 'M ' = modified and staged
   * - 'MM' = modified in both index and working tree
   * - 'A ' = added to index
   * - 'D ' = deleted from index
   * - ' D' = deleted in working tree
   * - '??' = untracked
   */
  private parseGitStatus(statusOutput: string): Map<string, FileGitStatus> {
    const statusMap = new Map<string, FileGitStatus>();

    if (!statusOutput) {
      return statusMap;
    }

    const lines = statusOutput.split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;

      // Git status format: XY PATH (or XY PATH -> NEWPATH for renames)
      // where XY is 2 characters and there's a single space separator
      const code = line.substring(0, 2);
      let filePath = line.substring(3);

      // Handle renames (R  old -> new)
      if (code.startsWith('R')) {
        const parts = filePath.split(' -> ');
        filePath = parts[parts.length - 1]; // Use new path
      }

      filePath = this.normalizePath(filePath);

      // Determine status from code
      let status: FileGitStatus['status'];
      if (code === '??') {
        status = 'untracked';
      } else if (code === ' D' || code === 'D ' || code === 'DD') {
        status = 'deleted';
      } else if (code[0] !== ' ') {
        // First character not space = staged
        status = 'staged';
      } else if (code[1] !== ' ') {
        // Second character not space = modified in working tree
        status = 'modified';
      } else {
        status = 'unchanged';
      }

      statusMap.set(filePath, {
        filePath,
        status,
        gitStatusCode: code
      });
    }

    return statusMap;
  }

  /**
   * Check if a directory is a git repository
   */
  private isGitRepository(workspacePath: string): boolean {
    try {
      const gitDir = join(workspacePath, '.git');
      return existsSync(gitDir);
    } catch {
      return false;
    }
  }

  /**
   * Normalize file path (remove leading ./, handle quotes, etc.)
   */
  private normalizePath(filePath: string): string {
    // Remove quotes that git adds for paths with spaces
    let normalized = filePath.replace(/^"|"$/g, '');

    // Remove leading ./
    if (normalized.startsWith('./')) {
      normalized = normalized.substring(2);
    }

    return normalized;
  }

  /**
   * Create empty result (all files as unchanged)
   */
  private createEmptyResult(filePaths: string[]): GitStatusResult {
    const result: GitStatusResult = {};
    for (const filePath of filePaths) {
      result[filePath] = {
        filePath,
        status: 'unchanged'
      };
    }
    return result;
  }

  /**
   * Get all uncommitted files in the workspace.
   * Returns files that are either:
   * - Untracked (not yet in git)
   * - Modified and not committed
   *
   * Does NOT include:
   * - Gitignored files
   * - Unchanged files
   *
   * @param workspacePath The workspace/repository path
   * @returns Array of file paths (relative to workspace) that have uncommitted changes
   */
  async getUncommittedFiles(workspacePath: string): Promise<string[]> {
    if (!workspacePath) {
      return [];
    }

    // Check if this is a git repository
    if (!this.isGitRepository(workspacePath)) {
      return [];
    }

    // Check cache
    const cacheKey = `${workspacePath}:uncommitted`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
      // Cache stores GitStatusResult, but we need string[] for uncommitted files
      // Convert to array of file paths
      return Object.keys(cached.status);
    }

    try {
      // Get git status for the entire repository using porcelain format
      const statusOutput = this.executeGitStatus(workspacePath);

      // Parse status output
      const statusMap = this.parseGitStatus(statusOutput);

      // Filter for uncommitted files (untracked or modified, not deleted)
      // Convert relative paths to absolute paths using path.resolve
      const uncommittedFiles: string[] = [];
      const cacheResult: GitStatusResult = {};

      for (const [relativePath, fileStatus] of statusMap.entries()) {
        // Include if untracked, modified, or staged (but not deleted or unchanged)
        if (fileStatus.status === 'untracked' ||
            fileStatus.status === 'modified' ||
            fileStatus.status === 'staged') {
          // Convert to absolute path (git returns paths relative to workspace)
          const absolutePath = resolve(workspacePath, relativePath);
          uncommittedFiles.push(absolutePath);

          // Cache with absolute path as key
          cacheResult[absolutePath] = {
            ...fileStatus,
            filePath: absolutePath
          };
        }
      }
      this.cache.set(cacheKey, { status: cacheResult, timestamp: Date.now() });

      return uncommittedFiles;
    } catch (error) {
      console.error('[GitStatusService] Error getting uncommitted files:', error);
      // On error, return empty array
      return [];
    }
  }

  /**
   * Check if a workspace is a git repository
   *
   * @param workspacePath The workspace path to check
   * @returns True if workspace is a git repository
   */
  async isGitRepo(workspacePath: string): Promise<boolean> {
    return this.isGitRepository(workspacePath);
  }

  /**
   * Clear the cache for a specific workspace or all workspaces
   */
  clearCache(workspacePath?: string): void {
    if (workspacePath) {
      // Clear cache entries for this workspace
      const keysToDelete: string[] = [];
      for (const key of this.cache.keys()) {
        if (key.startsWith(`${workspacePath}:`)) {
          keysToDelete.push(key);
        }
      }
      keysToDelete.forEach(key => this.cache.delete(key));
    } else {
      // Clear entire cache
      this.cache.clear();
    }
  }
}
