/**
 * Electron implementation of FileSystemService
 *
 * SECURITY: This service implements strict path validation and sandboxing
 * to prevent unauthorized filesystem access. All paths are validated
 * through SafePathValidator before any filesystem operations.
 */

import { readFile, readdir, stat } from 'fs/promises';
import { join, relative, isAbsolute, extname } from 'path';
import { glob } from 'glob';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type {
  FileSystemService,
  FileSearchOptions,
  FileSearchResult,
  FileListOptions,
  FileInfo,
  FileReadOptions
} from '@stravu/runtime';
import { logger } from '../utils/logger';
import { SafePathValidator } from '../security/SafePathValidator';

const execFileAsync = promisify(execFile);

// File extensions to exclude from search
const EXCLUDED_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.ico',
  '.mp3', '.mp4', '.avi', '.mov', '.wmv',
  '.zip', '.tar', '.gz', '.rar', '.7z',
  '.exe', '.dll', '.so', '.dylib',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx',
  '.db', '.sqlite', '.lock'
]);

// Directories to exclude from search
const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.cache',
  'coverage',
  '.vscode',
  '.idea',
  '__pycache__',
  '.DS_Store'
]);

/**
 * Check if a file should be excluded based on extension
 */
function shouldExcludeFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return EXCLUDED_EXTENSIONS.has(ext);
}

/**
 * Check if a directory should be excluded
 */
function shouldExcludeDir(dirName: string): boolean {
  return EXCLUDED_DIRS.has(dirName);
}

export class ElectronFileSystemService implements FileSystemService {
  private workspacePath: string;
  private pathValidator: SafePathValidator;
  private accessLog: Array<{ timestamp: Date; path: string; operation: string; success: boolean }> = [];
  private readonly MAX_LOG_ENTRIES = 1000;

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
    this.pathValidator = new SafePathValidator(workspacePath);
  }

  getWorkspacePath(): string | null {
    return this.workspacePath;
  }

  async searchFiles(query: string, options?: FileSearchOptions): Promise<{
    success: boolean;
    results?: FileSearchResult[];
    totalResults?: number;
    error?: string;
  }> {
    try {
      // Validate search path if provided
      let searchPath = this.workspacePath;
      if (options?.path) {
        const validation = this.pathValidator.validate(options.path);
        if (!validation.isValid) {
          this.logAccess(options.path, 'search', false);
          return {
            success: false,
            error: validation.error || 'Invalid path'
          };
        }
        searchPath = join(this.workspacePath, validation.sanitizedPath!);
      }

      this.logAccess(searchPath, 'search', true);

      // Build ripgrep arguments safely (no shell interpolation)
      const rgArgs = ['--json'];

      if (!options?.caseSensitive) {
        rgArgs.push('-i');
      }

      rgArgs.push('-m', String(options?.maxResults || 50));

      if (options?.filePattern) {
        // Validate file pattern doesn't contain dangerous chars
        if (/[;&|`$]/.test(options.filePattern)) {
          return {
            success: false,
            error: 'Invalid file pattern'
          };
        }
        rgArgs.push('-g', options.filePattern);
      }

      rgArgs.push(query, searchPath);

      logger.ai.info('[FileSystemService] Searching files', {
        query,
        path: SafePathValidator.getSafeLogPath(searchPath),
        args: rgArgs
      });

      const { stdout } = await execFileAsync('rg', rgArgs, {
        maxBuffer: 10 * 1024 * 1024,
        timeout: 30000 // 30 second timeout
      });

      // Parse ripgrep JSON output
      const results: FileSearchResult[] = [];

      for (const line of stdout.split('\n').filter(Boolean)) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === 'match') {
            const filePath = relative(this.workspacePath, parsed.data.path.text);
            results.push({
              file: filePath,
              line: parsed.data.line_number,
              content: parsed.data.lines.text.trim()
            });
          }
        } catch {
          // Ignore parse errors
        }
      }

      return {
        success: true,
        results,
        totalResults: results.length
      };
    } catch (error) {
      logger.ai.error('[FileSystemService] Search failed', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Search failed'
      };
    }
  }

  async listFiles(options?: FileListOptions): Promise<{
    success: boolean;
    files?: FileInfo[];
    error?: string;
  }> {
    try {
      // Validate base path if provided
      let basePath = this.workspacePath;
      if (options?.path) {
        const validation = this.pathValidator.validate(options.path);
        if (!validation.isValid) {
          this.logAccess(options.path, 'list', false);
          return {
            success: false,
            error: validation.error || 'Invalid path'
          };
        }
        basePath = join(this.workspacePath, validation.sanitizedPath!);
      }

      this.logAccess(basePath, 'list', true);

      logger.ai.info('[FileSystemService] Listing files', { path: basePath, pattern: options?.pattern });

      if (options?.pattern && options?.recursive !== false) {
        // Use glob for pattern matching
        const pattern = join(basePath, options.pattern);
        const files = await glob(pattern, {
          ignore: ['**/node_modules/**', '**/.git/**'],
          dot: options?.includeHidden,
          maxDepth: options?.maxDepth || 3
        });

        const results = await Promise.all(files.map(async (filePath) => {
          const stats = await stat(filePath);
          return {
            path: relative(this.workspacePath, filePath),
            type: stats.isDirectory() ? 'directory' : 'file' as const,
            size: stats.size,
            modified: stats.mtime.toISOString()
          };
        }));

        return {
          success: true,
          files: results
        };
      } else {
        // List immediate contents
        const items = await readdir(basePath, { withFileTypes: true });
        const results = await Promise.all(
          items
            .filter(item => {
              if (!options?.includeHidden && item.name.startsWith('.')) {
                return false;
              }
              if (item.isDirectory() && shouldExcludeDir(item.name)) {
                return false;
              }
              return true;
            })
            .map(async (item) => {
              const fullPath = join(basePath, item.name);
              const stats = await stat(fullPath);
              return {
                path: relative(this.workspacePath, fullPath),
                name: item.name,
                type: item.isDirectory() ? 'directory' : 'file' as const,
                size: stats.size,
                modified: stats.mtime.toISOString()
              };
            })
        );

        return {
          success: true,
          files: results.sort((a, b) => {
            // Directories first, then alphabetical
            if (a.type !== b.type) {
              return a.type === 'directory' ? -1 : 1;
            }
            return (a.name || '').localeCompare(b.name || '');
          })
        };
      }
    } catch (error) {
      logger.ai.error('[FileSystemService] List files failed', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list files'
      };
    }
  }

  async readFile(path: string, options?: FileReadOptions): Promise<{
    success: boolean;
    content?: string;
    size?: number;
    truncated?: boolean;
    error?: string;
  }> {
    try {
      // Use SafePathValidator for comprehensive validation
      const validation = this.pathValidator.validate(path);
      if (!validation.isValid) {
        this.logAccess(path, 'read', false);
        logger.ai.warn('[FileSystemService] Read blocked:', {
          path: SafePathValidator.getSafeLogPath(path),
          reason: validation.error,
          violations: validation.violations
        });
        return {
          success: false,
          error: validation.error || 'Invalid path'
        };
      }

      const fullPath = join(this.workspacePath, validation.sanitizedPath!);

      // Check if file should be excluded
      if (shouldExcludeFile(fullPath)) {
        return {
          success: false,
          error: 'File type is not supported for reading'
        };
      }

      this.logAccess(fullPath, 'read', true);
      logger.ai.info('[FileSystemService] Reading file', {
        path: SafePathValidator.getSafeLogPath(fullPath)
      });

      const encoding = (options?.encoding || 'utf-8') as BufferEncoding;
      const content = await readFile(fullPath, encoding);

      // Limit size for very large files
      const maxSize = 1024 * 1024; // 1MB
      if (content.length > maxSize) {
        return {
          success: true,
          content: content.substring(0, maxSize),
          truncated: true,
          size: content.length
        };
      }

      return {
        success: true,
        content,
        size: content.length
      };
    } catch (error) {
      logger.ai.error('[FileSystemService] Read file failed', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to read file'
      };
    }
  }

  /**
   * Log file access attempts for security monitoring
   */
  private logAccess(path: string, operation: string, success: boolean): void {
    const entry = {
      timestamp: new Date(),
      path: SafePathValidator.getSafeLogPath(path),
      operation,
      success
    };

    this.accessLog.push(entry);

    // Trim log if it gets too large
    if (this.accessLog.length > this.MAX_LOG_ENTRIES) {
      this.accessLog = this.accessLog.slice(-this.MAX_LOG_ENTRIES);
    }

    // Log failed attempts at warning level
    if (!success) {
      logger.ai.warn('[FileSystemService] Access denied:', entry);
    }
  }

  /**
   * Get recent access log entries (for security monitoring)
   */
  getAccessLog(limit: number = 100): Array<{ timestamp: Date; path: string; operation: string; success: boolean }> {
    return this.accessLog.slice(-limit);
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    // Clear access log on destroy
    this.accessLog = [];
  }
}