/**
 * Marketing Screenshot & Video Helpers
 *
 * Utilities for capturing marketing screenshots in both dark and light themes,
 * launching the app with a fixture workspace, and common setup operations.
 *
 * Supports two launch modes:
 * - Dev mode: requires `npm run dev` running on port 5273 (default)
 * - Packaged mode: uses installed Nimbalyst.app, no dev server needed
 *   Set MARKETING_APP_PATH env var or pass executablePath option.
 */

import { _electron } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';

// Fixed viewport for consistent marketing screenshots
export const MARKETING_VIEWPORT = { width: 1440, height: 900 };

// Output directories
export const SCREENSHOT_DIR = path.resolve(__dirname, '../screenshots');
export const VIDEO_DIR = path.resolve(__dirname, '../videos');

// Fixture workspace source (copied to temp dir for each run)
export const FIXTURE_WORKSPACE_SRC = path.resolve(__dirname, '../fixtures/workspace');

// Default packaged app locations by platform
const DEFAULT_APP_PATHS: Record<string, string> = {
  darwin: '/Applications/Nimbalyst.app/Contents/MacOS/Nimbalyst',
  win32: 'C:\\Program Files\\Nimbalyst\\Nimbalyst.exe',
  linux: '/usr/bin/nimbalyst',
};

export type Theme = 'dark' | 'light';

/**
 * Find the packaged Nimbalyst binary.
 * Checks MARKETING_APP_PATH env var, then default install locations.
 * Returns null if no packaged app is found.
 */
async function findPackagedApp(): Promise<string | null> {
  // Explicit env var takes priority
  const envPath = process.env.MARKETING_APP_PATH;
  if (envPath) {
    try {
      await fs.access(envPath);
      return envPath;
    } catch {
      throw new Error(`MARKETING_APP_PATH is set but file not found: ${envPath}`);
    }
  }

  // Check default location for current platform
  const defaultPath = DEFAULT_APP_PATHS[process.platform];
  if (defaultPath) {
    try {
      await fs.access(defaultPath);
      return defaultPath;
    } catch {
      // Not installed at default location
    }
  }

  return null;
}

/**
 * Launch the Electron app configured for marketing capture.
 * Uses a temp copy of the fixture workspace to avoid mutations.
 *
 * Automatically detects whether to use dev mode or packaged mode:
 * - If a dev server is running on port 5273, uses dev mode (out/main/index.js)
 * - Otherwise, looks for the packaged Nimbalyst app
 * - Set MARKETING_APP_PATH env var to specify a custom packaged app path
 */
export async function launchMarketingApp(options?: {
  workspace?: string;
  recordVideo?: boolean;
  theme?: Theme;
}): Promise<{ app: ElectronApplication; page: Page; workspaceDir: string }> {
  const electronCwd = path.resolve(__dirname, '../../../../');

  // Create temp workspace from fixtures
  const workspaceDir = options?.workspace ?? (await createTempWorkspace());

  // Clear test database
  const testDbPath = path.join(os.tmpdir(), 'nimbalyst-test-db');
  try {
    await fs.rm(testDbPath, { recursive: true, force: true });
  } catch {
    // Ignore
  }

  // Determine launch mode: dev server or packaged app
  const devServerUrl = await findDevServer();
  const packagedAppPath = devServerUrl ? null : await findPackagedApp();

  if (!devServerUrl && !packagedAppPath) {
    throw new Error(
      '\n\nNo Nimbalyst instance available for marketing capture.\n\n' +
      'Either:\n' +
      '  1. Start the dev server: cd packages/electron && npm run dev\n' +
      '  2. Install Nimbalyst.app to /Applications\n' +
      '  3. Set MARKETING_APP_PATH=/path/to/Nimbalyst.app/Contents/MacOS/Nimbalyst\n'
    );
  }

  const videoConfig = options?.recordVideo
    ? { dir: path.join(VIDEO_DIR, options?.theme ?? 'dark') }
    : undefined;

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? 'marketing-capture-key',
    ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
    PLAYWRIGHT: '1',
    NIMBALYST_PERMISSION_MODE: 'allow-all',
  };

  let launchOptions: Parameters<typeof _electron.launch>[0];

  if (devServerUrl) {
    // Dev mode: use out/main/index.js with dev server
    const electronMain = path.resolve(__dirname, '../../out/main/index.js');
    env.ELECTRON_RENDERER_URL = devServerUrl;
    launchOptions = {
      ...(videoConfig ? { recordVideo: videoConfig } : {}),
      args: [electronMain, '--workspace', workspaceDir],
      cwd: electronCwd,
      env,
    };
  } else {
    // Packaged mode: launch the installed binary directly
    launchOptions = {
      ...(videoConfig ? { recordVideo: videoConfig } : {}),
      executablePath: packagedAppPath!,
      args: ['--workspace', workspaceDir],
      cwd: electronCwd,
      env,
    };
  }

  const app = await _electron.launch(launchOptions);

  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  // Wait for workspace sidebar to be visible
  await page.waitForSelector('.workspace-sidebar', { timeout: 15000 });

  // Wait for renderer to fully stabilize (avoids context destruction during navigation)
  await page.waitForTimeout(1000);

  // Set initial theme
  const theme = options?.theme ?? 'dark';
  await setTheme(app, theme);

  // Wait for theme to apply
  await page.waitForTimeout(500);

  return { app, page, workspaceDir };
}

/**
 * Create a temporary workspace by copying the fixture workspace.
 */
export async function createTempWorkspace(): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nimbalyst-marketing-'));
  await copyDir(FIXTURE_WORKSPACE_SRC, tempDir);
  return tempDir;
}

/**
 * Recursively copy a directory.
 */
async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/**
 * Switch the app theme via IPC.
 * Retries on context destruction (can happen during initial page load/navigation).
 */
export async function setTheme(app: ElectronApplication, theme: Theme): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await app.evaluate(({ BrowserWindow }, t) => {
        BrowserWindow.getAllWindows().forEach(window => {
          window.webContents.send('theme-change', t);
        });
      }, theme);
      return;
    } catch (err: any) {
      if (attempt < 2 && err.message?.includes('Execution context was destroyed')) {
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      throw err;
    }
  }
}

/**
 * Capture a screenshot in both dark and light themes.
 * Saves to screenshots/dark/{name}.png and screenshots/light/{name}.png.
 */
export async function captureScreenshotBothThemes(
  app: ElectronApplication,
  page: Page,
  name: string,
  options?: { fullPage?: boolean; clip?: { x: number; y: number; width: number; height: number } }
): Promise<void> {
  for (const theme of ['dark', 'light'] as Theme[]) {
    await setTheme(app, theme);
    await page.waitForTimeout(600); // Let theme transition complete

    const dir = path.join(SCREENSHOT_DIR, theme);
    await fs.mkdir(dir, { recursive: true });

    await page.screenshot({
      path: path.join(dir, `${name}.png`),
      fullPage: options?.fullPage,
      clip: options?.clip,
    });
  }
}

/**
 * Capture a screenshot for a single theme.
 */
export async function captureScreenshot(
  page: Page,
  name: string,
  theme: Theme,
  options?: { fullPage?: boolean; clip?: { x: number; y: number; width: number; height: number } }
): Promise<void> {
  const dir = path.join(SCREENSHOT_DIR, theme);
  await fs.mkdir(dir, { recursive: true });

  await page.screenshot({
    path: path.join(dir, `${name}.png`),
    fullPage: options?.fullPage,
    clip: options?.clip,
  });
}

/**
 * Expand a folder in the file tree by clicking its name.
 * Waits for children to become visible.
 */
export async function expandFolder(page: Page, folderName: string): Promise<void> {
  const folder = page.locator('.file-tree-directory .file-tree-name', { hasText: folderName }).first();
  await folder.waitFor({ state: 'visible', timeout: 5000 });
  // Check if already expanded via aria-expanded on parent
  const dir = page.locator('.file-tree-directory', { hasText: folderName }).first();
  const expanded = await dir.getAttribute('aria-expanded');
  if (expanded !== 'true') {
    await folder.click();
    await page.waitForTimeout(400);
  }
}

/**
 * Open a file from the file tree by clicking its name.
 * If the file is not visible, expands all collapsed directories until found.
 */
export async function openFile(page: Page, fileName: string): Promise<void> {
  const fileItem = page.locator('.file-tree-file .file-tree-name', { hasText: fileName }).first();

  // Keep expanding collapsed directories until the file appears
  for (let round = 0; round < 5; round++) {
    if (await fileItem.isVisible().catch(() => false)) break;
    // Find all collapsed directories and expand them
    const collapsed = page.locator('.file-tree-directory[aria-expanded="false"]');
    const count = await collapsed.count();
    if (count === 0) break;
    for (let i = 0; i < count; i++) {
      const dir = collapsed.nth(i);
      if (await dir.isVisible().catch(() => false)) {
        await dir.locator('.file-tree-name').click();
        await page.waitForTimeout(300);
        if (await fileItem.isVisible().catch(() => false)) break;
      }
    }
  }

  await fileItem.waitFor({ state: 'visible', timeout: 5000 });
  await fileItem.click();
  // Wait for tab to appear
  await page.locator('.tab', { hasText: fileName }).waitFor({ state: 'visible', timeout: 3000 });
  await page.waitForTimeout(500); // Let editor fully render
}

/**
 * Switch to Agent mode.
 */
export async function switchToAgentMode(page: Page): Promise<void> {
  const agentMode = page.locator('.agent-mode');
  const isVisible = await agentMode.isVisible().catch(() => false);
  if (!isVisible) {
    await page.locator('[data-mode="agent"]').click();
    await page.waitForTimeout(1500);
  }
}

/**
 * Switch to Files mode.
 */
export async function switchToFilesMode(page: Page): Promise<void> {
  const sidebar = page.locator('.workspace-sidebar');
  const isVisible = await sidebar.isVisible().catch(() => false);
  if (!isVisible) {
    await page.locator('[data-mode="files"]').click();
    await page.waitForTimeout(500);
    await page.waitForSelector('.workspace-sidebar', { timeout: 5000 });
  }
}

/**
 * Switch to Settings mode.
 */
export async function switchToSettings(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as any).__testHelpers?.setActiveMode('settings');
  });
  await page.waitForSelector('.settings-view', { timeout: 5000 });
  await page.waitForTimeout(500);
}

/**
 * Click a settings category item.
 */
export async function openSettingsCategory(page: Page, categoryText: string): Promise<void> {
  const item = page.locator('.settings-category-item', { hasText: categoryText }).first();
  if (await item.isVisible()) {
    await item.click();
    await page.waitForTimeout(500);
  }
}

/**
 * Open the AI Chat sidebar panel.
 */
export async function openAIChatSidebar(page: Page): Promise<void> {
  const chatPanel = page.locator('[data-testid="chat-sidebar-panel"]');
  const isVisible = await chatPanel.isVisible().catch(() => false);
  if (!isVisible) {
    await page.keyboard.press('Meta+Shift+A');
    await page.waitForTimeout(500);
  }
}

/**
 * Wait for a short pause (for video choreography).
 */
export async function pause(page: Page, ms: number): Promise<void> {
  await page.waitForTimeout(ms);
}

/**
 * Find the dev server URL.
 * Returns null if the dev server is not running (packaged mode will be used instead).
 */
async function findDevServer(): Promise<string | null> {
  const urls = ['http://127.0.0.1:5273', 'http://[::1]:5273'];
  for (const url of urls) {
    try {
      const response = await fetch(url, { method: 'HEAD' });
      if (response.ok) return url;
    } catch {
      // Try next
    }
  }
  return null;
}
