import { describe, it, expect } from 'vitest';
import {
  PermissionEngine,
  DEFAULT_WORKSPACE_PERMISSIONS,
  serializeWorkspacePermissions,
  deserializeWorkspacePermissions,
  type WorkspacePermissions,
} from '../permissionEngine';

describe('permissionEngine', () => {
  const workspacePath = '/Users/test/my-project';
  const sessionId = 'session-123';

  function createTrustedEngine(): PermissionEngine {
    return new PermissionEngine(workspacePath, {
      ...DEFAULT_WORKSPACE_PERMISSIONS,
      permissionMode: 'ask',
    });
  }

  describe('workspace trust', () => {
    it('should deny all commands when workspace is not trusted', () => {
      const engine = new PermissionEngine(workspacePath);
      const evaluation = engine.evaluateCommand('ls -la', sessionId);
      expect(evaluation.overallDecision).toBe('deny');
    });

    it('should allow commands when workspace is trusted', () => {
      const engine = createTrustedEngine();
      const evaluation = engine.evaluateCommand('ls -la', sessionId);
      expect(evaluation.overallDecision).toBe('allow');
    });

    it('should track trust status', () => {
      const engine = new PermissionEngine(workspacePath);
      expect(engine.isWorkspaceTrusted()).toBe(false);

      engine.trustWorkspace();
      expect(engine.isWorkspaceTrusted()).toBe(true);

      engine.revokeWorkspaceTrust();
      expect(engine.isWorkspaceTrusted()).toBe(false);
    });

    it('should set permissionMode when trusting', () => {
      const engine = new PermissionEngine(workspacePath);
      expect(engine.getPermissionMode()).toBe(null);

      engine.trustWorkspace();
      const perms = engine.getWorkspacePermissions();
      expect(perms.permissionMode).toBe('ask');
    });
  });

  describe('read-only allowlist', () => {
    it('should auto-allow read-only commands within workspace', () => {
      const engine = createTrustedEngine();
      const commands = ['ls', 'cat file.txt', 'grep pattern', 'git status', 'git log'];

      for (const cmd of commands) {
        const evaluation = engine.evaluateCommand(cmd, sessionId);
        expect(evaluation.overallDecision).toBe('allow');
        expect(evaluation.evaluations[0].reason).toContain('Read-only');
      }
    });

    it('should auto-allow git read-only subcommands', () => {
      const engine = createTrustedEngine();
      const commands = ['git status', 'git log --oneline', 'git diff', 'git show HEAD', 'git blame file.ts'];

      for (const cmd of commands) {
        const evaluation = engine.evaluateCommand(cmd, sessionId);
        expect(evaluation.overallDecision).toBe('allow');
      }
    });

    it('should not auto-allow write commands', () => {
      const engine = createTrustedEngine();
      const evaluation = engine.evaluateCommand('rm -rf node_modules', sessionId);
      expect(evaluation.overallDecision).toBe('ask');
    });
  });

  describe('workspace denied patterns', () => {
    it('should deny commands matching denied patterns', () => {
      const engine = createTrustedEngine();
      engine.denyPatternAlways('git:push', 'Git push');

      const evaluation = engine.evaluateCommand('git push origin main', sessionId);
      expect(evaluation.overallDecision).toBe('deny');
      expect(evaluation.evaluations[0].reason).toContain('denied in workspace');
    });

    it('should take precedence over session allowed', () => {
      const engine = createTrustedEngine();
      engine.denyPatternAlways('git:push', 'Git push');
      engine.allowPatternForSession(sessionId, 'git:push');

      const evaluation = engine.evaluateCommand('git push origin main', sessionId);
      expect(evaluation.overallDecision).toBe('deny');
    });
  });

  describe('workspace allowed patterns', () => {
    it('should allow commands matching allowed patterns', () => {
      const engine = createTrustedEngine();
      engine.allowPatternAlways('git:push', 'Git push');

      const evaluation = engine.evaluateCommand('git push origin main', sessionId);
      expect(evaluation.overallDecision).toBe('allow');
      expect(evaluation.evaluations[0].reason).toContain('allowed in workspace');
    });

    it('should be overridden by denied patterns', () => {
      const engine = createTrustedEngine();
      engine.allowPatternAlways('git:push', 'Git push');
      engine.denyPatternAlways('git:push', 'Git push');

      // Deny should have removed from allowed
      const perms = engine.getWorkspacePermissions();
      expect(perms.allowedPatterns.some((r) => r.pattern === 'git:push')).toBe(false);
      expect(perms.deniedPatterns.some((r) => r.pattern === 'git:push')).toBe(true);
    });
  });

  describe('session permissions', () => {
    it('should allow commands for session only', () => {
      const engine = createTrustedEngine();
      engine.allowPatternForSession(sessionId, 'npm:run:build');

      const evaluation = engine.evaluateCommand('npm run build', sessionId);
      expect(evaluation.overallDecision).toBe('allow');
      expect(evaluation.evaluations[0].reason).toContain('allowed for this session');
    });

    it('should not affect other sessions', () => {
      const engine = createTrustedEngine();
      engine.allowPatternForSession(sessionId, 'npm:run:build');

      const evaluation = engine.evaluateCommand('npm run build', 'other-session');
      expect(evaluation.overallDecision).toBe('ask');
    });

    it('should deny commands for session', () => {
      const engine = createTrustedEngine();
      engine.denyPatternForSession(sessionId, 'npm:run:build');

      const evaluation = engine.evaluateCommand('npm run build', sessionId);
      expect(evaluation.overallDecision).toBe('deny');
      expect(evaluation.evaluations[0].reason).toContain('denied for this session');
    });

    it('should clear session permissions', () => {
      const engine = createTrustedEngine();
      engine.allowPatternForSession(sessionId, 'npm:run:build');
      engine.clearSessionPermissions(sessionId);

      const evaluation = engine.evaluateCommand('npm run build', sessionId);
      expect(evaluation.overallDecision).toBe('ask');
    });
  });

  describe('path checking', () => {
    it('should ask for commands with paths outside workspace', () => {
      const engine = createTrustedEngine();
      const evaluation = engine.evaluateCommand('cat /etc/passwd', sessionId);
      expect(evaluation.overallDecision).toBe('ask');
      expect(evaluation.evaluations[0].outsidePaths).toContain('/etc/passwd');
    });

    it('should ask for commands with sensitive paths', () => {
      const engine = createTrustedEngine();
      const evaluation = engine.evaluateCommand('cat ~/.ssh/id_rsa', sessionId);
      expect(evaluation.overallDecision).toBe('ask');
      expect(evaluation.evaluations[0].sensitivePaths.length).toBeGreaterThan(0);
    });

    it('should allow read-only commands with workspace-relative paths', () => {
      const engine = createTrustedEngine();
      const evaluation = engine.evaluateCommand('cat src/index.ts', sessionId);
      expect(evaluation.overallDecision).toBe('allow');
    });
  });

  describe('destructive command detection', () => {
    it('should mark rm -rf as destructive', () => {
      const engine = createTrustedEngine();
      const evaluation = engine.evaluateCommand('rm -rf node_modules', sessionId);
      expect(evaluation.hasDestructiveActions).toBe(true);
      expect(evaluation.evaluations[0].isDestructive).toBe(true);
    });

    it('should mark git reset --hard as destructive', () => {
      const engine = createTrustedEngine();
      const evaluation = engine.evaluateCommand('git reset --hard HEAD~5', sessionId);
      expect(evaluation.hasDestructiveActions).toBe(true);
      expect(evaluation.evaluations[0].isDestructive).toBe(true);
    });

    it('should mark git push --force as destructive', () => {
      const engine = createTrustedEngine();
      const evaluation = engine.evaluateCommand('git push --force origin main', sessionId);
      expect(evaluation.hasDestructiveActions).toBe(true);
    });

    it('should not mark normal git push as destructive', () => {
      const engine = createTrustedEngine();
      const evaluation = engine.evaluateCommand('git push origin main', sessionId);
      expect(evaluation.hasDestructiveActions).toBe(false);
    });
  });

  describe('compound commands', () => {
    it('should evaluate each action in a compound command', () => {
      const engine = createTrustedEngine();
      const evaluation = engine.evaluateCommand('npm run build && npm run deploy', sessionId);
      expect(evaluation.command.actions).toHaveLength(2);
      expect(evaluation.evaluations).toHaveLength(2);
    });

    it('should deny entire command if any action is denied', () => {
      const engine = createTrustedEngine();
      engine.denyPatternAlways('npm:run:deploy', 'npm run deploy');

      const evaluation = engine.evaluateCommand('npm run build && npm run deploy', sessionId);
      expect(evaluation.overallDecision).toBe('deny');
    });

    it('should ask for any actions that need approval', () => {
      const engine = createTrustedEngine();
      const evaluation = engine.evaluateCommand('npm run build && npm run deploy', sessionId);
      expect(evaluation.overallDecision).toBe('ask');
      expect(evaluation.actionsNeedingApproval.length).toBeGreaterThan(0);
    });

    it('should allow all if all actions are allowed', () => {
      const engine = createTrustedEngine();
      engine.allowPatternAlways('npm:run:build', 'npm run build');
      engine.allowPatternAlways('npm:run:deploy', 'npm run deploy');

      const evaluation = engine.evaluateCommand('npm run build && npm run deploy', sessionId);
      expect(evaluation.overallDecision).toBe('allow');
    });
  });

  describe('permission requests', () => {
    it('should create permission request for commands needing approval', () => {
      const engine = createTrustedEngine();
      const evaluation = engine.evaluateCommand('npm run deploy', sessionId);
      const request = engine.createPermissionRequest('Bash', 'npm run deploy', evaluation);

      expect(request).not.toBeNull();
      expect(request!.toolName).toBe('Bash');
      expect(request!.rawCommand).toBe('npm run deploy');
      expect(request!.actionsNeedingApproval.length).toBeGreaterThan(0);
      expect(request!.id).toMatch(/^perm-/);
    });

    it('should not create request for allowed commands', () => {
      const engine = createTrustedEngine();
      const evaluation = engine.evaluateCommand('ls -la', sessionId);
      const request = engine.createPermissionRequest('Bash', 'ls -la', evaluation);

      expect(request).toBeNull();
    });

    it('should not create request for denied commands', () => {
      const engine = createTrustedEngine();
      engine.denyPatternAlways('npm:run:deploy', 'npm run deploy');

      const evaluation = engine.evaluateCommand('npm run deploy', sessionId);
      const request = engine.createPermissionRequest('Bash', 'npm run deploy', evaluation);

      expect(request).toBeNull();
    });
  });

  describe('applying permission responses', () => {
    it('should apply once (no storage)', () => {
      const engine = createTrustedEngine();
      const evaluation = engine.evaluateCommand('npm run deploy', sessionId);
      const request = engine.createPermissionRequest('Bash', 'npm run deploy', evaluation)!;

      engine.applyPermissionResponse(
        { requestId: request.id, decision: 'allow', scope: 'once' },
        request,
        sessionId
      );

      // Still needs approval next time
      const nextEval = engine.evaluateCommand('npm run deploy', sessionId);
      expect(nextEval.overallDecision).toBe('ask');
    });

    it('should apply session scope', () => {
      const engine = createTrustedEngine();
      const evaluation = engine.evaluateCommand('npm run deploy', sessionId);
      const request = engine.createPermissionRequest('Bash', 'npm run deploy', evaluation)!;

      engine.applyPermissionResponse(
        { requestId: request.id, decision: 'allow', scope: 'session' },
        request,
        sessionId
      );

      // Allowed for this session
      const nextEval = engine.evaluateCommand('npm run deploy', sessionId);
      expect(nextEval.overallDecision).toBe('allow');

      // Still needs approval for other session
      const otherEval = engine.evaluateCommand('npm run deploy', 'other-session');
      expect(otherEval.overallDecision).toBe('ask');
    });

    it('should apply always scope', () => {
      const engine = createTrustedEngine();
      const evaluation = engine.evaluateCommand('npm run deploy', sessionId);
      const request = engine.createPermissionRequest('Bash', 'npm run deploy', evaluation)!;

      engine.applyPermissionResponse(
        { requestId: request.id, decision: 'allow', scope: 'always' },
        request,
        sessionId
      );

      // Allowed for all sessions
      const nextEval = engine.evaluateCommand('npm run deploy', sessionId);
      expect(nextEval.overallDecision).toBe('allow');

      const otherEval = engine.evaluateCommand('npm run deploy', 'other-session');
      expect(otherEval.overallDecision).toBe('allow');

      // Stored in workspace permissions
      const perms = engine.getWorkspacePermissions();
      expect(perms.allowedPatterns.some((r) => r.pattern === 'npm:run:deploy')).toBe(true);
    });

    it('should apply deny for session', () => {
      const engine = createTrustedEngine();
      const evaluation = engine.evaluateCommand('npm run deploy', sessionId);
      const request = engine.createPermissionRequest('Bash', 'npm run deploy', evaluation)!;

      engine.applyPermissionResponse(
        { requestId: request.id, decision: 'deny', scope: 'session' },
        request,
        sessionId
      );

      const nextEval = engine.evaluateCommand('npm run deploy', sessionId);
      expect(nextEval.overallDecision).toBe('deny');
    });

    it('should apply deny always', () => {
      const engine = createTrustedEngine();
      const evaluation = engine.evaluateCommand('npm run deploy', sessionId);
      const request = engine.createPermissionRequest('Bash', 'npm run deploy', evaluation)!;

      engine.applyPermissionResponse(
        { requestId: request.id, decision: 'deny', scope: 'always' },
        request,
        sessionId
      );

      const perms = engine.getWorkspacePermissions();
      expect(perms.deniedPatterns.some((r) => r.pattern === 'npm:run:deploy')).toBe(true);
    });
  });

  describe('pattern management', () => {
    it('should list allowed patterns', () => {
      const engine = createTrustedEngine();
      engine.allowPatternAlways('git:push', 'Git push');
      engine.allowPatternAlways('npm:run:build', 'npm run build');

      const allowed = engine.getAllowedPatterns();
      expect(allowed).toHaveLength(2);
      expect(allowed.map((r) => r.pattern)).toContain('git:push');
      expect(allowed.map((r) => r.pattern)).toContain('npm:run:build');
    });

    it('should list denied patterns', () => {
      const engine = createTrustedEngine();
      engine.denyPatternAlways('git:reset-hard', 'Git reset --hard');
      engine.denyPatternAlways('git:push-force', 'Git push --force');

      const denied = engine.getDeniedPatterns();
      expect(denied).toHaveLength(2);
      expect(denied.map((r) => r.pattern)).toContain('git:reset-hard');
      expect(denied.map((r) => r.pattern)).toContain('git:push-force');
    });

    it('should remove pattern rules', () => {
      const engine = createTrustedEngine();
      engine.allowPatternAlways('git:push', 'Git push');
      engine.removePatternRule('git:push');

      const allowed = engine.getAllowedPatterns();
      expect(allowed).toHaveLength(0);
    });

    it('should reset to defaults', () => {
      const engine = createTrustedEngine();
      engine.allowPatternAlways('git:push', 'Git push');
      engine.denyPatternAlways('git:reset-hard', 'Git reset --hard');

      engine.resetToDefaults();

      expect(engine.getAllowedPatterns()).toHaveLength(0);
      expect(engine.getDeniedPatterns()).toHaveLength(0);
      // Trust should remain
      expect(engine.isWorkspaceTrusted()).toBe(true);
    });
  });

  describe('quick check', () => {
    it('should return true for allowed commands', () => {
      const engine = createTrustedEngine();
      expect(engine.isCommandAllowed('ls -la', sessionId)).toBe(true);
    });

    it('should return false for commands needing approval', () => {
      const engine = createTrustedEngine();
      expect(engine.isCommandAllowed('npm run deploy', sessionId)).toBe(false);
    });

    it('should return false for denied commands', () => {
      const engine = createTrustedEngine();
      engine.denyPatternAlways('npm:run:deploy', 'npm run deploy');
      expect(engine.isCommandAllowed('npm run deploy', sessionId)).toBe(false);
    });
  });

  describe('serialization', () => {
    it('should serialize workspace permissions', () => {
      const permissions: WorkspacePermissions = {
        allowedPatterns: [
          { pattern: 'git:push', displayName: 'Git push', addedAt: 1000 },
          { pattern: 'npm:run:build', displayName: 'npm run build', addedAt: 2000 },
        ],
        deniedPatterns: [{ pattern: 'git:reset-hard', displayName: 'Git reset --hard', addedAt: 3000 }],
        permissionMode: 'ask',
        additionalDirectories: [{ path: '/external/docs', canWrite: false, addedAt: 4000 }],
        allowedUrlPatterns: [{ pattern: 'https://api.example.com/*', description: 'Example API', addedAt: 6000 }],
      };

      const serialized = serializeWorkspacePermissions(permissions);

      expect(serialized).toEqual({
        allowedPatterns: [
          { pattern: 'git:push', displayName: 'Git push', addedAt: 1000 },
          { pattern: 'npm:run:build', displayName: 'npm run build', addedAt: 2000 },
        ],
        deniedPatterns: [{ pattern: 'git:reset-hard', displayName: 'Git reset --hard', addedAt: 3000 }],
        permissionMode: 'ask',
        additionalDirectories: [{ path: '/external/docs', canWrite: false, addedAt: 4000 }],
        allowedUrlPatterns: [{ pattern: 'https://api.example.com/*', description: 'Example API', addedAt: 6000 }],
      });
    });

    it('should deserialize workspace permissions', () => {
      const data = {
        allowedPatterns: [{ pattern: 'git:push', displayName: 'Git push', addedAt: 1000 }],
        deniedPatterns: [{ pattern: 'git:reset-hard', displayName: 'Git reset --hard', addedAt: 3000 }],
        permissionMode: 'allow-all',
        additionalDirectories: [{ path: '/docs', canWrite: true, addedAt: 6000 }],
      };

      const permissions = deserializeWorkspacePermissions(data);

      expect(permissions.allowedPatterns).toHaveLength(1);
      expect(permissions.allowedPatterns[0].pattern).toBe('git:push');
      expect(permissions.deniedPatterns).toHaveLength(1);
      expect(permissions.permissionMode).toBe('allow-all');
      expect(permissions.additionalDirectories).toHaveLength(1);
      expect(permissions.additionalDirectories[0].path).toBe('/docs');
      expect(permissions.additionalDirectories[0].canWrite).toBe(true);
    });

    it('should handle invalid data gracefully', () => {
      expect(deserializeWorkspacePermissions(null)).toEqual(DEFAULT_WORKSPACE_PERMISSIONS);
      expect(deserializeWorkspacePermissions(undefined)).toEqual(DEFAULT_WORKSPACE_PERMISSIONS);
      expect(deserializeWorkspacePermissions('invalid')).toEqual(DEFAULT_WORKSPACE_PERMISSIONS);
      expect(deserializeWorkspacePermissions({})).toEqual({
        allowedPatterns: [],
        deniedPatterns: [],
        permissionMode: null,
        additionalDirectories: [],
        allowedUrlPatterns: [],
      });
    });

    it('should handle malformed pattern data', () => {
      const data = {
        allowedPatterns: [
          { pattern: 'valid', displayName: 'Valid' },
          { invalid: 'data' },
          null,
        ],
        deniedPatterns: 'not-an-array',
        isTrusted: 'yes', // Should migrate from old format to 'ask'
      };

      const permissions = deserializeWorkspacePermissions(data);

      // Should filter out null and keep valid objects (including malformed ones that become empty strings)
      expect(permissions.allowedPatterns).toHaveLength(2);
      expect(permissions.allowedPatterns[0].pattern).toBe('valid');
      expect(permissions.deniedPatterns).toHaveLength(0);
      // Migration: isTrusted: true -> permissionMode: 'ask'
      expect(permissions.permissionMode).toBe('ask');
    });
  });

  describe('risky command warnings', () => {
    it('should include warnings for risky commands', () => {
      const engine = createTrustedEngine();
      const evaluation = engine.evaluateCommand('git rebase main', sessionId);
      expect(evaluation.evaluations[0].isRisky).toBe(true);
      expect(evaluation.evaluations[0].warnings.length).toBeGreaterThan(0);
    });

    it('should include warnings for destructive commands', () => {
      const engine = createTrustedEngine();
      const evaluation = engine.evaluateCommand('rm -rf /', sessionId);
      expect(evaluation.evaluations[0].isDestructive).toBe(true);
      expect(evaluation.evaluations[0].warnings.length).toBeGreaterThan(0);
    });
  });

  describe('permission mode', () => {
    it('should auto-approve commands in allow-all mode', () => {
      const engine = new PermissionEngine(workspacePath, {
        ...DEFAULT_WORKSPACE_PERMISSIONS,
        permissionMode: 'allow-all',
      });

      // Commands that would normally ask should be auto-approved
      const evaluation = engine.evaluateCommand('npm run build', sessionId);
      expect(evaluation.overallDecision).toBe('allow');
      expect(evaluation.evaluations[0].reason).toContain('allow-all');
    });

    it('should still respect denied patterns in allow-all mode', () => {
      const engine = new PermissionEngine(workspacePath, {
        ...DEFAULT_WORKSPACE_PERMISSIONS,
        permissionMode: 'allow-all',
      });

      // Deny a pattern
      engine.denyPatternAlways('npm:run:deploy', 'npm run deploy');

      // Denied patterns should still be denied
      const evaluation = engine.evaluateCommand('npm run deploy', sessionId);
      expect(evaluation.overallDecision).toBe('deny');
    });

    it('should ask in smart permissions mode (default behavior)', () => {
      const engine = createTrustedEngine();
      expect(engine.getPermissionMode()).toBe('ask');

      // Commands should ask for approval
      const evaluation = engine.evaluateCommand('npm run build', sessionId);
      expect(evaluation.overallDecision).toBe('ask');
    });

    it('should be able to switch permission modes', () => {
      const engine = createTrustedEngine();
      expect(engine.getPermissionMode()).toBe('ask');

      engine.setPermissionMode('allow-all');
      expect(engine.getPermissionMode()).toBe('allow-all');

      engine.setPermissionMode('ask');
      expect(engine.getPermissionMode()).toBe('ask');
    });
  });

  describe('additional directories', () => {
    it('should start with no additional directories', () => {
      const engine = createTrustedEngine();
      expect(engine.getAdditionalDirectories()).toEqual([]);
    });

    it('should add additional directories', () => {
      const engine = createTrustedEngine();
      engine.addAdditionalDirectory('/external/docs', false);

      const dirs = engine.getAdditionalDirectories();
      expect(dirs).toHaveLength(1);
      expect(dirs[0].path).toBe('/external/docs');
      expect(dirs[0].canWrite).toBe(false);
    });

    it('should update existing directory if added again', () => {
      const engine = createTrustedEngine();
      engine.addAdditionalDirectory('/external/docs', false);
      engine.addAdditionalDirectory('/external/docs', true);

      const dirs = engine.getAdditionalDirectories();
      expect(dirs).toHaveLength(1);
      expect(dirs[0].canWrite).toBe(true);
    });

    it('should remove additional directories', () => {
      const engine = createTrustedEngine();
      engine.addAdditionalDirectory('/external/docs', false);
      engine.addAdditionalDirectory('/external/shared', true);

      engine.removeAdditionalDirectory('/external/docs');

      const dirs = engine.getAdditionalDirectories();
      expect(dirs).toHaveLength(1);
      expect(dirs[0].path).toBe('/external/shared');
    });

    it('should update write access for additional directories', () => {
      const engine = createTrustedEngine();
      engine.addAdditionalDirectory('/external/docs', false);

      engine.updateAdditionalDirectoryWriteAccess('/external/docs', true);

      const dirs = engine.getAdditionalDirectories();
      expect(dirs[0].canWrite).toBe(true);
    });
  });

  describe('evaluateTool (non-Bash tools)', () => {
    it('should deny all tools when workspace is not trusted', () => {
      // Create untrusted engine (permissionMode: null)
      const engine = new PermissionEngine(workspacePath, {
        ...DEFAULT_WORKSPACE_PERMISSIONS,
        permissionMode: null,
      });

      // Bash tool should be denied
      const bashEval = engine.evaluateTool('Bash', 'ls -la', sessionId);
      expect(bashEval.overallDecision).toBe('deny');

      // Read tool should also be denied
      const readEval = engine.evaluateTool('Read', 'read src/index.ts', sessionId);
      expect(readEval.overallDecision).toBe('deny');

      // Write tool should also be denied
      const writeEval = engine.evaluateTool('Write', 'write src/file.ts', sessionId);
      expect(writeEval.overallDecision).toBe('deny');
    });

    it('should evaluate Bash tool using command parser', () => {
      const engine = createTrustedEngine();
      const evaluation = engine.evaluateTool('Bash', 'ls -la', sessionId);
      expect(evaluation.overallDecision).toBe('allow');
    });

    it('should evaluate Read tool', () => {
      const engine = createTrustedEngine();
      const evaluation = engine.evaluateTool('Read', 'read src/index.ts', sessionId);
      expect(evaluation.overallDecision).toBe('ask');
      expect(evaluation.evaluations[0].action.pattern).toBe('read');
    });

    it('should evaluate Write tool as potentially destructive', () => {
      const engine = createTrustedEngine();
      const evaluation = engine.evaluateTool('Write', 'write src/newfile.ts', sessionId);
      expect(evaluation.hasDestructiveActions).toBe(true);
    });

    it('should evaluate Edit tool', () => {
      const engine = createTrustedEngine();
      const evaluation = engine.evaluateTool('Edit', 'edit src/component.tsx', sessionId);
      expect(evaluation.overallDecision).toBe('ask');
    });

    it('should evaluate WebFetch tool', () => {
      const engine = createTrustedEngine();
      const evaluation = engine.evaluateTool('WebFetch', 'fetch https://example.com', sessionId);
      expect(evaluation.overallDecision).toBe('ask');
      expect(evaluation.evaluations[0].action.pattern).toBe('webfetch');
    });

    it('should evaluate MCP tools', () => {
      const engine = createTrustedEngine();
      const evaluation = engine.evaluateTool('mcp__linear__create_issue', 'linear:create_issue', sessionId);
      expect(evaluation.overallDecision).toBe('ask');
    });

    it('should allow previously approved tool patterns', () => {
      const engine = createTrustedEngine();
      engine.allowPatternAlways('read', 'Read files');

      const evaluation = engine.evaluateTool('Read', 'read src/index.ts', sessionId);
      expect(evaluation.overallDecision).toBe('allow');
    });

    it('should deny previously denied tool patterns', () => {
      const engine = createTrustedEngine();
      engine.denyPatternAlways('write', 'Write files');

      const evaluation = engine.evaluateTool('Write', 'write src/file.ts', sessionId);
      expect(evaluation.overallDecision).toBe('deny');
    });

    it('should detect paths outside workspace for non-Bash tools', () => {
      const engine = createTrustedEngine();
      const evaluation = engine.evaluateTool('Read', 'read /etc/passwd', sessionId);
      expect(evaluation.evaluations[0].outsidePaths.length).toBeGreaterThan(0);
    });
  });

  describe('URL patterns', () => {
    it('should start with no allowed URL patterns', () => {
      const engine = createTrustedEngine();
      expect(engine.getAllowedUrlPatterns()).toEqual([]);
    });

    it('should add URL patterns', () => {
      const engine = createTrustedEngine();
      engine.addAllowedUrlPattern('example.com', 'Example domain');

      const patterns = engine.getAllowedUrlPatterns();
      expect(patterns).toHaveLength(1);
      expect(patterns[0].pattern).toBe('example.com');
      expect(patterns[0].description).toBe('Example domain');
    });

    it('should not add duplicate URL patterns', () => {
      const engine = createTrustedEngine();
      engine.addAllowedUrlPattern('example.com', 'First');
      engine.addAllowedUrlPattern('example.com', 'Second');

      const patterns = engine.getAllowedUrlPatterns();
      expect(patterns).toHaveLength(1);
    });

    it('should remove URL patterns', () => {
      const engine = createTrustedEngine();
      engine.addAllowedUrlPattern('example.com', 'Example');
      engine.addAllowedUrlPattern('test.com', 'Test');

      engine.removeAllowedUrlPattern('example.com');

      const patterns = engine.getAllowedUrlPatterns();
      expect(patterns).toHaveLength(1);
      expect(patterns[0].pattern).toBe('test.com');
    });

    it('should check if URL is allowed - exact hostname match', () => {
      const engine = createTrustedEngine();
      engine.addAllowedUrlPattern('example.com', 'Example');

      expect(engine.isUrlAllowed('https://example.com')).toBe(true);
      expect(engine.isUrlAllowed('https://example.com/path')).toBe(true);
      expect(engine.isUrlAllowed('https://other.com')).toBe(false);
    });

    it('should check if URL is allowed - wildcard subdomain', () => {
      const engine = createTrustedEngine();
      engine.addAllowedUrlPattern('*.example.com', 'Example subdomains');

      expect(engine.isUrlAllowed('https://api.example.com')).toBe(true);
      expect(engine.isUrlAllowed('https://www.example.com/path')).toBe(true);
      expect(engine.isUrlAllowed('https://example.com')).toBe(true);
      expect(engine.isUrlAllowed('https://notexample.com')).toBe(false);
      // Should NOT match evil.example.com.attacker.com
      expect(engine.isUrlAllowed('https://evil.example.com.attacker.com')).toBe(false);
    });

    it('should check if URL is allowed - path wildcard', () => {
      const engine = createTrustedEngine();
      engine.addAllowedUrlPattern('https://api.example.com/*', 'API paths');

      expect(engine.isUrlAllowed('https://api.example.com/v1/users')).toBe(true);
      expect(engine.isUrlAllowed('https://api.example.com/')).toBe(true);
      expect(engine.isUrlAllowed('https://other.example.com/v1')).toBe(false);
    });

    it('should preserve URL patterns in getWorkspacePermissions', () => {
      const engine = createTrustedEngine();
      engine.addAllowedUrlPattern('example.com', 'Example');
      engine.addAllowedUrlPattern('test.com', 'Test');

      const perms = engine.getWorkspacePermissions();
      expect(perms.allowedUrlPatterns).toHaveLength(2);
      expect(perms.allowedUrlPatterns.map(u => u.pattern)).toContain('example.com');
      expect(perms.allowedUrlPatterns.map(u => u.pattern)).toContain('test.com');
    });

    it('should load URL patterns from initial permissions', () => {
      const engine = new PermissionEngine(workspacePath, {
        ...DEFAULT_WORKSPACE_PERMISSIONS,
        permissionMode: 'ask',
        allowedUrlPatterns: [
          { pattern: 'saved.com', description: 'Saved', addedAt: Date.now() },
        ],
      });

      expect(engine.isUrlAllowed('https://saved.com')).toBe(true);
      expect(engine.isUrlAllowed('https://notsaved.com')).toBe(false);
    });
  });

  describe('additional directories for outside paths', () => {
    it('should allow read commands to additional directories', () => {
      const engine = createTrustedEngine();
      engine.addAdditionalDirectory('/external/logs', false);

      // Read-only command to additional directory should be allowed
      const evaluation = engine.evaluateCommand('cat /external/logs/app.log', sessionId);
      expect(evaluation.overallDecision).toBe('allow');
    });

    it('should ask for write commands to read-only additional directories', () => {
      const engine = createTrustedEngine();
      engine.addAdditionalDirectory('/external/logs', false); // read-only

      // Write command should still ask (canWrite is false)
      const evaluation = engine.evaluateCommand('echo test > /external/logs/new.log', sessionId);
      expect(evaluation.overallDecision).toBe('ask');
    });

    it('should allow paths within additional directories', () => {
      const engine = createTrustedEngine();
      engine.addAdditionalDirectory('/external/data', false);

      // Subdirectory should be allowed
      const evaluation = engine.evaluateCommand('ls /external/data/subdir', sessionId);
      expect(evaluation.overallDecision).toBe('allow');
    });

    it('should not allow paths outside additional directories', () => {
      const engine = createTrustedEngine();
      engine.addAdditionalDirectory('/external/data', false);

      // Different directory should still ask
      const evaluation = engine.evaluateCommand('ls /external/other', sessionId);
      expect(evaluation.overallDecision).toBe('ask');
      expect(evaluation.evaluations[0].outsidePaths).toContain('/external/other');
    });

    it('should handle paths with spaces in additional directories', () => {
      const engine = createTrustedEngine();
      engine.addAdditionalDirectory('/Users/test/Library/Application Support/MyApp', false);

      const evaluation = engine.evaluateCommand('cat "/Users/test/Library/Application Support/MyApp/config.json"', sessionId);
      expect(evaluation.overallDecision).toBe('allow');
    });

    it('should preserve additional directories in getWorkspacePermissions', () => {
      const engine = createTrustedEngine();
      engine.addAdditionalDirectory('/external/docs', false);
      engine.addAdditionalDirectory('/external/shared', true);

      const perms = engine.getWorkspacePermissions();
      expect(perms.additionalDirectories).toHaveLength(2);
      expect(perms.additionalDirectories.find(d => d.path === '/external/docs')?.canWrite).toBe(false);
      expect(perms.additionalDirectories.find(d => d.path === '/external/shared')?.canWrite).toBe(true);
    });
  });

  describe('serialization with URL patterns', () => {
    it('should serialize URL patterns', () => {
      const permissions: WorkspacePermissions = {
        ...DEFAULT_WORKSPACE_PERMISSIONS,
        permissionMode: 'ask',
        allowedUrlPatterns: [
          { pattern: 'example.com', description: 'Example', addedAt: 1000 },
          { pattern: '*.github.com', description: 'GitHub', addedAt: 2000 },
        ],
      };

      const serialized = serializeWorkspacePermissions(permissions);

      expect(serialized.allowedUrlPatterns).toHaveLength(2);
      expect(serialized.allowedUrlPatterns![0].pattern).toBe('example.com');
      expect(serialized.allowedUrlPatterns![1].pattern).toBe('*.github.com');
    });

    it('should deserialize URL patterns', () => {
      const data = {
        allowedPatterns: [],
        deniedPatterns: [],
        permissionMode: 'ask',
        additionalDirectories: [],
        allowedUrlPatterns: [
          { pattern: 'example.com', description: 'Example', addedAt: 1000 },
        ],
      };

      const permissions = deserializeWorkspacePermissions(data);

      expect(permissions.allowedUrlPatterns).toHaveLength(1);
      expect(permissions.allowedUrlPatterns[0].pattern).toBe('example.com');
    });

    it('should handle missing allowedUrlPatterns in deserialization', () => {
      const data = {
        allowedPatterns: [],
        deniedPatterns: [],
        permissionMode: 'ask',
        additionalDirectories: [],
        // No allowedUrlPatterns field
      };

      const permissions = deserializeWorkspacePermissions(data);

      expect(permissions.allowedUrlPatterns).toEqual([]);
    });
  });
});
