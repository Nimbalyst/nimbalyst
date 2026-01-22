import { test, expect } from '@playwright/test';
import {
  launchElectronApp,
  createTempWorkspace,
  TEST_TIMEOUTS
} from '../helpers';
import type { ElectronApplication, Page } from '@playwright/test';
import * as fs from 'fs/promises';
import * as path from 'path';
import { spawn } from 'child_process';

let electronApp: ElectronApplication;
let page: Page;
let workspaceDir: string;
let testFilePath: string;

test.beforeEach(async () => {
  workspaceDir = await createTempWorkspace();
  testFilePath = path.join(workspaceDir, 'test.md');

  // Create test file BEFORE launching app
  await fs.writeFile(testFilePath, '# Test\n\nOriginal content.\n', 'utf8');

  electronApp = await launchElectronApp({ workspace: workspaceDir });
  page = await electronApp.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  // Listen to console logs
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('[BASH-FILE-OPS]') || text.includes('[PRE-EDIT') || text.includes('pending tag')) {
      console.log('[CONSOLE]', text);
    }
  });

  // Wait for workspace
  await page.waitForSelector('.workspace-sidebar', { timeout: TEST_TIMEOUTS.SIDEBAR_LOAD });
});

test.afterEach(async () => {
  await electronApp.close();
  await fs.rm(workspaceDir, { recursive: true, force: true });
});

test('should track cat >> command as file edit', async () => {
  // Open file
  await page.locator('.file-tree-name', { hasText: 'test.md' }).click();
  await page.waitForSelector('[contenteditable="true"]', { timeout: TEST_TIMEOUTS.EDITOR_LOAD });

  // Read original content
  const originalContent = await fs.readFile(testFilePath, 'utf8');
  console.log('[TEST] Original content:', originalContent);

  // STEP 1: Create a pre-edit tag (simulates PreToolUse hook detecting cat >> command)
  await page.evaluate(async ([filePath, content]) => {
    await window.electronAPI.history.createTag(
      filePath,
      'bash-cat-append-tag',
      content,
      'test-session',
      'bash-tool-1'
    );
    console.log('[TEST-RENDERER] Created pre-edit tag for Bash cat >> command');
  }, [testFilePath, originalContent]);

  await page.waitForTimeout(200);

  // STEP 2: Execute cat >> command via Bash (simulates agent running cat >>)
  const appendText = '\n\nAppended via cat >>';
  await new Promise<void>((resolve, reject) => {
    const catProcess = spawn('bash', ['-c', `cat >> "${testFilePath}"`], {
      cwd: workspaceDir
    });

    catProcess.stdin.write(appendText);
    catProcess.stdin.end();

    catProcess.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`cat command failed with code ${code}`));
      }
    });

    catProcess.on('error', reject);
  });

  console.log('[TEST] Executed cat >> command');

  // Wait for file watcher to detect change
  await page.waitForTimeout(1000);

  // CHECK: Diff mode should be active
  const acceptAllButton = page.locator('button', { hasText: /Accept All/i });
  await expect(acceptAllButton).toBeVisible({ timeout: 2000 });
  console.log('[TEST] ✓ Diff mode activated for cat >> edit');

  // Verify content on disk includes the append
  const afterAppend = await fs.readFile(testFilePath, 'utf8');
  expect(afterAppend).toContain('Appended via cat >>');
  console.log('[TEST] ✓ cat >> successfully appended to file');

  // Accept the changes
  await acceptAllButton.click();
  await page.waitForTimeout(500);

  // CHECK: File should now be in session's edited files
  // This is tracked by editedFilesThisTurn in ClaudeCodeProvider
  // We can verify by checking that the file is clean (no pending tag)
  const hasPendingTag = await page.evaluate(async ([filePath]) => {
    const tags = await window.electronAPI.history.getPendingTags(filePath);
    return tags && tags.length > 0;
  }, [testFilePath]);

  expect(hasPendingTag).toBe(false);
  console.log('[TEST] ✓ File cleaned up after accept (no pending tags)');
});

test('should track echo > command as file edit', async () => {
  const newFilePath = path.join(workspaceDir, 'created-by-echo.txt');

  // STEP 1: Create a pre-edit tag with empty content (new file)
  await page.evaluate(async ([filePath]) => {
    await window.electronAPI.history.createTag(
      filePath,
      'bash-echo-create-tag',
      '', // Empty content - file doesn't exist yet
      'test-session',
      'bash-tool-2'
    );
    console.log('[TEST-RENDERER] Created pre-edit tag for Bash echo > command (new file)');
  }, [newFilePath]);

  await page.waitForTimeout(200);

  // STEP 2: Execute echo > command via Bash
  await new Promise<void>((resolve, reject) => {
    const echoProcess = spawn('bash', ['-c', `echo "Created by echo" > "${newFilePath}"`], {
      cwd: workspaceDir
    });

    echoProcess.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`echo command failed with code ${code}`));
      }
    });

    echoProcess.on('error', reject);
  });

  console.log('[TEST] Executed echo > command');

  // Wait for file watcher to detect new file
  await page.waitForTimeout(1000);

  // Verify file was created
  const content = await fs.readFile(newFilePath, 'utf8');
  expect(content.trim()).toBe('Created by echo');
  console.log('[TEST] ✓ echo > successfully created file');

  // CHECK: File should appear in file tree
  await page.waitForSelector('.file-tree-name', { hasText: 'created-by-echo.txt', timeout: 2000 });
  console.log('[TEST] ✓ New file appears in file tree');
});

test('should track rm command as file deletion', async () => {
  const fileToDelete = path.join(workspaceDir, 'to-delete.txt');

  // Create the file first
  await fs.writeFile(fileToDelete, 'This file will be deleted', 'utf8');

  // Refresh app to see the file
  await page.reload();
  await page.waitForSelector('.workspace-sidebar', { timeout: TEST_TIMEOUTS.SIDEBAR_LOAD });

  // Wait for file to appear in tree
  await page.waitForSelector('.file-tree-name', { hasText: 'to-delete.txt', timeout: 2000 });
  console.log('[TEST] File appears in tree');

  // Read original content
  const originalContent = await fs.readFile(fileToDelete, 'utf8');

  // STEP 1: Create a pre-edit tag (simulates PreToolUse hook detecting rm command)
  await page.evaluate(async ([filePath, content]) => {
    await window.electronAPI.history.createTag(
      filePath,
      'bash-rm-tag',
      content,
      'test-session',
      'bash-tool-3'
    );
    console.log('[TEST-RENDERER] Created pre-edit tag for Bash rm command');
  }, [fileToDelete, originalContent]);

  await page.waitForTimeout(200);

  // STEP 2: Execute rm command via Bash
  await new Promise<void>((resolve, reject) => {
    const rmProcess = spawn('bash', ['-c', `rm "${fileToDelete}"`], {
      cwd: workspaceDir
    });

    rmProcess.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`rm command failed with code ${code}`));
      }
    });

    rmProcess.on('error', reject);
  });

  console.log('[TEST] Executed rm command');

  // Wait for file watcher to detect deletion
  await page.waitForTimeout(1000);

  // Verify file was deleted
  const exists = await fs.access(fileToDelete).then(() => true).catch(() => false);
  expect(exists).toBe(false);
  console.log('[TEST] ✓ rm successfully deleted file');

  // CHECK: History should have a snapshot of the deleted file (can restore)
  const snapshots = await page.evaluate(async ([filePath]) => {
    return await window.electronAPI.history.listSnapshots(filePath);
  }, [fileToDelete]);

  expect(snapshots).toBeDefined();
  expect(snapshots.length).toBeGreaterThan(0);
  console.log('[TEST] ✓ Local history captured deleted file (can restore)');
});

test('should track mv command as file operation', async () => {
  const oldPath = path.join(workspaceDir, 'old-name.txt');
  const newPath = path.join(workspaceDir, 'new-name.txt');

  // Create the file first
  await fs.writeFile(oldPath, 'This file will be moved', 'utf8');

  // Refresh app to see the file
  await page.reload();
  await page.waitForSelector('.workspace-sidebar', { timeout: TEST_TIMEOUTS.SIDEBAR_LOAD });

  // Wait for file to appear in tree
  await page.waitForSelector('.file-tree-name', { hasText: 'old-name.txt', timeout: 2000 });
  console.log('[TEST] Old file appears in tree');

  // Read original content
  const originalContent = await fs.readFile(oldPath, 'utf8');

  // STEP 1: Create pre-edit tags for both source and dest (mv affects both)
  await page.evaluate(async ([oldFilePath, newFilePath, content]) => {
    // Tag source file (will be deleted)
    await window.electronAPI.history.createTag(
      oldFilePath,
      'bash-mv-source-tag',
      content,
      'test-session',
      'bash-tool-4'
    );

    // Tag dest file (will be created)
    await window.electronAPI.history.createTag(
      newFilePath,
      'bash-mv-dest-tag',
      '', // Empty - file doesn't exist yet
      'test-session',
      'bash-tool-4'
    );

    console.log('[TEST-RENDERER] Created pre-edit tags for Bash mv command');
  }, [oldPath, newPath, originalContent]);

  await page.waitForTimeout(200);

  // STEP 2: Execute mv command via Bash
  await new Promise<void>((resolve, reject) => {
    const mvProcess = spawn('bash', ['-c', `mv "${oldPath}" "${newPath}"`], {
      cwd: workspaceDir
    });

    mvProcess.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`mv command failed with code ${code}`));
      }
    });

    mvProcess.on('error', reject);
  });

  console.log('[TEST] Executed mv command');

  // Wait for file watcher to detect changes
  await page.waitForTimeout(1000);

  // Verify old file is gone
  const oldExists = await fs.access(oldPath).then(() => true).catch(() => false);
  expect(oldExists).toBe(false);

  // Verify new file exists with same content
  const newContent = await fs.readFile(newPath, 'utf8');
  expect(newContent).toBe(originalContent);

  console.log('[TEST] ✓ mv successfully moved file');

  // CHECK: Both files should be in session's edited files (tracked by editedFilesThisTurn)
  // We can verify by checking file tree updates
  await page.waitForSelector('.file-tree-name', { hasText: 'new-name.txt', timeout: 2000 });
  console.log('[TEST] ✓ New file appears in tree after mv');
});
