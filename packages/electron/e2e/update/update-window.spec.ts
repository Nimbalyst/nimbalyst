import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import {
  launchElectronApp,
  createTempWorkspace,
  TEST_TIMEOUTS
} from '../helpers';
import path from 'path';
import fs from 'fs/promises';

test.describe('Update Window', () => {
  let electronApp: ElectronApplication;
  let page: Page;
  let workspacePath: string;

  test.beforeEach(async () => {
    // Create a temporary workspace
    workspacePath = await createTempWorkspace();
    const testFilePath = path.join(workspacePath, 'test.md');
    await fs.writeFile(testFilePath, '# Test Document\n\nThis is a test.');

    // Launch app with workspace
    electronApp = await launchElectronApp({
      workspace: workspacePath,
      env: { NODE_ENV: 'test' }
    });

    page = await electronApp.firstWindow();

    // Listen to console logs
    page.on('console', msg => {
      const text = msg.text();
      console.log(`[BROWSER ${msg.type()}]`, text);
    });
  });

  test.afterEach(async () => {
    if (electronApp) {
      await electronApp.close();
    }
    await fs.rm(workspacePath, { recursive: true, force: true }).catch(() => undefined);
  });

  test('should show update available state with formatted release notes', async () => {
    console.log('[TEST] Triggering update available event...');

    // Trigger the update available event via IPC
    await page.evaluate(async () => {
      await window.electronAPI.invoke('test:trigger-update-available', {
        version: '1.0.0',
        releaseNotes: `# Version 1.0.0

## Features
- New feature 1
- New feature 2

## Bug Fixes
- Fix bug 1
- Fix bug 2

## Code Example
\`\`\`javascript
console.log('Hello World');
\`\`\``,
        releaseDate: '2025-10-09'
      });
    });

    // Wait for update window to appear
    await page.waitForTimeout(1000);

    // Get all windows
    const windows = await electronApp.windows();
    console.log('[TEST] Number of windows:', windows.length);

    // Find the update window (should be the last one opened)
    const updateWindow = windows[windows.length - 1];
    expect(updateWindow).toBeTruthy();

    // Wait for update window to load
    await updateWindow.waitForLoadState('domcontentloaded');
    await updateWindow.waitForTimeout(500);

    // Check that update available state is shown
    const availableState = updateWindow.locator('#state-available');
    await expect(availableState).toBeVisible({ timeout: 5000 });

    // Check version numbers are displayed
    const currentVersion = updateWindow.locator('#current-version');
    const newVersion = updateWindow.locator('#new-version');
    await expect(currentVersion).toBeVisible();
    await expect(newVersion).toBeVisible();
    await expect(newVersion).toContainText('1.0.0');

    // Check release notes are rendered
    const releaseNotes = updateWindow.locator('#release-notes');
    await expect(releaseNotes).toBeVisible();

    // Verify markdown is rendered (check for h1, ul, code)
    const h1 = releaseNotes.locator('h1');
    await expect(h1).toContainText('Version 1.0.0');

    const h2 = releaseNotes.locator('h2').first();
    await expect(h2).toContainText('Features');

    const listItems = releaseNotes.locator('li');
    expect(await listItems.count()).toBeGreaterThan(0);

    const codeBlock = releaseNotes.locator('pre code');
    await expect(codeBlock).toContainText('console.log');

    // Check buttons are visible
    const laterButton = updateWindow.locator('#btn-later');
    const downloadButton = updateWindow.locator('#btn-download');
    await expect(laterButton).toBeVisible();
    await expect(downloadButton).toBeVisible();
  });

  test('should transition to downloading state and show progress', async () => {
    console.log('[TEST] Testing download progress state...');

    // Trigger update available
    await page.evaluate(async () => {
      await window.electronAPI.invoke('test:trigger-update-available', {
        version: '1.0.0',
        releaseNotes: '## Release Notes\n\nTest release',
      });
    });

    await page.waitForTimeout(1000);

    // Find the update window by title
    const windows = await electronApp.windows();
    console.log('[TEST] All windows:', windows.length);

    let updateWindow = null;
    for (const win of windows) {
      const title = await win.title();
      console.log('[TEST] Window title:', title);
      if (title === 'Update Available') {
        updateWindow = win;
        break;
      }
    }

    expect(updateWindow).toBeTruthy();
    await updateWindow!.waitForLoadState('domcontentloaded');
    await updateWindow!.waitForTimeout(1000); // Give time for JS to load

    // Verify we're on the update window by checking for state-available
    const availableState = updateWindow!.locator('#state-available');
    await expect(availableState).toBeVisible({ timeout: 5000 });

    // Click download button
    const downloadButton = updateWindow!.locator('#btn-download');
    await expect(downloadButton).toBeVisible();
    console.log('[TEST] Clicking download button...');
    await downloadButton.click();

    // Check downloading state is shown (should transition immediately)
    const downloadingState = updateWindow!.locator('#state-downloading');
    await expect(downloadingState).toBeVisible({ timeout: 5000 });

    // Simulate download progress
    for (let i = 0; i <= 100; i += 20) {
      await page.evaluate(async (percent) => {
        await window.electronAPI.invoke('test:trigger-download-progress', {
          percent: percent,
          bytesPerSecond: 1024 * 1024 * 2, // 2 MB/s
          transferred: (50 * 1024 * 1024 * percent) / 100, // 50 MB total
          total: 50 * 1024 * 1024
        });
      }, i);
      await updateWindow!.waitForTimeout(200);
    }

    // Check progress bar is visible and updating
    const progressBar = updateWindow!.locator('#progress-fill');
    await expect(progressBar).toBeVisible();

    // Check progress text
    const progressText = updateWindow!.locator('#progress-text');
    await expect(progressText).toBeVisible();

    // Eventually should show 100%
    await expect(progressText).toContainText('100%', { timeout: 5000 });

    // Check download stats are shown
    const downloadSpeed = updateWindow!.locator('#download-speed');
    const downloadSize = updateWindow!.locator('#download-size');
    await expect(downloadSpeed).toBeVisible();
    await expect(downloadSize).toBeVisible();
  });

  test('should show ready to install state after download', async () => {
    console.log('[TEST] Testing ready to install state...');

    // Trigger update available
    await page.evaluate(async () => {
      await window.electronAPI.invoke('test:trigger-update-available', {
        version: '1.0.0',
        releaseNotes: '## Release Notes\n\nTest release',
      });
    });

    await page.waitForTimeout(1000);

    const windows = await electronApp.windows();
    const updateWindow = windows[windows.length - 1];
    await updateWindow.waitForLoadState('domcontentloaded');

    // Trigger ready state directly
    await page.evaluate(async () => {
      await window.electronAPI.invoke('test:trigger-update-ready', {
        version: '1.0.0',
      });
    });

    await updateWindow.waitForTimeout(500);

    // Check ready state is shown
    const readyState = updateWindow.locator('#state-ready');
    await expect(readyState).toBeVisible({ timeout: 3000 });

    // Check ready message
    const readyMessage = updateWindow.locator('.ready-message');
    await expect(readyMessage).toBeVisible();
    await expect(readyMessage).toContainText('1.0.0');

    // Check ready icon
    const readyIcon = updateWindow.locator('.ready-icon');
    await expect(readyIcon).toBeVisible();

    // Check buttons
    const installLaterButton = updateWindow.locator('#btn-install-later');
    const restartButton = updateWindow.locator('#btn-restart');
    await expect(installLaterButton).toBeVisible();
    await expect(restartButton).toBeVisible();
    await expect(restartButton).toContainText('Restart');
  });

  test('should show error state when update fails', async () => {
    console.log('[TEST] Testing error state...');

    // Trigger update available
    await page.evaluate(async () => {
      await window.electronAPI.invoke('test:trigger-update-available', {
        version: '1.0.0',
        releaseNotes: '## Release Notes\n\nTest release',
      });
    });

    await page.waitForTimeout(1000);

    const windows = await electronApp.windows();
    const updateWindow = windows[windows.length - 1];
    await updateWindow.waitForLoadState('domcontentloaded');

    // Trigger error state
    await page.evaluate(async () => {
      await window.electronAPI.invoke('test:trigger-update-error', 'Network connection failed. Please check your internet connection and try again.');
    });

    await updateWindow.waitForTimeout(500);

    // Check error state is shown
    const errorState = updateWindow.locator('#state-error');
    await expect(errorState).toBeVisible({ timeout: 3000 });

    // Check error message
    const errorMessage = updateWindow.locator('#error-message');
    await expect(errorMessage).toBeVisible();
    await expect(errorMessage).toContainText('Network connection failed');

    // Check error icon
    const errorIcon = updateWindow.locator('.error-icon');
    await expect(errorIcon).toBeVisible();

    // Check buttons
    const closeButton = updateWindow.locator('#btn-error-close');
    const retryButton = updateWindow.locator('#btn-error-retry');
    await expect(closeButton).toBeVisible();
    await expect(retryButton).toBeVisible();
  });

  test('should apply theme changes to update window', async () => {
    console.log('[TEST] Testing theme switching in update window...');

    // Trigger update available
    await page.evaluate(async () => {
      await window.electronAPI.invoke('test:trigger-update-available', {
        version: '1.0.0',
        releaseNotes: '## Release Notes\n\nTest release',
      });
    });

    await page.waitForTimeout(1000);

    const windows = await electronApp.windows();
    const updateWindow = windows[windows.length - 1];
    await updateWindow.waitForLoadState('domcontentloaded');
    await updateWindow.waitForTimeout(500);

    // Get body element to check theme
    const body = updateWindow.locator('body');

    // Initially should have no theme or light theme
    let themeAttr = await body.getAttribute('data-theme');
    console.log('[TEST] Initial theme:', themeAttr);

    // Send dark theme change
    console.log('[TEST] Switching to dark theme...');
    await electronApp.evaluate(({ BrowserWindow }) => {
      // Send theme-change event to all windows
      BrowserWindow.getAllWindows().forEach(window => {
        window.webContents.send('theme-change', 'dark');
      });
    });

    await updateWindow.waitForTimeout(500);

    // Check theme was applied
    themeAttr = await body.getAttribute('data-theme');
    console.log('[TEST] After dark switch:', themeAttr);
    expect(themeAttr).toBe('dark');

    // Switch to crystal-dark
    console.log('[TEST] Switching to crystal-dark theme...');
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().forEach(window => {
        window.webContents.send('theme-change', 'crystal-dark');
      });
    });

    await updateWindow.waitForTimeout(500);

    themeAttr = await body.getAttribute('data-theme');
    console.log('[TEST] After crystal-dark switch:', themeAttr);
    expect(themeAttr).toBe('crystal-dark');

    // Switch back to light
    console.log('[TEST] Switching to light theme...');
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().forEach(window => {
        window.webContents.send('theme-change', 'light');
      });
    });

    await updateWindow.waitForTimeout(500);

    themeAttr = await body.getAttribute('data-theme');
    console.log('[TEST] After light switch:', themeAttr);
    expect(themeAttr).toBe('light');
  });

  test('should close update window when Later button is clicked', async () => {
    console.log('[TEST] Testing window dismissal...');

    // Trigger update available
    await page.evaluate(async () => {
      await window.electronAPI.invoke('test:trigger-update-available', {
        version: '1.0.0',
        releaseNotes: '## Release Notes\n\nTest release',
      });
    });

    await page.waitForTimeout(1000);

    let windows = await electronApp.windows();
    const initialWindowCount = windows.length;
    const updateWindow = windows[windows.length - 1];
    await updateWindow.waitForLoadState('domcontentloaded');

    // Click Later button
    const laterButton = updateWindow.locator('#btn-later');
    await laterButton.click();

    // Wait for window to close
    await page.waitForTimeout(1000);

    // Check that window count decreased
    windows = await electronApp.windows();
    expect(windows.length).toBe(initialWindowCount - 1);
  });
});
