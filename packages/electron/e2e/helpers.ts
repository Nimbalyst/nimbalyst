import { _electron } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';

// Centralized timeouts for consistent test behavior
export const TEST_TIMEOUTS = {
  APP_LAUNCH: 5000,       // App should launch quickly
  SIDEBAR_LOAD: 15000,     // Sidebar should appear fast
  FILE_TREE_LOAD: 5000,   // File tree items should load fast
  TAB_SWITCH: 3000,       // Tab switching is instant
  EDITOR_LOAD: 3000,      // Editor loads quickly
  SAVE_OPERATION: 2000,   // Saves are fast
  DEFAULT_WAIT: 500,      // Standard wait between operations
  VERY_LONG: 60000,       // For long-running operations like AI interactions
};

// Selector for the active editor (accounts for multi-editor architecture)
// Scoped to file-tabs-container to avoid matching plan or AI editors
// Note: The wrapper div (.tab-editor-wrapper) controls visibility via display:block/none
// We select the visible multi-editor-instance's contenteditable
export const ACTIVE_EDITOR_SELECTOR = '.file-tabs-container .tab-editor-wrapper:not([style*="display: none"]) .multi-editor-instance .editor [contenteditable="true"]';

// Selector for the active file tab title
// Scoped to file-tabs-container to avoid matching AI Chat tabs
export const ACTIVE_FILE_TAB_SELECTOR = '.file-tabs-container .tab.active .tab-title';

/**
 * Permission mode for testing. Use with launchElectronApp's permissionMode option.
 * - 'ask': Smart Permissions mode (requires manual approval for each tool)
 * - 'allow-all': Always Allow mode (no permission prompts) - DEFAULT
 * - 'none': Don't auto-configure (shows trust toast) - use this to test the trust toast
 */
export type TestPermissionMode = 'ask' | 'allow-all' | 'none';

export async function launchElectronApp(options?: {
  workspace?: string;
  env?: Record<string, string>;
  /** Permission mode. Defaults to 'allow-all' to skip trust toast. Use 'none' to show the toast. */
  permissionMode?: TestPermissionMode;
  /** Skip clearing the test database. Default false - database is cleared on each launch to prevent corruption issues. */
  preserveTestDatabase?: boolean;
  /** Video recording config. Defaults to e2e_test_output/videos. Pass false to disable. */
  recordVideo?: { dir: string } | false;
}): Promise<ElectronApplication> {
  const electronMain = path.resolve(__dirname, '../out/main/index.js');
  const electronCwd = path.resolve(__dirname, '../../../');

  // Default video recording to e2e_test_output/videos (opt-out with recordVideo: false)
  const defaultVideoDir = path.resolve(__dirname, '../../../e2e_test_output/videos');
  const recordVideoConfig = options?.recordVideo === false
    ? undefined
    : (options?.recordVideo ?? { dir: defaultVideoDir });

  // Clear the test database directory to prevent corruption issues from previous runs
  // The test database is stored in the system temp directory with a fixed name
  if (!options?.preserveTestDatabase) {
    const testDbPath = path.join(os.tmpdir(), 'nimbalyst-test-db');
    try {
      await fs.rm(testDbPath, { recursive: true, force: true });
    } catch {
      // Ignore errors - directory might not exist
    }
  }

  // Check if dev server is running (try both IPv4 and IPv6)
  const devServerUrls = ['http://127.0.0.1:5273', 'http://[::1]:5273'];
  let devServerUrl: string | null = null;
  let lastError: Error | null = null;

  for (const url of devServerUrls) {
    try {
      const response = await fetch(url, { method: 'HEAD' });
      if (response.ok) {
        devServerUrl = url;
        break;
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  if (!devServerUrl) {
    throw new Error(
      `\n\n❌ Dev server is not running!\n\n` +
      `Playwright tests require the Vite dev server to be running on port 5273.\n` +
      `Please start it in a separate terminal:\n\n` +
      `  cd packages/electron && npm run dev\n\n` +
      `Then run the tests again.\n\n` +
      `Original error: ${lastError?.message ?? 'Unknown error'}\n`
    );
  }

  const args = [electronMain];

  // Add --no-sandbox when running in a container (Linux as root)
  // This is required for Electron to run in Docker containers
  if (process.platform === 'linux' && process.getuid && process.getuid() === 0) {
    args.push('--no-sandbox');
  }

  if (options?.workspace) {
    args.push('--workspace', options.workspace);
  }

  // Build env
  const testEnv: Record<string, string | undefined> = {
    ...process.env,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? 'playwright-test-key',
    ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
    ELECTRON_RENDERER_URL: devServerUrl, // Use dev server for HMR
    PLAYWRIGHT: '1', // Default: skip session restoration
    ...options?.env,
  };

  // Set permission mode - defaults to 'allow-all' to skip trust toast in tests
  // Pass permissionMode: 'none' explicitly to test the trust toast behavior
  const permissionMode = options?.permissionMode ?? 'allow-all';
  if (permissionMode !== 'none') {
    testEnv.NIMBALYST_PERMISSION_MODE = permissionMode;
  }

  // If test passes ENABLE_SESSION_RESTORE, remove PLAYWRIGHT to allow restoration
  if (options?.env && 'ENABLE_SESSION_RESTORE' in options.env) {
    delete testEnv.PLAYWRIGHT;
    delete testEnv.ENABLE_SESSION_RESTORE; // Don't pass this to Electron
  }

  const app = await _electron.launch({
    ...(recordVideoConfig ? { recordVideo: recordVideoConfig } : {}),
    args,
    cwd: electronCwd,
    env: testEnv
  });

  // Automatically setup console logging for the first window
  app.on('window', async (page) => {
    await setupPageWithLogging(page);
  });

  return app;
}

export async function createTempWorkspace(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'nimbalyst-test-'));
}

/**
 * Setup page with console log capturing for debugging
 * Call this after getting the page from electronApp
 */
export async function setupPageWithLogging(page: Page): Promise<void> {
  // Capture console messages from the renderer process
  page.on('console', msg => {
    const type = msg.type();
    const text = msg.text();

    // Filter out noisy messages
    if (text.includes('Download the React DevTools')) return;
    if (text.includes('Lit is in dev mode')) return;

    // Format the console message with color
    const prefix = type === 'error' ? '❌' : type === 'warning' ? '⚠️' : '🔍';
    console.log(`${prefix} [Browser ${type}]`, text);
  });

  // Capture page errors
  page.on('pageerror', error => {
    console.error('❌ [Browser Error]', error.message);
  });
}

export async function waitForAppReady(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('.workspace-sidebar', { timeout: TEST_TIMEOUTS.SIDEBAR_LOAD });
}

/**
 * Dismiss the project trust toast if it appears.
 * Clicks "Allow Edits" (the recommended option) to trust the project.
 * Safe to call even if the toast doesn't appear - will just return after timeout.
 *
 * @param page The Playwright page
 * @param timeout How long to wait for the toast (default 2000ms)
 */
export async function dismissProjectTrustToast(page: Page, timeout = 2000): Promise<void> {
  try {
    // Wait for the trust toast to appear - new UI has a heading with "Trust" in it
    const toast = page.getByRole('heading', { name: /^Trust .+\?$/ });
    await toast.waitFor({ state: 'visible', timeout });

    // Click the "Allow Edits" button (recommended option in new UI)
    const allowEditsBtn = page.getByRole('button', { name: /Allow Edits/ });
    await allowEditsBtn.click();

    // Click Save to confirm
    const saveButton = page.getByRole('button', { name: 'Save' });
    await saveButton.click();

    // Wait for the toast to disappear
    await toast.waitFor({ state: 'hidden', timeout: 2000 });
  } catch {
    // Toast didn't appear or was already dismissed - that's fine
  }
}

export async function waitForEditor(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('[data-testid="editor"]', { timeout: TEST_TIMEOUTS.EDITOR_LOAD });
}

/**
 * Set the release channel for the app.
 * Useful for tests that need to use alpha-only extensions.
 *
 * @param page The Playwright page
 * @param channel The release channel ('stable' or 'alpha')
 */
export async function setReleaseChannel(page: Page, channel: 'stable' | 'alpha'): Promise<void> {
  await page.evaluate(async (ch) => {
    await window.electronAPI.invoke('release-channel:set', ch);
  }, channel);
  // Wait for the setting to propagate
  await page.waitForTimeout(100);
}

export function getKeyboardShortcut(key: string): string {
  const isMac = process.platform === 'darwin';
  return key.replace('Mod', isMac ? 'Meta' : 'Control');
}

/**
 * Dispatch a keyboard shortcut using native KeyboardEvent
 * This is necessary because page.keyboard.press() doesn't work reliably in Electron
 * @param page The Playwright page
 * @param shortcut The shortcut string (e.g., 'Mod+Y', 'Mod+S')
 */
export async function pressKeyboardShortcut(page: Page, shortcut: string): Promise<void> {
  // Parse the shortcut string
  const parts = shortcut.split('+');
  const modifiers = parts.slice(0, -1);
  const key = parts[parts.length - 1].toLowerCase();

  await page.evaluate(({ key: keyChar, modifiers: mods }) => {
    const isMac = navigator.platform.includes('Mac');
    const event = new KeyboardEvent('keydown', {
      key: keyChar,
      code: `Key${keyChar.toUpperCase()}`,
      metaKey: mods.includes('Mod') ? isMac : mods.includes('Meta'),
      ctrlKey: mods.includes('Mod') ? !isMac : mods.includes('Control') || mods.includes('Ctrl'),
      shiftKey: mods.includes('Shift'),
      altKey: mods.includes('Alt') || mods.includes('Option'),
      bubbles: true,
      cancelable: true
    });
    document.dispatchEvent(event);
  }, { key, modifiers });
}

