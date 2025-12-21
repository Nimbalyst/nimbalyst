import { describe, it, expect } from 'vitest';
import * as path from 'path';
import {
  normalizePath,
  resolvePath,
  isPathWithinWorkspace,
  checkPath,
  checkPaths,
  allPathsWithinWorkspace,
  getOutsidePaths,
  isSensitivePath,
  getSensitivePaths,
  comprehensivePathCheck,
  checkCommandPaths,
  // Note: isSensitivePath is already imported above
} from '../directoryScope';

describe('directoryScope', () => {
  const workspacePath = '/Users/ghinkle/sources/my-project';

  describe('normalizePath', () => {
    it('should handle simple paths', () => {
      expect(normalizePath('/home/user/project')).toBe('/home/user/project');
    });

    it('should normalize paths with .', () => {
      expect(normalizePath('/home/user/./project')).toBe('/home/user/project');
    });

    it('should normalize paths with ..', () => {
      expect(normalizePath('/home/user/project/../other')).toBe('/home/user/other');
    });

    it('should handle multiple .. segments', () => {
      expect(normalizePath('/home/user/project/src/../../other')).toBe(
        '/home/user/other'
      );
    });

    it('should handle empty path', () => {
      expect(normalizePath('')).toBe('');
    });

    it('should handle trailing slashes', () => {
      const result = normalizePath('/home/user/project/');
      // path.normalize may or may not preserve trailing slash depending on platform
      expect(result.startsWith('/home/user/project')).toBe(true);
    });
  });

  describe('resolvePath', () => {
    it('should return base path for empty input', () => {
      expect(resolvePath('', workspacePath)).toBe(workspacePath);
    });

    it('should resolve absolute paths directly', () => {
      expect(resolvePath('/etc/passwd', workspacePath)).toBe('/etc/passwd');
    });

    it('should resolve relative paths against base', () => {
      expect(resolvePath('src/index.ts', workspacePath)).toBe(
        path.join(workspacePath, 'src/index.ts')
      );
    });

    it('should resolve . correctly', () => {
      expect(resolvePath('.', workspacePath)).toBe(workspacePath);
    });

    it('should resolve .. correctly', () => {
      expect(resolvePath('..', workspacePath)).toBe('/Users/ghinkle/sources');
    });

    it('should resolve complex relative paths', () => {
      expect(resolvePath('./src/../lib/utils.ts', workspacePath)).toBe(
        path.join(workspacePath, 'lib/utils.ts')
      );
    });
  });

  describe('isPathWithinWorkspace', () => {
    it('should return true for paths inside workspace', () => {
      expect(isPathWithinWorkspace('src/index.ts', workspacePath)).toBe(true);
    });

    it('should return true for workspace root', () => {
      expect(isPathWithinWorkspace('.', workspacePath)).toBe(true);
    });

    it('should return true for absolute paths inside workspace', () => {
      expect(
        isPathWithinWorkspace(
          '/Users/ghinkle/sources/my-project/src/index.ts',
          workspacePath
        )
      ).toBe(true);
    });

    it('should return false for paths outside workspace', () => {
      expect(isPathWithinWorkspace('/etc/passwd', workspacePath)).toBe(false);
    });

    it('should return false for parent directory escape', () => {
      expect(isPathWithinWorkspace('../other-project', workspacePath)).toBe(false);
    });

    it('should return false for complex escape attempts', () => {
      expect(
        isPathWithinWorkspace('./src/../../other-project', workspacePath)
      ).toBe(false);
    });

    it('should return false for sibling directories', () => {
      expect(
        isPathWithinWorkspace(
          '/Users/ghinkle/sources/other-project',
          workspacePath
        )
      ).toBe(false);
    });

    it('should not match partial directory names', () => {
      // /Users/ghinkle/sources/my-project-other should NOT match /Users/ghinkle/sources/my-project
      expect(
        isPathWithinWorkspace(
          '/Users/ghinkle/sources/my-project-other',
          workspacePath
        )
      ).toBe(false);
    });

    it('should return false for empty inputs', () => {
      expect(isPathWithinWorkspace('', workspacePath)).toBe(false);
      expect(isPathWithinWorkspace('src/index.ts', '')).toBe(false);
    });

    it('should handle home directory paths (tilde not expanded)', () => {
      // Note: The shell typically expands ~ before we see the path
      // When we receive a literal ~, it's treated as a relative path
      // This test verifies the behavior - the path resolves within workspace
      // The sensitive path check will still flag ~/.ssh as sensitive
      expect(isPathWithinWorkspace('~/.ssh/id_rsa', workspacePath)).toBe(true);
      // But the sensitive check catches it
      expect(isSensitivePath('~/.ssh/id_rsa')).toBe(true);
    });
  });

  describe('checkPath', () => {
    it('should return allowed for valid workspace paths', () => {
      const result = checkPath('src/index.ts', workspacePath);
      expect(result.allowed).toBe(true);
      expect(result.resolvedPath).toBe(path.join(workspacePath, 'src/index.ts'));
    });

    it('should return not allowed for outside paths', () => {
      const result = checkPath('/etc/passwd', workspacePath);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('outside_workspace');
    });

    it('should return not allowed for empty path', () => {
      const result = checkPath('', workspacePath);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('invalid_path');
    });
  });

  describe('checkPaths', () => {
    it('should check multiple paths', () => {
      const results = checkPaths(
        ['src/index.ts', '/etc/passwd', 'lib/utils.ts'],
        workspacePath
      );

      expect(results.get('src/index.ts')?.allowed).toBe(true);
      expect(results.get('/etc/passwd')?.allowed).toBe(false);
      expect(results.get('lib/utils.ts')?.allowed).toBe(true);
    });
  });

  describe('allPathsWithinWorkspace', () => {
    it('should return true when all paths are within workspace', () => {
      expect(
        allPathsWithinWorkspace(
          ['src/index.ts', 'lib/utils.ts', './package.json'],
          workspacePath
        )
      ).toBe(true);
    });

    it('should return false when any path is outside workspace', () => {
      expect(
        allPathsWithinWorkspace(
          ['src/index.ts', '/etc/passwd', 'lib/utils.ts'],
          workspacePath
        )
      ).toBe(false);
    });

    it('should return true for empty array', () => {
      expect(allPathsWithinWorkspace([], workspacePath)).toBe(true);
    });
  });

  describe('getOutsidePaths', () => {
    it('should return paths outside workspace', () => {
      const outside = getOutsidePaths(
        ['src/index.ts', '/etc/passwd', '../other', 'lib/utils.ts'],
        workspacePath
      );

      expect(outside).toContain('/etc/passwd');
      expect(outside).toContain('../other');
      expect(outside).not.toContain('src/index.ts');
      expect(outside).not.toContain('lib/utils.ts');
    });

    it('should return empty array when all paths are within workspace', () => {
      const outside = getOutsidePaths(
        ['src/index.ts', 'lib/utils.ts'],
        workspacePath
      );
      expect(outside).toHaveLength(0);
    });
  });

  describe('isSensitivePath', () => {
    it('should detect SSH directory', () => {
      expect(isSensitivePath('~/.ssh/id_rsa')).toBe(true);
      expect(isSensitivePath('/home/user/.ssh/config')).toBe(true);
    });

    it('should detect AWS credentials', () => {
      expect(isSensitivePath('~/.aws/credentials')).toBe(true);
    });

    it('should detect .env files', () => {
      expect(isSensitivePath('.env')).toBe(true);
      expect(isSensitivePath('.env.local')).toBe(true);
      expect(isSensitivePath('.env.production')).toBe(true);
    });

    it('should detect /etc paths', () => {
      expect(isSensitivePath('/etc/passwd')).toBe(true);
      expect(isSensitivePath('/etc/shadow')).toBe(true);
    });

    it('should detect paths with sensitive keywords', () => {
      expect(isSensitivePath('/path/to/password.txt')).toBe(true);
      expect(isSensitivePath('/path/to/credentials.json')).toBe(true);
      expect(isSensitivePath('/path/to/secret.key')).toBe(true);
    });

    it('should not flag normal paths', () => {
      expect(isSensitivePath('src/index.ts')).toBe(false);
      expect(isSensitivePath('/home/user/project/package.json')).toBe(false);
    });

    it('should detect hidden config files in home directory', () => {
      expect(isSensitivePath('/Users/ghinkle/.bashrc')).toBe(true);
      expect(isSensitivePath('/home/user/.npmrc')).toBe(true);
    });
  });

  describe('getSensitivePaths', () => {
    it('should filter sensitive paths', () => {
      const sensitive = getSensitivePaths([
        'src/index.ts',
        '.env',
        '~/.ssh/id_rsa',
        'package.json',
      ]);

      expect(sensitive).toContain('.env');
      expect(sensitive).toContain('~/.ssh/id_rsa');
      expect(sensitive).not.toContain('src/index.ts');
      expect(sensitive).not.toContain('package.json');
    });
  });

  describe('comprehensivePathCheck', () => {
    it('should allow normal workspace paths', () => {
      const result = comprehensivePathCheck('src/index.ts', workspacePath);

      expect(result.allowed).toBe(true);
      expect(result.withinWorkspace).toBe(true);
      expect(result.isSensitive).toBe(false);
      expect(result.warnings).toHaveLength(0);
    });

    it('should not allow paths outside workspace', () => {
      const result = comprehensivePathCheck('/etc/passwd', workspacePath);

      expect(result.allowed).toBe(false);
      expect(result.withinWorkspace).toBe(false);
      expect(result.warnings).toContain('Path is outside the workspace directory');
    });

    it('should flag sensitive paths even within workspace', () => {
      // .env is within workspace but sensitive
      const result = comprehensivePathCheck('.env', workspacePath);

      expect(result.withinWorkspace).toBe(true);
      expect(result.isSensitive).toBe(true);
      expect(result.allowed).toBe(false); // Sensitive paths require extra approval
      expect(result.warnings).toContain('Path may contain sensitive data');
    });

    it('should flag both outside and sensitive', () => {
      const result = comprehensivePathCheck('/etc/passwd', workspacePath);

      expect(result.allowed).toBe(false);
      expect(result.withinWorkspace).toBe(false);
      expect(result.isSensitive).toBe(true); // /etc is sensitive
    });
  });

  describe('checkCommandPaths', () => {
    it('should return all allowed for safe paths', () => {
      const result = checkCommandPaths(
        ['src/index.ts', 'lib/utils.ts'],
        workspacePath
      );

      expect(result.allAllowed).toBe(true);
      expect(result.outsidePaths).toHaveLength(0);
      expect(result.sensitivePaths).toHaveLength(0);
    });

    it('should detect outside paths', () => {
      const result = checkCommandPaths(
        ['src/index.ts', '/etc/passwd', '../other'],
        workspacePath
      );

      expect(result.allAllowed).toBe(false);
      expect(result.outsidePaths).toContain('/etc/passwd');
      expect(result.outsidePaths).toContain('../other');
    });

    it('should detect sensitive paths', () => {
      const result = checkCommandPaths(
        ['src/index.ts', '.env', '.env.local'],
        workspacePath
      );

      expect(result.allAllowed).toBe(false);
      expect(result.sensitivePaths).toContain('.env');
      expect(result.sensitivePaths).toContain('.env.local');
    });

    it('should handle empty paths array', () => {
      const result = checkCommandPaths([], workspacePath);

      expect(result.allAllowed).toBe(true);
      expect(result.outsidePaths).toHaveLength(0);
      expect(result.sensitivePaths).toHaveLength(0);
    });
  });

  describe('edge cases', () => {
    it('should handle paths with special characters', () => {
      expect(isPathWithinWorkspace('src/file name.ts', workspacePath)).toBe(true);
    });

    it('should handle deeply nested paths', () => {
      expect(
        isPathWithinWorkspace('src/a/b/c/d/e/f/g/file.ts', workspacePath)
      ).toBe(true);
    });

    it('should handle multiple parent directory references', () => {
      expect(isPathWithinWorkspace('src/a/b/../../../c', workspacePath)).toBe(true);
      expect(isPathWithinWorkspace('src/../../..', workspacePath)).toBe(false);
    });

    it('should handle Windows-style paths on Unix (treat as relative)', () => {
      // On Unix, this would be treated as a relative path
      const result = isPathWithinWorkspace('C:\\Users\\file.txt', workspacePath);
      // This is platform-dependent behavior
      expect(typeof result).toBe('boolean');
    });
  });
});
