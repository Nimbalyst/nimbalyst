import { describe, it, expect } from 'vitest';
import { resolveProjectPath, isWorktreePath } from '../workspaceDetection';

describe('resolveProjectPath', () => {
  it('returns the same path for regular workspaces', () => {
    expect(resolveProjectPath('/path/to/project')).toBe('/path/to/project');
    expect(resolveProjectPath('/Users/dev/my-app')).toBe('/Users/dev/my-app');
    expect(resolveProjectPath('/home/user/code/myrepo')).toBe('/home/user/code/myrepo');
  });

  it('resolves worktree paths to parent project', () => {
    expect(resolveProjectPath('/path/to/project_worktrees/swift-falcon'))
      .toBe('/path/to/project');
    expect(resolveProjectPath('/Users/dev/my-app_worktrees/brave-eagle'))
      .toBe('/Users/dev/my-app');
    expect(resolveProjectPath('/home/user/code/myrepo_worktrees/test-123'))
      .toBe('/home/user/code/myrepo');
  });

  it('handles trailing slashes on worktree paths', () => {
    expect(resolveProjectPath('/path/to/project_worktrees/swift-falcon/'))
      .toBe('/path/to/project');
    expect(resolveProjectPath('/path/to/project_worktrees/swift-falcon//'))
      .toBe('/path/to/project');
  });

  it('does not match paths that just contain _worktrees in the middle', () => {
    // This path has _worktrees in it but is not a worktree path pattern
    expect(resolveProjectPath('/path/to/project_worktrees_backup/folder'))
      .toBe('/path/to/project_worktrees_backup/folder');
  });

  it('handles empty and null-ish inputs gracefully', () => {
    expect(resolveProjectPath('')).toBe('');
    expect(resolveProjectPath(null as unknown as string)).toBe(null);
    expect(resolveProjectPath(undefined as unknown as string)).toBe(undefined);
  });

  it('handles complex project names with underscores', () => {
    expect(resolveProjectPath('/path/to/my_cool_project_worktrees/branch-1'))
      .toBe('/path/to/my_cool_project');
  });

  it('handles Windows-style paths', () => {
    // Note: Our regex uses / which works on Windows when paths are normalized
    // but if someone passes backslashes, it won't match (that's okay)
    expect(resolveProjectPath('C:/Users/dev/project_worktrees/feature'))
      .toBe('C:/Users/dev/project');
  });
});

describe('isWorktreePath', () => {
  it('returns false for regular workspaces', () => {
    expect(isWorktreePath('/path/to/project')).toBe(false);
    expect(isWorktreePath('/Users/dev/my-app')).toBe(false);
    expect(isWorktreePath('/home/user/code/myrepo')).toBe(false);
  });

  it('returns true for worktree paths', () => {
    expect(isWorktreePath('/path/to/project_worktrees/swift-falcon')).toBe(true);
    expect(isWorktreePath('/Users/dev/my-app_worktrees/brave-eagle')).toBe(true);
    expect(isWorktreePath('/home/user/code/myrepo_worktrees/test-123')).toBe(true);
  });

  it('handles trailing slashes', () => {
    expect(isWorktreePath('/path/to/project_worktrees/swift-falcon/')).toBe(true);
  });

  it('handles empty and null-ish inputs gracefully', () => {
    expect(isWorktreePath('')).toBe(false);
    expect(isWorktreePath(null as unknown as string)).toBe(false);
    expect(isWorktreePath(undefined as unknown as string)).toBe(false);
  });

  it('does not match paths that just contain _worktrees in the middle', () => {
    expect(isWorktreePath('/path/to/project_worktrees_backup/folder')).toBe(false);
  });
});
