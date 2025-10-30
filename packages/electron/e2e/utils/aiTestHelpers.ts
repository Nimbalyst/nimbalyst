/**
 * AI Test Helpers
 *
 * Shared utilities for testing AI features in the Nimbalyst editor.
 * These helpers encapsulate common patterns for interacting with the AI chat,
 * agent mode, and document editing.
 */

import type { Page, ElectronApplication } from '@playwright/test';
import { expect } from '@playwright/test';
import * as fs from 'fs/promises';
import * as path from 'path';
import { TEST_TIMEOUTS } from '../helpers';

/**
 * Selectors for AI-related UI elements
 */
export const AI_SELECTORS = {
  // Mode switching
  editorModeButton: '[data-mode="editor"]',
  agentModeButton: '[data-mode="agent"]',
  filesModeButton: '[data-mode="files"]',

  // File tree
  fileTreeItem: '.file-tree-name',

  // Tabs
  tab: '.tab',
  tabTitle: '.tab-title',

  // AI Chat
  chatInput: 'textarea.ai-chat-input-field',
  newSessionButton: 'button.session-history-new-button',

  // Active session (more specific to avoid matching editor tabs)
  activeSession: '.ai-session-view[data-active="true"]',

  // Transcript elements
  richTranscriptMessage: '.rich-transcript-message',
  richTranscriptToolContainer: '.rich-transcript-tool-container',

  // Session tabs
  sessionTabsContainer: '.ai-session-tabs-container',
  sessionTab: '.ai-session-tabs-container .tab',

  // Editor
  contentEditable: '[contenteditable="true"]',
};

/**
 * Create a new document in the workspace and open it in edit mode
 */
export async function openNewDocument(
  page: Page,
  workspaceDir: string,
  fileName: string,
  contents: string
): Promise<string> {
  const filePath = path.join(workspaceDir, fileName);

  // Write file to disk BEFORE opening (critical for file tree to detect it)
  await fs.writeFile(filePath, contents, 'utf8');

  // Click on file in file tree to open it
  await page.locator(AI_SELECTORS.fileTreeItem, { hasText: fileName }).click();
  await page.waitForTimeout(500);

  // Verify tab appeared
  await expect(page.locator(AI_SELECTORS.tabTitle, { hasText: fileName }))
    .toBeVisible({ timeout: TEST_TIMEOUTS.TAB_SWITCH });

  return filePath;
}

/**
 * Switch to Files mode
 */
export async function switchToFilesMode(page: Page): Promise<void> {
  const filesModeButton = page.locator(AI_SELECTORS.filesModeButton);
  await filesModeButton.click();
  await page.waitForTimeout(500);
}

/**
 * Switch to Editor mode
 */
export async function switchToEditorMode(page: Page): Promise<void> {
  const editorModeButton = page.locator(AI_SELECTORS.editorModeButton);
  await editorModeButton.click();
  await page.waitForTimeout(1000); // Give mode switch time to complete
}

/**
 * Switch to Agent mode
 * Note: This auto-creates the first session if none exists
 */
export async function switchToAgentMode(page: Page): Promise<void> {
  const agentModeButton = page.locator(AI_SELECTORS.agentModeButton);
  await agentModeButton.click();
  await page.waitForTimeout(1000); // Wait for mode switch and auto-session creation
}

/**
 * Submit a chat prompt in the currently active session
 * Uses .fill() instead of .type() for better React compatibility
 */
export async function submitChatPrompt(
  page: Page,
  promptText: string,
  options: { waitForResponse?: boolean; timeout?: number } = {}
): Promise<void> {
  const { waitForResponse = false, timeout = 15000 } = options;

  // Find the visible chat input
  const chatInput = page.locator(AI_SELECTORS.chatInput).first();
  await chatInput.waitFor({ state: 'visible', timeout: 5000 });

  // Fill the message (more reliable than type() for React inputs)
  await chatInput.fill(promptText);
  await page.waitForTimeout(100); // Brief wait to ensure React state updates

  // Send message with Enter key
  await chatInput.press('Enter');

  if (waitForResponse) {
    // Wait for AI to respond (look for tool calls or messages)
    await page.waitForTimeout(timeout);
  }
}

/**
 * Create a new agent session
 */
export async function createNewAgentSession(page: Page): Promise<void> {
  const newSessionButton = page.locator(AI_SELECTORS.newSessionButton).first();
  await newSessionButton.click();
  await page.waitForTimeout(500);
}

/**
 * Switch to a specific session tab by index (0-based)
 */
export async function switchToSessionTab(page: Page, index: number): Promise<void> {
  const sessionTabs = page.locator(AI_SELECTORS.sessionTab);
  const targetTab = sessionTabs.nth(index);
  await targetTab.click();
  await page.waitForTimeout(500);
}

/**
 * Get the active session's transcript container
 */
export function getActiveSession(page: Page) {
  return page.locator(AI_SELECTORS.activeSession);
}

/**
 * Wait for tool calls to appear in the active session
 */
export async function waitForToolCalls(
  page: Page,
  options: { timeout?: number; minCount?: number } = {}
): Promise<void> {
  const { timeout = 10000, minCount = 1 } = options;

  const activeSession = getActiveSession(page);
  const toolCalls = activeSession.locator(AI_SELECTORS.richTranscriptToolContainer);

  // Wait for at least minCount tool calls
  await expect(toolCalls.first()).toBeVisible({ timeout });

  if (minCount > 1) {
    await expect(toolCalls).toHaveCount(minCount, { timeout });
  }
}

/**
 * Wait for messages to appear in the active session
 */
export async function waitForMessages(
  page: Page,
  options: { timeout?: number; minCount?: number } = {}
): Promise<void> {
  const { timeout = 10000, minCount = 1 } = options;

  const activeSession = getActiveSession(page);
  const messages = activeSession.locator(AI_SELECTORS.richTranscriptMessage);

  await expect(messages.first()).toBeVisible({ timeout });

  if (minCount > 1) {
    await expect(messages).toHaveCount(minCount, { timeout });
  }
}

/**
 * Check if the active session has tool calls
 */
export async function hasToolCalls(page: Page): Promise<boolean> {
  const activeSession = getActiveSession(page);
  const count = await activeSession.locator(AI_SELECTORS.richTranscriptToolContainer).count();
  return count > 0;
}

/**
 * Check if the active session has messages
 */
export async function hasMessages(page: Page): Promise<boolean> {
  const activeSession = getActiveSession(page);
  const count = await activeSession.locator(AI_SELECTORS.richTranscriptMessage).count();
  return count > 0;
}

/**
 * Get the number of session tabs
 */
export async function getSessionTabCount(page: Page): Promise<number> {
  return await page.locator(AI_SELECTORS.sessionTab).count();
}

/**
 * Verify a document was edited and saved to disk
 */
export async function verifyDocumentEdited(
  filePath: string,
  expectedContent: string | RegExp
): Promise<void> {
  const content = await fs.readFile(filePath, 'utf8');

  if (typeof expectedContent === 'string') {
    expect(content).toContain(expectedContent);
  } else {
    expect(content).toMatch(expectedContent);
  }
}

/**
 * Switch to a specific document tab by name
 */
export async function switchToDocumentTab(page: Page, fileName: string): Promise<void> {
  await page.locator(AI_SELECTORS.tab, { hasText: fileName }).click();
  await page.waitForTimeout(500);
}

/**
 * Setup a basic AI test scenario with workspace and documents
 */
export async function setupAITest(
  workspaceDir: string,
  documents: Array<{ fileName: string; content: string }>
): Promise<Map<string, string>> {
  const filePaths = new Map<string, string>();

  for (const doc of documents) {
    const filePath = path.join(workspaceDir, doc.fileName);
    await fs.writeFile(filePath, doc.content, 'utf8');
    filePaths.set(doc.fileName, filePath);
  }

  return filePaths;
}

/**
 * Open multiple documents in sequence
 */
export async function openDocuments(
  page: Page,
  fileNames: string[]
): Promise<void> {
  for (const fileName of fileNames) {
    await page.locator(AI_SELECTORS.fileTreeItem, { hasText: fileName }).click();
    await page.waitForTimeout(300);

    // Verify tab appeared
    await expect(page.locator(AI_SELECTORS.tabTitle, { hasText: fileName }))
      .toBeVisible({ timeout: TEST_TIMEOUTS.TAB_SWITCH });
  }
}

/**
 * Complete AI workflow: switch to agent mode, submit prompt, wait for response
 */
export async function runAgenticWorkflow(
  page: Page,
  prompt: string,
  options: {
    createNewSession?: boolean;
    waitTimeout?: number;
    expectToolCalls?: boolean;
  } = {}
): Promise<void> {
  const {
    createNewSession = false,
    waitTimeout = 15000,
    expectToolCalls = true
  } = options;

  // Switch to agent mode if not already there
  await switchToAgentMode(page);

  // Create new session if requested
  if (createNewSession) {
    await createNewAgentSession(page);
  }

  // Submit prompt
  await submitChatPrompt(page, prompt);

  // Wait for response
  await page.waitForTimeout(waitTimeout);

  // Verify expected content appeared
  if (expectToolCalls) {
    await waitForToolCalls(page, { timeout: 10000 });
  } else {
    await waitForMessages(page, { timeout: 10000 });
  }
}

/**
 * Type aliases for common test patterns
 */
export interface AITestDocument {
  fileName: string;
  content: string;
}

export interface AITestSession {
  prompt: string;
  expectedDocumentEdits?: string[];
  expectToolCalls?: boolean;
}
