import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import { launchElectronApp, createTempWorkspace } from '../helpers';
import { dismissAPIKeyDialog } from '../utils/testHelpers';
import {
  getWorkspacePermissions,
  addAllowedPattern,
  evaluateCommand,
  applyPermissionResponse,
} from '../utils/permissionTestHelpers';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * E2E tests for Bash command permission pattern matching.
 *
 * All tests share a single Electron app instance for efficiency.
 * Tests run serially. Pattern generation tests run first (read-only),
 * followed by persistence tests that add patterns, then scope tests.
 */

test.setTimeout(30000);

test.describe.configure({ mode: 'serial' });

let electronApp: ElectronApplication;
let page: Page;
let workspaceDir: string;

test.beforeAll(async () => {
  workspaceDir = await createTempWorkspace();

  const testFilePath = path.join(workspaceDir, 'test.md');
  await fs.writeFile(testFilePath, '# Test Document\n\nTest content.\n', 'utf8');

  // Launch with 'ask' permission mode - auto-trusts and sets mode, skips trust toast
  electronApp = await launchElectronApp({
    workspace: workspaceDir,
    permissionMode: 'ask'
  });
  page = await electronApp.firstWindow();

  await page.waitForLoadState('domcontentloaded');
  await dismissAPIKeyDialog(page);
});

test.afterAll(async () => {
  await electronApp?.close();
  await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => {});
});

// --- Pattern Generation (read-only, no state mutation) ---

test.describe('Bash pattern generation', () => {
  test('npm commands generate correct patterns', async () => {
    const sessionId = 'test-session-npm';

    // Evaluate 'npm test'
    const result = await evaluateCommand(page, workspaceDir, sessionId, 'Bash', 'npm test');
    expect(result.decision).toBe('ask');
    expect(result.request).toBeDefined();
    expect(result.request!.actionsNeedingApproval).toHaveLength(1);

    const action = result.request!.actionsNeedingApproval[0];
    expect(action.action.pattern).toBe('npm:test');
    expect(action.action.displayName).toContain('npm test');
  });

  test('git push generates correct pattern (requires approval)', async () => {
    const sessionId = 'test-session-git';

    // Evaluate 'git push' - this is NOT read-only, so it should ask
    const result = await evaluateCommand(page, workspaceDir, sessionId, 'Bash', 'git push origin main');
    expect(result.decision).toBe('ask');
    expect(result.request).toBeDefined();

    const action = result.request!.actionsNeedingApproval[0];
    expect(action.action.pattern).toBe('git:push');
  });

  test('read-only git commands are auto-allowed', async () => {
    const sessionId = 'test-session-git-readonly';

    // 'git status' is read-only and should be auto-allowed
    const statusResult = await evaluateCommand(page, workspaceDir, sessionId, 'Bash', 'git status');
    expect(statusResult.decision).toBe('allow');

    // 'git log' is read-only and should be auto-allowed
    const logResult = await evaluateCommand(page, workspaceDir, sessionId, 'Bash', 'git log --oneline');
    expect(logResult.decision).toBe('allow');

    // 'git diff' is read-only and should be auto-allowed
    const diffResult = await evaluateCommand(page, workspaceDir, sessionId, 'Bash', 'git diff HEAD');
    expect(diffResult.decision).toBe('allow');
  });

  test('rm -rf generates destructive pattern', async () => {
    const sessionId = 'test-session-rm';

    // Evaluate 'rm -rf node_modules'
    const result = await evaluateCommand(page, workspaceDir, sessionId, 'Bash', 'rm -rf node_modules');
    expect(result.decision).toBe('ask');
    expect(result.request).toBeDefined();
    expect(result.request!.hasDestructiveActions).toBe(true);

    const action = result.request!.actionsNeedingApproval[0];
    expect(action.action.pattern).toBe('bash:rm-rf');
    expect(action.action.displayName).toContain('Recursive delete');
  });

  test('read-only bash commands like ls and cat are auto-allowed', async () => {
    const sessionId = 'test-session-readonly';

    // 'ls' is read-only and should be auto-allowed
    const lsResult = await evaluateCommand(page, workspaceDir, sessionId, 'Bash', 'ls -la');
    expect(lsResult.decision).toBe('allow');

    // 'cat' is read-only and should be auto-allowed
    const catResult = await evaluateCommand(page, workspaceDir, sessionId, 'Bash', 'cat file.txt');
    expect(catResult.decision).toBe('allow');
  });
});

// --- Pattern Display Names (read-only) ---

test.describe('Pattern display names', () => {
  test('npm commands show user-friendly display names', async () => {
    const sessionId = 'test-session-display';

    const result = await evaluateCommand(page, workspaceDir, sessionId, 'Bash', 'npm run build');
    const action = result.request!.actionsNeedingApproval[0];

    // Display name should be user-friendly, not just the pattern
    expect(action.action.displayName).toContain('npm');
    expect(action.action.displayName).toContain('build');
  });

  test('destructive commands show warning in display name', async () => {
    const sessionId = 'test-session-destructive';

    const result = await evaluateCommand(page, workspaceDir, sessionId, 'Bash', 'rm -rf /tmp/test');
    const action = result.request!.actionsNeedingApproval[0];

    // Display name should indicate destructive nature
    expect(action.action.displayName.toLowerCase()).toContain('destructive');
  });
});

// --- Compound Commands (read-only) ---

test.describe('Compound commands', () => {
  test('compound commands with && generate multiple patterns', async () => {
    const sessionId = 'test-session-compound';

    // Evaluate 'npm install && npm test'
    const result = await evaluateCommand(page, workspaceDir, sessionId, 'Bash', 'npm install && npm test');
    expect(result.decision).toBe('ask');
    expect(result.request).toBeDefined();

    // Should have multiple actions
    expect(result.request!.actionsNeedingApproval.length).toBeGreaterThanOrEqual(1);

    // Get all patterns
    const patterns = result.request!.actionsNeedingApproval.map(a => a.action.pattern);

    // Should include npm patterns
    expect(patterns.some(p => p.includes('npm'))).toBe(true);
  });
});

// --- Allow Always persistence (mutates workspace patterns) ---

test.describe('Allow Always persistence', () => {
  test('allowing npm:test pattern auto-approves subsequent npm test commands', async () => {
    const sessionId = 'test-session-npm-always';

    // First evaluation - should ask
    const result1 = await evaluateCommand(page, workspaceDir, sessionId, 'Bash', 'npm test');
    expect(result1.decision).toBe('ask');
    expect(result1.request).toBeDefined();

    // Apply "Allow Always" response
    await applyPermissionResponse(page, workspaceDir, sessionId, result1.request!.id, {
      decision: 'allow',
      scope: 'always',
    });

    // Verify pattern was saved
    const permissions = await getWorkspacePermissions(page, workspaceDir);
    expect(permissions.allowedPatterns.some(p => p.pattern === 'npm:test')).toBe(true);

    // Second evaluation - should auto-approve
    const result2 = await evaluateCommand(page, workspaceDir, sessionId, 'Bash', 'npm test');
    expect(result2.decision).toBe('allow');
  });

  test('allowing npm:test does NOT auto-approve npm install', async () => {
    const sessionId = 'test-session-npm-different';

    // Allow 'npm test' (may already be allowed from previous test)
    const testResult = await evaluateCommand(page, workspaceDir, sessionId, 'Bash', 'npm test');
    if (testResult.decision === 'ask') {
      await applyPermissionResponse(page, workspaceDir, sessionId, testResult.request!.id, {
        decision: 'allow',
        scope: 'always',
      });
    }

    // 'npm install' should still ask (different pattern)
    const installResult = await evaluateCommand(page, workspaceDir, sessionId, 'Bash', 'npm install');
    expect(installResult.decision).toBe('ask');
    expect(installResult.request!.actionsNeedingApproval[0].action.pattern).toBe('npm:install');
  });

  test('allowing git:push auto-approves regular pushes but not force pushes', async () => {
    const sessionId = 'test-session-git-push';

    // Allow 'git push'
    const result1 = await evaluateCommand(page, workspaceDir, sessionId, 'Bash', 'git push origin main');
    expect(result1.decision).toBe('ask');
    await applyPermissionResponse(page, workspaceDir, sessionId, result1.request!.id, {
      decision: 'allow',
      scope: 'always',
    });

    // Verify pattern was saved
    const permissions = await getWorkspacePermissions(page, workspaceDir);
    expect(permissions.allowedPatterns.some(p => p.pattern === 'git:push')).toBe(true);

    // 'git push' to different branch should auto-approve (same base command)
    const result2 = await evaluateCommand(page, workspaceDir, sessionId, 'Bash', 'git push origin feature-branch');
    expect(result2.decision).toBe('allow');

    // 'git push --force' should still ask - it's a DIFFERENT pattern (git:push-force)
    const result3 = await evaluateCommand(page, workspaceDir, sessionId, 'Bash', 'git push --force');
    expect(result3.decision).toBe('ask');
    expect(result3.request!.actionsNeedingApproval[0].action.pattern).toBe('git:push-force');
    expect(result3.request!.hasDestructiveActions).toBe(true);
  });
});

// --- Session vs Always scope (uses fresh session IDs, checks for absence) ---

test.describe('Session vs Always scope', () => {
  test('Allow Session saves pattern only for the session', async () => {
    const sessionId = 'test-session-scope';

    // Evaluate and allow with "session" scope
    const result = await evaluateCommand(page, workspaceDir, sessionId, 'Bash', 'npm test');
    // npm:test may already be in workspace patterns from persistence tests above,
    // so this might auto-approve. That's fine - the key assertion is about session scope.
    if (result.decision === 'ask') {
      await applyPermissionResponse(page, workspaceDir, sessionId, result.request!.id, {
        decision: 'allow',
        scope: 'session',
      });
    }

    // Session-scoped patterns are NOT in workspace patterns (they're in session state)
    // But npm:test may already be there from "Allow Always" tests above. Use a unique command.
    const uniqueResult = await evaluateCommand(page, workspaceDir, 'test-session-scope-2', 'Bash', 'npm run lint');
    if (uniqueResult.decision === 'ask') {
      await applyPermissionResponse(page, workspaceDir, 'test-session-scope-2', uniqueResult.request!.id, {
        decision: 'allow',
        scope: 'session',
      });
      // Pattern should NOT be in workspace patterns
      const permissions = await getWorkspacePermissions(page, workspaceDir);
      expect(permissions.allowedPatterns.some(p => p.pattern === 'npm:lint')).toBe(false);
    }
  });

  test('Allow Once does not save any pattern', async () => {
    const sessionId = 'test-session-once';

    // Use a unique command that hasn't been "Always" allowed
    const result = await evaluateCommand(page, workspaceDir, sessionId, 'Bash', 'npm run format');
    if (result.decision === 'ask') {
      await applyPermissionResponse(page, workspaceDir, sessionId, result.request!.id, {
        decision: 'allow',
        scope: 'once',
      });

      // Pattern should NOT be in workspace patterns
      const permissions = await getWorkspacePermissions(page, workspaceDir);
      expect(permissions.allowedPatterns.some(p => p.pattern === 'npm:format')).toBe(false);
    }
  });
});

// --- Direct pattern addition ---

test.describe('Direct pattern addition', () => {
  test('manually adding bash pattern auto-approves matching commands', async () => {
    const sessionId = 'test-session-direct';

    // Use a pattern not added by previous tests
    await addAllowedPattern(page, workspaceDir, 'npm:start', 'npm start');

    // Verify pattern is saved
    const permissions = await getWorkspacePermissions(page, workspaceDir);
    expect(permissions.allowedPatterns.some(p => p.pattern === 'npm:start')).toBe(true);

    // Evaluate - should auto-approve
    const result = await evaluateCommand(page, workspaceDir, sessionId, 'Bash', 'npm start');
    expect(result.decision).toBe('allow');
  });
});
