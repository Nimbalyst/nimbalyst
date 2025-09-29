import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { searchFilesTool, listFilesTool, readFileTool, FILE_TOOLS } from '../fileTools';
import {
  setFileSystemService,
  clearFileSystemService,
  type FileSystemService,
} from '../../../core/FileSystemService';

describe('File Tools', () => {
  let mockFileSystemService: FileSystemService;

  beforeEach(() => {
    mockFileSystemService = {
      getWorkspacePath: vi.fn(() => '/test/workspace'),
      searchFiles: vi.fn(async (query, options) => ({
        success: true,
        results: [
          {
            file: 'src/test.ts',
            line: 42,
            content: `console.log("${query}");`,
          },
        ],
        totalResults: 1,
      })),
      listFiles: vi.fn(async (options) => ({
        success: true,
        files: [
          {
            path: 'src/index.ts',
            name: 'index.ts',
            type: 'file' as const,
            size: 1234,
            modified: '2024-01-01T00:00:00Z',
          },
        ],
      })),
      readFile: vi.fn(async (path, options) => ({
        success: true,
        content: `// Content of ${path}`,
        size: 50,
      })),
    };

    setFileSystemService(mockFileSystemService);
  });

  afterEach(() => {
    clearFileSystemService();
    vi.clearAllMocks();
  });

  describe('searchFilesTool', () => {
    it('should have correct metadata', () => {
      expect(searchFilesTool.name).toBe('searchFiles');
      expect(searchFilesTool.description).toContain('Search for files');
      expect(searchFilesTool.parameters.properties).toHaveProperty('query');
      expect(searchFilesTool.parameters.required).toEqual(['query']);
      expect(searchFilesTool.source).toBe('runtime');
    });

    it('should call FileSystemService.searchFiles with correct parameters', async () => {
      const args = {
        query: 'test',
        path: 'src',
        filePattern: '*.ts',
        caseSensitive: true,
        maxResults: 20,
      };

      const result = await searchFilesTool.handler!(args);

      expect(mockFileSystemService.searchFiles).toHaveBeenCalledWith('test', {
        path: 'src',
        filePattern: '*.ts',
        caseSensitive: true,
        maxResults: 20,
      });

      expect(result).toEqual({
        success: true,
        results: [
          {
            file: 'src/test.ts',
            line: 42,
            content: 'console.log("test");',
          },
        ],
        totalResults: 1,
      });
    });

    it('should return error when FileSystemService is not available', async () => {
      clearFileSystemService();

      const result = await searchFilesTool.handler!({ query: 'test' });

      expect(result).toEqual({
        success: false,
        error: 'File system service not available',
      });
    });
  });

  describe('listFilesTool', () => {
    it('should have correct metadata', () => {
      expect(listFilesTool.name).toBe('listFiles');
      expect(listFilesTool.description).toContain('List files and directories');
      expect(listFilesTool.parameters.properties).toHaveProperty('path');
      expect(listFilesTool.parameters.required).toEqual([]);
      expect(listFilesTool.source).toBe('runtime');
    });

    it('should call FileSystemService.listFiles with correct parameters', async () => {
      const args = {
        path: 'src',
        pattern: '*.ts',
        recursive: true,
        includeHidden: false,
        maxDepth: 3,
      };

      const result = await listFilesTool.handler!(args);

      expect(mockFileSystemService.listFiles).toHaveBeenCalledWith({
        path: 'src',
        pattern: '*.ts',
        recursive: true,
        includeHidden: false,
        maxDepth: 3,
      });

      expect(result).toEqual({
        success: true,
        files: [
          {
            path: 'src/index.ts',
            name: 'index.ts',
            type: 'file' as const,
            size: 1234,
            modified: '2024-01-01T00:00:00Z',
          },
        ],
      });
    });

    it('should work with no arguments', async () => {
      const result = await listFilesTool.handler!({});

      expect(mockFileSystemService.listFiles).toHaveBeenCalledWith({
        path: undefined,
        pattern: undefined,
        recursive: undefined,
        includeHidden: undefined,
        maxDepth: undefined,
      });

      expect(result.success).toBe(true);
    });

    it('should return error when FileSystemService is not available', async () => {
      clearFileSystemService();

      const result = await listFilesTool.handler!({});

      expect(result).toEqual({
        success: false,
        error: 'File system service not available',
      });
    });
  });

  describe('readFileTool', () => {
    it('should have correct metadata', () => {
      expect(readFileTool.name).toBe('readFile');
      expect(readFileTool.description).toContain('Read the contents of a file');
      expect(readFileTool.parameters.properties).toHaveProperty('path');
      expect(readFileTool.parameters.properties.encoding.enum).toEqual([
        'utf-8',
        'ascii',
        'base64',
        'hex',
        'latin1',
      ]);
      expect(readFileTool.parameters.required).toEqual(['path']);
      expect(readFileTool.source).toBe('runtime');
    });

    it('should call FileSystemService.readFile with correct parameters', async () => {
      const args = {
        path: 'src/index.ts',
        encoding: 'utf-8',
      };

      const result = await readFileTool.handler!(args);

      expect(mockFileSystemService.readFile).toHaveBeenCalledWith('src/index.ts', {
        encoding: 'utf-8',
      });

      expect(result).toEqual({
        success: true,
        content: '// Content of src/index.ts',
        size: 50,
      });
    });

    it('should use default encoding when not specified', async () => {
      const args = {
        path: 'src/index.ts',
      };

      await readFileTool.handler!(args);

      expect(mockFileSystemService.readFile).toHaveBeenCalledWith('src/index.ts', {
        encoding: undefined,
      });
    });

    it('should return error when FileSystemService is not available', async () => {
      clearFileSystemService();

      const result = await readFileTool.handler!({ path: 'test.txt' });

      expect(result).toEqual({
        success: false,
        error: 'File system service not available',
      });
    });
  });

  describe('FILE_TOOLS export', () => {
    it('should export all three file tools', () => {
      expect(FILE_TOOLS).toHaveLength(3);
      expect(FILE_TOOLS).toContain(searchFilesTool);
      expect(FILE_TOOLS).toContain(listFilesTool);
      expect(FILE_TOOLS).toContain(readFileTool);
    });
  });

  describe('Error handling', () => {
    it('should handle FileSystemService errors for searchFiles', async () => {
      mockFileSystemService.searchFiles = vi.fn(async () => ({
        success: false,
        error: 'Search failed: permission denied',
      }));

      const result = await searchFilesTool.handler!({ query: 'test' });

      expect(result).toEqual({
        success: false,
        error: 'Search failed: permission denied',
      });
    });

    it('should handle FileSystemService errors for listFiles', async () => {
      mockFileSystemService.listFiles = vi.fn(async () => ({
        success: false,
        error: 'Directory not found',
      }));

      const result = await listFilesTool.handler!({});

      expect(result).toEqual({
        success: false,
        error: 'Directory not found',
      });
    });

    it('should handle FileSystemService errors for readFile', async () => {
      mockFileSystemService.readFile = vi.fn(async () => ({
        success: false,
        error: 'File not found',
      }));

      const result = await readFileTool.handler!({ path: 'missing.txt' });

      expect(result).toEqual({
        success: false,
        error: 'File not found',
      });
    });
  });
});