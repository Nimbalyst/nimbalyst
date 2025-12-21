import { describe, it, expect } from 'vitest';
import {
  parseCommand,
  parseCommandSegment,
  splitCompoundCommand,
  extractBaseCommand,
  extractPaths,
  hasWriteRedirection,
  isReadOnlyAllowed,
  matchesPattern,
  parseGitCommand,
  parsePackageManagerCommand,
  parseBashCommand,
} from '../commandParser';

describe('commandParser', () => {
  describe('splitCompoundCommand', () => {
    it('should split commands by &&', () => {
      expect(splitCompoundCommand('npm run build && npm run test')).toEqual([
        'npm run build',
        'npm run test',
      ]);
    });

    it('should split commands by ||', () => {
      // shell-quote strips quotes during parsing (which is correct shell behavior)
      expect(splitCompoundCommand('npm run build || echo "failed"')).toEqual([
        'npm run build',
        'echo failed',
      ]);
    });

    it('should split commands by ;', () => {
      expect(splitCompoundCommand('cd src; ls -la')).toEqual(['cd src', 'ls -la']);
    });

    it('should split commands by |', () => {
      expect(splitCompoundCommand('cat file.txt | grep pattern')).toEqual([
        'cat file.txt',
        'grep pattern',
      ]);
    });

    it('should handle multiple operators', () => {
      expect(splitCompoundCommand('cmd1 && cmd2 || cmd3; cmd4')).toEqual([
        'cmd1',
        'cmd2',
        'cmd3',
        'cmd4',
      ]);
    });

    it('should preserve quoted strings (quotes stripped by shell-quote)', () => {
      // shell-quote correctly parses quoted strings as single tokens,
      // then strips the quotes (matching real shell behavior)
      expect(splitCompoundCommand('echo "hello && world" && ls')).toEqual([
        'echo hello && world', // The && inside quotes is part of the argument, not an operator
        'ls',
      ]);
    });

    it('should preserve single-quoted strings (quotes stripped by shell-quote)', () => {
      expect(splitCompoundCommand("echo 'hello && world' && ls")).toEqual([
        'echo hello && world',
        'ls',
      ]);
    });

    it('should handle single command', () => {
      expect(splitCompoundCommand('git status')).toEqual(['git status']);
    });

    it('should handle empty string', () => {
      expect(splitCompoundCommand('')).toEqual([]);
    });

    it('should handle whitespace', () => {
      expect(splitCompoundCommand('  cmd1  &&  cmd2  ')).toEqual(['cmd1', 'cmd2']);
    });
  });

  describe('extractBaseCommand', () => {
    it('should extract simple command', () => {
      expect(extractBaseCommand('ls -la')).toBe('ls');
    });

    it('should skip sudo prefix', () => {
      expect(extractBaseCommand('sudo rm -rf /')).toBe('rm');
    });

    it('should skip env prefix', () => {
      expect(extractBaseCommand('env NODE_ENV=production npm start')).toBe('npm');
    });

    it('should skip multiple prefixes', () => {
      expect(extractBaseCommand('sudo env DEBUG=1 node server.js')).toBe('node');
    });

    it('should handle git commands', () => {
      expect(extractBaseCommand('git push origin main')).toBe('git');
    });

    it('should handle empty string', () => {
      expect(extractBaseCommand('')).toBe('');
    });
  });

  describe('extractPaths', () => {
    it('should extract absolute paths', () => {
      expect(extractPaths('cat /etc/passwd')).toContain('/etc/passwd');
    });

    it('should extract relative paths', () => {
      expect(extractPaths('cat ./src/index.ts')).toContain('./src/index.ts');
    });

    it('should extract parent paths', () => {
      expect(extractPaths('cat ../config.json')).toContain('../config.json');
    });

    it('should extract multiple paths', () => {
      const paths = extractPaths('cp /src/file.txt /dest/file.txt');
      expect(paths).toContain('/src/file.txt');
      expect(paths).toContain('/dest/file.txt');
    });

    it('should ignore flags', () => {
      const paths = extractPaths('ls -la /home');
      expect(paths).not.toContain('-la');
      expect(paths).toContain('/home');
    });

    it('should ignore URLs', () => {
      const paths = extractPaths('curl https://example.com/api');
      expect(paths).not.toContain('https://example.com/api');
    });
  });

  describe('hasWriteRedirection', () => {
    it('should detect > redirection', () => {
      expect(hasWriteRedirection('echo hello > file.txt')).toBe(true);
    });

    it('should detect >> append', () => {
      expect(hasWriteRedirection('echo hello >> file.txt')).toBe(true);
    });

    it('should detect 2> stderr redirect', () => {
      expect(hasWriteRedirection('cmd 2> error.log')).toBe(true);
    });

    it('should correctly handle redirection in quotes (shell-quote improvement)', () => {
      // With shell-quote, we now correctly identify that > inside quotes
      // is NOT a redirection operator - it's just a character in the string
      expect(hasWriteRedirection('echo "hello > world"')).toBe(false);
    });

    it('should return false for no redirection', () => {
      expect(hasWriteRedirection('ls -la')).toBe(false);
    });
  });

  describe('parseGitCommand', () => {
    it('should parse git status as read-only', () => {
      const result = parseGitCommand('git status');
      expect(result.pattern).toBe('git:status');
      expect(result.isDestructive).toBe(false);
    });

    it('should parse git log as read-only', () => {
      const result = parseGitCommand('git log --oneline');
      expect(result.pattern).toBe('git:log');
      expect(result.isDestructive).toBe(false);
    });

    it('should parse git commit', () => {
      const result = parseGitCommand('git commit -m "message"');
      expect(result.pattern).toBe('git:commit');
      expect(result.isDestructive).toBe(false);
    });

    it('should parse git push', () => {
      const result = parseGitCommand('git push origin main');
      expect(result.pattern).toBe('git:push');
      expect(result.isDestructive).toBe(false);
    });

    it('should parse git push --force as destructive', () => {
      const result = parseGitCommand('git push --force origin main');
      expect(result.pattern).toBe('git:push-force');
      expect(result.isDestructive).toBe(true);
    });

    it('should parse git push -f as destructive', () => {
      const result = parseGitCommand('git push -f origin main');
      expect(result.pattern).toBe('git:push-force');
      expect(result.isDestructive).toBe(true);
    });

    it('should parse git reset --hard as destructive', () => {
      const result = parseGitCommand('git reset --hard HEAD~1');
      expect(result.pattern).toBe('git:reset-hard');
      expect(result.isDestructive).toBe(true);
    });

    it('should parse git reset --soft as non-destructive', () => {
      const result = parseGitCommand('git reset --soft HEAD~1');
      expect(result.pattern).toBe('git:reset-soft');
      expect(result.isDestructive).toBe(false);
    });

    it('should parse git branch -d as destructive', () => {
      const result = parseGitCommand('git branch -d feature');
      expect(result.isDestructive).toBe(true);
    });

    it('should parse git branch -D as destructive', () => {
      const result = parseGitCommand('git branch -D feature');
      expect(result.isDestructive).toBe(true);
    });

    it('should parse git branch (list) as non-destructive', () => {
      const result = parseGitCommand('git branch');
      expect(result.isDestructive).toBe(false);
    });

    it('should parse git rebase as destructive', () => {
      const result = parseGitCommand('git rebase main');
      expect(result.isDestructive).toBe(true);
    });

    it('should parse git clean -fd as destructive', () => {
      const result = parseGitCommand('git clean -fd');
      expect(result.isDestructive).toBe(true);
    });
  });

  describe('parsePackageManagerCommand', () => {
    it('should parse npm run script', () => {
      const result = parsePackageManagerCommand('npm run build');
      expect(result.pattern).toBe('npm:run:build');
      expect(result.displayName).toBe('npm run build');
    });

    it('should parse npm run-script', () => {
      const result = parsePackageManagerCommand('npm run-script test');
      expect(result.pattern).toBe('npm:run:test');
    });

    it('should parse npm install', () => {
      const result = parsePackageManagerCommand('npm install');
      expect(result.pattern).toBe('npm:install');
    });

    it('should parse npm i (shorthand)', () => {
      const result = parsePackageManagerCommand('npm i lodash');
      expect(result.pattern).toBe('npm:install');
    });

    it('should parse npm publish as destructive', () => {
      const result = parsePackageManagerCommand('npm publish');
      expect(result.pattern).toBe('npm:publish');
      expect(result.isDestructive).toBe(true);
    });

    it('should parse npm list as read-only', () => {
      const result = parsePackageManagerCommand('npm list');
      expect(result.pattern).toBe('npm:list');
    });

    it('should parse npm outdated as read-only', () => {
      const result = parsePackageManagerCommand('npm outdated');
      expect(result.pattern).toBe('npm:outdated');
    });

    it('should parse yarn add', () => {
      const result = parsePackageManagerCommand('yarn add lodash');
      expect(result.pattern).toBe('npm:install');
    });

    it('should parse npx commands', () => {
      const result = parsePackageManagerCommand('npx vitest');
      expect(result.pattern).toBe('npx:vitest');
      expect(result.displayName).toBe('npx vitest');
    });
  });

  describe('parseBashCommand', () => {
    it('should parse ls as read-only', () => {
      const result = parseBashCommand('ls -la');
      expect(result.pattern).toBe('bash:ls');
      expect(result.isDestructive).toBe(false);
    });

    it('should parse cat as read-only', () => {
      const result = parseBashCommand('cat file.txt');
      expect(result.pattern).toBe('bash:cat');
      expect(result.isDestructive).toBe(false);
    });

    it('should parse grep as read-only', () => {
      const result = parseBashCommand('grep -r "pattern" src/');
      expect(result.pattern).toBe('bash:grep');
      expect(result.isDestructive).toBe(false);
    });

    it('should parse rm as destructive', () => {
      const result = parseBashCommand('rm file.txt');
      expect(result.pattern).toBe('bash:rm');
      expect(result.isDestructive).toBe(true);
    });

    it('should parse rm -rf as destructive', () => {
      const result = parseBashCommand('rm -rf node_modules');
      expect(result.pattern).toBe('bash:rm-rf');
      expect(result.isDestructive).toBe(true);
    });

    it('should parse rm -r as destructive', () => {
      const result = parseBashCommand('rm -r directory');
      expect(result.pattern).toBe('bash:rm-r');
      expect(result.isDestructive).toBe(true);
    });

    it('should parse echo as read-only (no redirect)', () => {
      const result = parseBashCommand('echo hello');
      expect(result.pattern).toBe('bash:echo');
      expect(result.isDestructive).toBe(false);
    });

    it('should parse echo with redirect as write', () => {
      const result = parseBashCommand('echo hello > file.txt');
      expect(result.pattern).toBe('bash:echo-write');
      expect(result.isDestructive).toBe(false);
    });

    it('should parse mv as destructive', () => {
      const result = parseBashCommand('mv old.txt new.txt');
      expect(result.pattern).toBe('bash:mv');
      expect(result.isDestructive).toBe(true);
    });

    it('should extract paths', () => {
      const result = parseBashCommand('cat /etc/passwd');
      expect(result.referencedPaths).toContain('/etc/passwd');
    });
  });

  describe('parseCommand (compound)', () => {
    it('should parse compound command with &&', () => {
      const result = parseCommand('npm run build && npm run deploy');
      expect(result.actions).toHaveLength(2);
      expect(result.actions[0].pattern).toBe('npm:run:build');
      expect(result.actions[1].pattern).toBe('npm:run:deploy');
    });

    it('should parse compound command with mixed operators', () => {
      const result = parseCommand('git add . && git commit -m "msg" || echo failed');
      expect(result.actions).toHaveLength(3);
      expect(result.actions[0].pattern).toBe('git:add');
      expect(result.actions[1].pattern).toBe('git:commit');
      expect(result.actions[2].pattern).toBe('bash:echo');
    });

    it('should preserve original command', () => {
      const cmd = 'ls -la && pwd';
      const result = parseCommand(cmd);
      expect(result.original).toBe(cmd);
    });
  });

  describe('isReadOnlyAllowed', () => {
    it('should allow git status', () => {
      const action = parseCommandSegment('git status');
      expect(isReadOnlyAllowed(action)).toBe(true);
    });

    it('should allow git log', () => {
      const action = parseCommandSegment('git log --oneline');
      expect(isReadOnlyAllowed(action)).toBe(true);
    });

    it('should allow git diff', () => {
      const action = parseCommandSegment('git diff HEAD~1');
      expect(isReadOnlyAllowed(action)).toBe(true);
    });

    it('should not allow git commit', () => {
      const action = parseCommandSegment('git commit -m "msg"');
      expect(isReadOnlyAllowed(action)).toBe(false);
    });

    it('should not allow git push', () => {
      const action = parseCommandSegment('git push origin main');
      expect(isReadOnlyAllowed(action)).toBe(false);
    });

    it('should allow bash ls', () => {
      const action = parseCommandSegment('ls -la');
      expect(isReadOnlyAllowed(action)).toBe(true);
    });

    it('should allow bash cat', () => {
      const action = parseCommandSegment('cat file.txt');
      expect(isReadOnlyAllowed(action)).toBe(true);
    });

    it('should allow bash grep', () => {
      const action = parseCommandSegment('grep -r pattern src/');
      expect(isReadOnlyAllowed(action)).toBe(true);
    });

    it('should not allow bash rm', () => {
      const action = parseCommandSegment('rm file.txt');
      expect(isReadOnlyAllowed(action)).toBe(false);
    });

    it('should allow npm list', () => {
      const action = parseCommandSegment('npm list');
      expect(isReadOnlyAllowed(action)).toBe(true);
    });

    it('should allow npm outdated', () => {
      const action = parseCommandSegment('npm outdated');
      expect(isReadOnlyAllowed(action)).toBe(true);
    });

    it('should not allow npm install', () => {
      const action = parseCommandSegment('npm install');
      expect(isReadOnlyAllowed(action)).toBe(false);
    });

    it('should not allow npm run', () => {
      const action = parseCommandSegment('npm run build');
      expect(isReadOnlyAllowed(action)).toBe(false);
    });
  });

  describe('matchesPattern', () => {
    it('should match exact pattern', () => {
      const action = parseCommandSegment('git push origin main');
      expect(matchesPattern(action, 'git:push')).toBe(true);
    });

    it('should not match different pattern', () => {
      const action = parseCommandSegment('git push origin main');
      expect(matchesPattern(action, 'git:commit')).toBe(false);
    });

    it('should match wildcard pattern', () => {
      const action = parseCommandSegment('git push origin main');
      expect(matchesPattern(action, 'git:*')).toBe(true);
    });

    it('should match npm wildcard', () => {
      const action = parseCommandSegment('npm run build');
      expect(matchesPattern(action, 'npm:run:*')).toBe(true);
    });

    it('should not match partial wildcard incorrectly', () => {
      const action = parseCommandSegment('git commit -m "msg"');
      expect(matchesPattern(action, 'bash:*')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle commands with special characters in quotes', () => {
      const result = parseCommand('git commit -m "fix: handle && operator"');
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0].pattern).toBe('git:commit');
    });

    it('should handle empty command', () => {
      const result = parseCommand('');
      expect(result.actions).toHaveLength(0);
    });

    it('should handle whitespace-only command', () => {
      const result = parseCommand('   ');
      expect(result.actions).toHaveLength(0);
    });

    it('should handle command with many spaces', () => {
      const result = parseCommand('git   push   origin   main');
      expect(result.actions[0].pattern).toBe('git:push');
    });

    it('should handle paths with spaces (quoted)', () => {
      const result = parseCommand('cat "file with spaces.txt"');
      expect(result.actions[0].pattern).toBe('bash:cat');
    });
  });
});
