import { describe, expect, it } from 'vitest';
import { getRelativeWorkspacePath, isPathInWorkspace } from '../pathUtils';

describe('pathUtils workspace boundaries', () => {
  it('treats files inside the workspace as in-bounds', () => {
    expect(isPathInWorkspace('/Users/test/project/src/App.tsx', '/Users/test/project')).toBe(true);
    expect(getRelativeWorkspacePath('/Users/test/project/src/App.tsx', '/Users/test/project')).toBe('src/App.tsx');
  });

  it('rejects sibling paths that only share a prefix', () => {
    expect(isPathInWorkspace('/Users/test/project-worktrees/feature/src/App.tsx', '/Users/test/project')).toBe(false);
    expect(getRelativeWorkspacePath('/Users/test/project-worktrees/feature/src/App.tsx', '/Users/test/project')).toBeNull();
  });

  it('rejects external Claude memory files', () => {
    const workspacePath = '/Users/test/project';
    const memoryPath = '/Users/test/.claude/projects/project/memory/CLAUDE.md';

    expect(isPathInWorkspace(memoryPath, workspacePath)).toBe(false);
    expect(getRelativeWorkspacePath(memoryPath, workspacePath)).toBeNull();
  });
});
