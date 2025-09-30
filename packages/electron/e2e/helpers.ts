import { _electron } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';

// Centralized timeouts for consistent test behavior
export const TEST_TIMEOUTS = {
  APP_LAUNCH: 5000,       // App should launch quickly
  SIDEBAR_LOAD: 5000,     // Sidebar should appear fast
  FILE_TREE_LOAD: 5000,   // File tree items should load fast
  TAB_SWITCH: 3000,       // Tab switching is instant
  EDITOR_LOAD: 3000,      // Editor loads quickly
  SAVE_OPERATION: 2000,   // Saves are fast
  DEFAULT_WAIT: 500,      // Standard wait between operations
};

export async function launchElectronApp(options?: {
  workspace?: string;
  env?: Record<string, string>;
}): Promise<ElectronApplication> {
  const electronMain = path.resolve(__dirname, '../out/main/index.js');
  const electronCwd = path.resolve(__dirname, '../../../');

  const args = [electronMain];
  if (options?.workspace) {
    args.push('--workspace', options.workspace);
  }

  return await _electron.launch({
    args,
    cwd: electronCwd,
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? 'playwright-test-key',
      ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
      PLAYWRIGHT: '1',
      ...options?.env
    }
  });
}

export async function createTempWorkspace(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'preditor-test-'));
}

export async function waitForAppReady(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('.workspace-sidebar', { timeout: TEST_TIMEOUTS.SIDEBAR_LOAD });
}

export async function waitForEditor(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('[data-testid="editor"]', { timeout: TEST_TIMEOUTS.EDITOR_LOAD });
}

export function getKeyboardShortcut(key: string): string {
  const isMac = process.platform === 'darwin';
  return key.replace('Mod', isMac ? 'Meta' : 'Control');
}