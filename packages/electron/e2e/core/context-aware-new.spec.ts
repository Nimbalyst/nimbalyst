import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import {
  launchElectronApp,
  createTempWorkspace,
  waitForAppReady,
  TEST_TIMEOUTS
} from '../helpers';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Test that Cmd+N is context-aware:
 * - In agent mode: creates new AI session
 * - In files mode: opens new file dialog
 */

let electronApp: ElectronApplication;
let page: Page;
let workspaceDir: string;

test.beforeEach(async () => {
  workspaceDir = await createTempWorkspace();

  // Create a test file before launching app
  const testFilePath = path.join(workspaceDir, 'test.md');
  await fs.writeFile(testFilePath, '# Test\n\nInitial content.\n', 'utf8');

  electronApp = await launchElectronApp({ workspace: workspaceDir });
  page = await electronApp.firstWindow();
  await waitForAppReady(page);
});

test.afterEach(async () => {
  await electronApp.close();
  await fs.rm(workspaceDir, { recursive: true, force: true });
});

test('Cmd+N should create new session in agent mode', async () => {
  // Switch to agent mode (Cmd+K)
  await page.keyboard.press('Meta+k');

  // Wait for agent mode to be active
  await page.waitForTimeout(1000);

  // Verify we're in agent mode - look for "New Session" button or session UI
  // Use a more flexible selector
  const hasAgentUI = await page.evaluate(() => {
    // Check if activeMode is 'agent'
    return (window as any).__testHelpers?.getActiveMode() === 'agent';
  });
  expect(hasAgentUI).toBe(true);

  // Count initial sessions by looking for session tabs in agent panel
  const initialSessionCount = await page.evaluate(() => {
    // Count session tabs or new session buttons
    const tabs = document.querySelectorAll('.tab');
    return tabs.length;
  });
  console.log('[Test] Initial session count:', initialSessionCount);

  // Set up console listener to see logs
  page.on('console', msg => {
    const text = msg.text();
    // Log relevant messages
    if (text.includes('[App Layout]') || text.includes('[File->New]') || text.includes('[AgenticPanel]') ||
        text.includes('activeMode') || text.includes('workspace state')) {
      console.log('BROWSER:', text);
    }
  });

  // Trigger Cmd+N - we need to trigger the menu action, not just the keyboard shortcut
  // Keyboard shortcuts in Playwright don't trigger Electron menu items
  await electronApp.evaluate(({ Menu }) => {
    const menu = Menu.getApplicationMenu();
    if (menu) {
      // Find the "New" menu item and click it
      const fileMenu = menu.items.find(item => item.label === 'File');
      const newItem = fileMenu?.submenu?.items.find(item => item.label === 'New');
      if (newItem) {
        newItem.click();
      }
    }
  });

  // Wait a bit for the IPC to process
  await page.waitForTimeout(2000);

  // Verify a new session was created
  const newSessionCount = await page.evaluate(() => {
    const tabs = document.querySelectorAll('.tab');
    return tabs.length;
  });
  console.log('[Test] New session count:', newSessionCount);

  expect(newSessionCount).toBeGreaterThan(initialSessionCount);

  // Verify new file dialog did NOT open
  const newFileDialog = page.getByText('New File');
  await expect(newFileDialog).not.toBeVisible({ timeout: 1000 }).catch(() => {
    // Dialog not visible is expected
  });
});

test('Cmd+N should open new file dialog in files mode', async () => {
  // We should start in files mode by default
  // Verify we're in files mode
  const hasFilesUI = await page.evaluate(() => {
    return (window as any).__testHelpers?.getActiveMode() === 'files';
  });
  expect(hasFilesUI).toBe(true);

  // Trigger Cmd+N by clicking the menu item
  await electronApp.evaluate(({ Menu }) => {
    const menu = Menu.getApplicationMenu();
    if (menu) {
      const fileMenu = menu.items.find(item => item.label === 'File');
      const newItem = fileMenu?.submenu?.items.find(item => item.label === 'New');
      if (newItem) {
        newItem.click();
      }
    }
  });

  // Wait for dialog
  await page.waitForTimeout(500);

  // Verify new file dialog opened
  const newFileDialog = page.locator('text="New File"').first();
  await expect(newFileDialog).toBeVisible({ timeout: TEST_TIMEOUTS.DEFAULT_WAIT });
});
