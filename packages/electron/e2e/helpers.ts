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
  VERY_LONG: 60000,       // For long-running operations like AI interactions
};

// Selector for the active editor (accounts for multi-editor architecture)
// Scoped to file-tabs-container to avoid matching plan or AI editors
export const ACTIVE_EDITOR_SELECTOR = '.file-tabs-container .multi-editor-instance.active .editor [contenteditable="true"]';

// Selector for the active file tab title
// Scoped to file-tabs-container to avoid matching AI Chat tabs
export const ACTIVE_FILE_TAB_SELECTOR = '.file-tabs-container .tab.active .tab-title';

export async function launchElectronApp(options?: {
  workspace?: string;
  env?: Record<string, string>;
}): Promise<ElectronApplication> {
  const electronMain = path.resolve(__dirname, '../out/main/index.js');
  const electronCwd = path.resolve(__dirname, '../../../');

  // Check if dev server is running
  const devServerUrl = 'http://localhost:5273';
  try {
    const response = await fetch(devServerUrl, { method: 'HEAD' });
    if (!response.ok) {
      throw new Error(`Dev server returned status ${response.status}`);
    }
  } catch (error) {
    throw new Error(
      `\n\n❌ Dev server is not running!\n\n` +
      `Playwright tests require the Vite dev server to be running on port 5273.\n` +
      `Please start it in a separate terminal:\n\n` +
      `  cd packages/electron && npm run dev\n\n` +
      `Then run the tests again.\n\n` +
      `Original error: ${error instanceof Error ? error.message : String(error)}\n`
    );
  }

  const args = [electronMain];
  if (options?.workspace) {
    args.push('--workspace', options.workspace);
  }

  // Build env
  const testEnv = {
    ...process.env,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? 'playwright-test-key',
    ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
    ELECTRON_RENDERER_URL: devServerUrl, // Use dev server for HMR
    PLAYWRIGHT: '1', // Default: skip session restoration
    ...options?.env,
  };

  // If test passes ENABLE_SESSION_RESTORE, remove PLAYWRIGHT to allow restoration
  if (options?.env && 'ENABLE_SESSION_RESTORE' in options.env) {
    delete testEnv.PLAYWRIGHT;
    delete testEnv.ENABLE_SESSION_RESTORE; // Don't pass this to Electron
  }

  return await _electron.launch({
    args,
    cwd: electronCwd,
    env: testEnv
  });
}

export async function createTempWorkspace(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'nimbalyst-test-'));
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

/**
 * Helper to preconfigure AI provider settings via IPC
 * This configures the provider at the app level before any UI interaction
 * @param page The Playwright page
 * @param provider The provider name (e.g., 'openai', 'claude')
 * @param apiKey The API key for the provider
 * @param models Array of model IDs to enable (e.g., ['gpt-4-turbo', 'gpt-3.5-turbo'])
 */
export async function configureAIProvider(
  page: Page,
  provider: string,
  apiKey: string,
  models: string[]
): Promise<void> {
  // Configure settings via IPC
  await page.evaluate(async ({ provider, apiKey, models }) => {
    // Save API key
    const apiKeyField = provider === 'openai' ? 'openai' : provider === 'claude' ? 'anthropic' : provider;
    await window.electronAPI.aiSaveSettings({
      apiKeys: {
        [apiKeyField]: apiKey
      }
    });

    // Save provider settings (enabled models)
    await window.electronAPI.aiSaveSettings({
      providerSettings: {
        [provider]: {
          enabled: true,
          models: models
        }
      }
    });

    // Set as default provider
    const defaultProvider = `${provider}:${models[0]}`;
    await window.electronAPI.aiSaveSettings({
      defaultProvider: defaultProvider
    });
  }, { provider, apiKey, models });

  // Wait for settings to be saved and propagated
  await page.waitForTimeout(1000);
}

/**
 * Configure AI model - simplified for new UI architecture
 *
 * Note: This function now assumes the provider is already configured via:
 * - Environment variables (OPENAI_API_KEY, ANTHROPIC_API_KEY, etc.)
 * - App settings/preferences
 *
 * It opens the AI panel and creates a new session ready for use.
 *
 * @param page The Playwright page
 * @param provider The provider name (optional, for backwards compatibility)
 * @param model The model display name (optional, for backwards compatibility)
 */
export async function configureAIModel(page: Page, provider?: string, model?: string): Promise<void> {
  // Open AI Chat if not already open
  const aiChatVisible = await page.locator('[data-testid="ai-chat-panel"]').isVisible().catch(() => false);
  if (!aiChatVisible) {
    await page.keyboard.press('Meta+Shift+A');
    await page.waitForTimeout(500);
  }

  // Wait for AI panel to be ready
  await page.waitForTimeout(500);

  // Check if we need to create a new session
  const noSessionText = await page.locator('text="No session selected"').isVisible().catch(() => false);
  const hasNoMessages = await page.locator('text="No messages to display"').isVisible().catch(() => false);

  if (noSessionText || hasNoMessages) {
    // Click "New Session" button
    const newSessionButton = page.locator('button:has-text("New Session")').first();
    const buttonExists = await newSessionButton.count() > 0;

    if (buttonExists) {
      await newSessionButton.click();
      await page.waitForTimeout(1000); // Wait for session to initialize
    }
  }
}

/**
 * Helper to send an AI prompt and wait for the response
 * @param page The Playwright page
 * @param prompt The prompt to send
 * @param options Configuration options
 */
export async function sendAIPrompt(page: Page, prompt: string, options?: {
  waitForCompletion?: boolean;
  timeout?: number;
}): Promise<void> {
  const {
    waitForCompletion = true,
    timeout = 10000
  } = options || {};

  // AI Chat should already be open from configureAIModel, so just verify
  const aiChatVisible = await page.locator('[data-testid="ai-chat-panel"]').isVisible().catch(() => false);
  if (!aiChatVisible) {
    await page.keyboard.press('Meta+Shift+A');
    await page.waitForTimeout(200);
  }

  // Check if we need to start a session (look for "No session selected" text)
  const noSessionText = await page.locator('text="No session selected"').isVisible().catch(() => false);
  if (noSessionText) {
    // Click the large "New Session" button (appears when no session is active)
    const newSessionButton = page.locator('button:has-text("New Session")').first();
    await newSessionButton.waitFor({ state: 'visible', timeout: 3000 });
    await newSessionButton.click();
    await page.waitForTimeout(2000); // Wait for session to initialize
  }

  // Find and click the chat input - try multiple selectors
  const chatInput = page.locator('textarea[placeholder*="Ask"], input[placeholder*="Ask"], [data-testid="ai-chat-input"]').first();
  await chatInput.waitFor({ state: 'visible', timeout: 5000 });
  await chatInput.click();
  await chatInput.fill(prompt);

  // Send the message (try Enter or look for send button)
  await page.keyboard.press('Enter');

  if (waitForCompletion) {
    // Wait briefly for streaming to start
    await page.waitForTimeout(100);

    // Wait for streaming to complete by watching for send button to become enabled again
    // The button has text "Send message" and is disabled during streaming
    const sendButton = page.locator('button:has-text("Send message")').first();
    await sendButton.waitFor({ state: 'attached', timeout: 2000 }).catch(() => {});

    // Wait for button to be enabled (streaming complete) with timeout
    try {
      await page.waitForFunction(
        () => {
          const btn = document.querySelector('button[aria-label*="Send"]') as HTMLButtonElement;
          return btn && !btn.disabled;
        },
        { timeout }
      );
    } catch (e) {
      console.log('Timeout waiting for AI response to complete');
    }

    // Give a moment for any final updates
    await page.waitForTimeout(500);
  }
}

/**
 * Get the current document content from the editor
 * @param page The Playwright page
 */
export async function getEditorContent(page: Page): Promise<string> {
  return await page.evaluate(() => {
    // Try to get content from the aiChatBridge if available
    if ((window as any).aiChatBridge && typeof (window as any).aiChatBridge.getContent === 'function') {
      return (window as any).aiChatBridge.getContent();
    }
    // Fallback: try to read from editor element
    const editor = document.querySelector('[contenteditable="true"]');
    return editor?.textContent || '';
  });
}