/**
 * Platform-agnostic file system service interface
 */

export interface FileSearchOptions {
  path?: string;
  filePattern?: string;
  caseSensitive?: boolean;
  maxResults?: number;
}

export interface FileSearchResult {
  file: string;
  line: number;
  content: string;
}

export interface FileListOptions {
  path?: string;
  pattern?: string;
  recursive?: boolean;
  includeHidden?: boolean;
  maxDepth?: number;
}

export interface FileInfo {
  path: string;
  name?: string;
  type: 'file' | 'directory';
  size: number;
  modified: string;
}

export interface FileReadOptions {
  encoding?: 'utf-8' | 'ascii' | 'base64' | 'hex' | 'latin1';
}

export interface FileSystemService {
  /**
   * Get the current workspace path
   */
  getWorkspacePath(): string | null;

  /**
   * Search for files containing specific text
   */
  searchFiles(query: string, options?: FileSearchOptions): Promise<{
    success: boolean;
    results?: FileSearchResult[];
    totalResults?: number;
    error?: string;
  }>;

  /**
   * List files and directories
   */
  listFiles(options?: FileListOptions): Promise<{
    success: boolean;
    files?: FileInfo[];
    error?: string;
  }>;

  /**
   * Read file contents
   */
  readFile(path: string, options?: FileReadOptions): Promise<{
    success: boolean;
    content?: string;
    size?: number;
    truncated?: boolean;
    error?: string;
  }>;
}

// Registry for file system service
let fileSystemService: FileSystemService | null = null;

export function setFileSystemService(service: FileSystemService): void {
  fileSystemService = service;
}

export function getFileSystemService(): FileSystemService | null {
  return fileSystemService;
}

export function clearFileSystemService(): void {
  fileSystemService = null;
}