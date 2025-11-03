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
export const PLAYWRIGHT_TEST_SELECTORS = {
  // Mode switching
  editorModeButton: '[data-mode="editor"]',
  agentModeButton: '[data-mode="agent"]',
  filesModeButton: '[data-mode="files"]',

  // Workspace and file tree
  workspaceSidebar: '.workspace-sidebar',
  fileTreeItem: '.file-tree-name',

  // Tabs
  tab: '.tab',
  sessionTab: '.tab[data-tab-type="session"]',
  documentTab: '.tab[data-tab-type="document"]',
  tabTitle: '.tab-title',
  tabDirtyIndicator: '.tab-dirty-indicator',
  tabProcessingIndicator: '.tab-processing-indicator',
  tabUnreadIndicator: '.tab-unread-indicator',
  fileTabsContainer: '.file-tabs-container',

  // API key dialog
  apiKeyDialogOverlay: '.api-key-dialog-overlay',
  apiKeyDialogDismissButton: '.api-key-dialog-button.secondary',

  // AI Chat
  aiChatPanel: '[data-testid="ai-chat-panel"]',
  chatInput: 'textarea.ai-chat-input-field',
  newSessionButton: '.session-history-new-button',
  noSessionSelected: 'text="No session selected"',

  // Active session (more specific to avoid matching editor tabs)
  activeSession: '.ai-session-view[data-active="true"]',

  // Attachments
  attachmentPreview: '.attachment-preview',
  attachmentFilename: '.attachment-filename',
  attachmentRemoveButton: '.attachment-remove',

  // Diff approval
  acceptAllButton: 'button:has-text("Accept All")',
  rejectAllButton: 'button:has-text("Reject All")',

  // Transcript elements
  richTranscriptMessage: '.rich-transcript-message',
  richTranscriptToolContainer: '.rich-transcript-tool-container',

  // Session tabs
  sessionTabsContainer: '.ai-session-tabs-container',
  sessionTab: '.ai-session-tabs-container .tab',

  // Editor
  contentEditable: '[contenteditable="true"]',

  // History dialog
  historyDialog: '.history-dialog',
  historyItem: '.history-item',
  historyPreviewContent: '.history-preview-content pre',
  historyRestoreButton: '.history-restore-button',

  // Search/Replace bar
  searchReplaceBar: '[data-testid="search-replace-bar"]',
  searchInput: '[data-testid="search-input"]',
  replaceInput: '[data-testid="replace-input"]',
  caseToggle: '[data-testid="case-toggle"]',
  regexToggle: '[data-testid="regex-toggle"]',
  matchCounter: '[data-testid="match-counter"]',
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
  await page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTreeItem, { hasText: fileName }).click();
  await page.waitForTimeout(500);

  // Verify tab appeared
  await expect(page.locator(PLAYWRIGHT_TEST_SELECTORS.tabTitle, { hasText: fileName }))
    .toBeVisible({ timeout: TEST_TIMEOUTS.TAB_SWITCH });

  return filePath;
}

/**
 * Switch to Files mode
 */
export async function switchToFilesMode(page: Page): Promise<void> {
  const filesModeButton = page.locator(PLAYWRIGHT_TEST_SELECTORS.filesModeButton);
  await filesModeButton.click();
  await page.waitForTimeout(500);
}

/**
 * Switch to Editor mode
 */
export async function switchToEditorMode(page: Page): Promise<void> {
  const editorModeButton = page.locator(PLAYWRIGHT_TEST_SELECTORS.editorModeButton);
  await editorModeButton.click();
  await page.waitForTimeout(1000); // Give mode switch time to complete
}

/**
 * Switch to Agent mode
 * Note: This auto-creates the first session if none exists
 */
export async function switchToAgentMode(page: Page): Promise<void> {
  const agentModeButton = page.locator(PLAYWRIGHT_TEST_SELECTORS.agentModeButton);
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
  const chatInput = page.locator(PLAYWRIGHT_TEST_SELECTORS.chatInput).first();
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
  const newSessionButton = page.locator(PLAYWRIGHT_TEST_SELECTORS.newSessionButton).first();
  await newSessionButton.click();
  await page.waitForTimeout(500);
}

/**
 * Switch to a specific session tab by index (0-based)
 */
export async function switchToSessionTab(page: Page, index: number): Promise<void> {
  const sessionTabs = page.locator(PLAYWRIGHT_TEST_SELECTORS.sessionTab);
  const targetTab = sessionTabs.nth(index);
  await targetTab.click();
  await page.waitForTimeout(500);
}

/**
 * Get the active session's transcript container
 */
export function getActiveSession(page: Page) {
  return page.locator(PLAYWRIGHT_TEST_SELECTORS.activeSession);
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
  const toolCalls = activeSession.locator(PLAYWRIGHT_TEST_SELECTORS.richTranscriptToolContainer);

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
  const messages = activeSession.locator(PLAYWRIGHT_TEST_SELECTORS.richTranscriptMessage);

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
  const count = await activeSession.locator(PLAYWRIGHT_TEST_SELECTORS.richTranscriptToolContainer).count();
  return count > 0;
}

/**
 * Check if the active session has messages
 */
export async function hasMessages(page: Page): Promise<boolean> {
  const activeSession = getActiveSession(page);
  const count = await activeSession.locator(PLAYWRIGHT_TEST_SELECTORS.richTranscriptMessage).count();
  return count > 0;
}

/**
 * Get the number of session tabs
 */
export async function getSessionTabCount(page: Page): Promise<number> {
  return await page.locator(PLAYWRIGHT_TEST_SELECTORS.sessionTab).count();
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
  await page.locator(PLAYWRIGHT_TEST_SELECTORS.tab, { hasText: fileName }).click();
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
    await page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTreeItem, { hasText: fileName }).click();
    await page.waitForTimeout(300);

    // Verify tab appeared
    await expect(page.locator(PLAYWRIGHT_TEST_SELECTORS.tabTitle, { hasText: fileName }))
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

/**
 * Dismiss API key dialog if present
 */
export async function dismissAPIKeyDialog(page: Page): Promise<void> {
  const apiDialog = page.locator(PLAYWRIGHT_TEST_SELECTORS.apiKeyDialogOverlay);
  if (await apiDialog.isVisible()) {
    await page.locator(PLAYWRIGHT_TEST_SELECTORS.apiKeyDialogDismissButton).click();
  }
}

/**
 * Wait for workspace sidebar and file tree to load
 */
export async function waitForWorkspaceReady(page: Page): Promise<void> {
  await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.workspaceSidebar, {
    timeout: TEST_TIMEOUTS.SIDEBAR_LOAD
  });
}

/**
 * Open a file from the file tree and wait for it to load
 */
export async function openFileFromTree(
  page: Page,
  fileName: string
): Promise<void> {
  // Click file in tree
  await page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTreeItem, { hasText: fileName }).first().click();

  // Wait for tab to become active
  await expect(page.locator(PLAYWRIGHT_TEST_SELECTORS.tab, { hasText: fileName }))
    .toBeVisible({ timeout: TEST_TIMEOUTS.TAB_SWITCH });
}

/**
 * Manual save using keyboard shortcut (Cmd+S)
 */
export async function manualSaveDocument(page: Page): Promise<void> {
  const isMac = process.platform === 'darwin';
  const saveKey = isMac ? 'Meta+s' : 'Control+s';
  await page.keyboard.press(saveKey);
  await page.waitForTimeout(TEST_TIMEOUTS.SAVE_OPERATION);
}

/**
 * Wait for autosave to complete (dirty indicator disappears)
 */
export async function waitForAutosave(
  page: Page,
  fileName: string,
  timeout: number = 3000
): Promise<void> {
  const tab = page.locator(PLAYWRIGHT_TEST_SELECTORS.fileTabsContainer).locator(PLAYWRIGHT_TEST_SELECTORS.tab, {
    has: page.locator(PLAYWRIGHT_TEST_SELECTORS.tabTitle, { hasText: fileName })
  });

  // Wait for dirty indicator to appear
  await expect(tab.locator(PLAYWRIGHT_TEST_SELECTORS.tabDirtyIndicator))
    .toBeVisible({ timeout: 1000 });

  // Wait for autosave (2s interval + 200ms debounce + buffer)
  await page.waitForTimeout(timeout);

  // Verify dirty indicator is gone
  await expect(tab.locator(PLAYWRIGHT_TEST_SELECTORS.tabDirtyIndicator))
    .toHaveCount(0, { timeout: 1000 });
}

/**
 * Open history dialog using keyboard shortcut (Cmd+Y)
 */
export async function openHistoryDialog(page: Page): Promise<void> {
  // Click body to ensure we're not focused in editor
  await page.click('body');
  await page.waitForTimeout(200);

  // Press keyboard shortcut
  const isMac = process.platform === 'darwin';
  const historyKey = isMac ? 'Meta+y' : 'Control+y';
  await page.keyboard.press(historyKey);

  // Wait for dialog to appear
  await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.historyDialog, { timeout: 5000 });
}

/**
 * Select a history item by index and wait for preview
 */
export async function selectHistoryItem(
  page: Page,
  index: number
): Promise<void> {
  const historyItems = page.locator(PLAYWRIGHT_TEST_SELECTORS.historyItem);
  await historyItems.nth(index).click();
  await page.waitForTimeout(500);
}

/**
 * Get history item count
 */
export async function getHistoryItemCount(page: Page): Promise<number> {
  return await page.locator(PLAYWRIGHT_TEST_SELECTORS.historyItem).count();
}

/**
 * Find history item by content match
 */
export async function findHistoryItemByContent(
  page: Page,
  searchText: string
): Promise<number> {
  const historyItems = page.locator(PLAYWRIGHT_TEST_SELECTORS.historyItem);
  const itemCount = await historyItems.count();

  for (let i = 0; i < itemCount; i++) {
    await historyItems.nth(i).click();
    await page.waitForTimeout(300);

    const previewContent = page.locator(PLAYWRIGHT_TEST_SELECTORS.historyPreviewContent);
    const preview = await previewContent.innerText().catch(() => '');

    if (preview.includes(searchText)) {
      return i;
    }
  }

  return -1;
}

/**
 * Restore from selected history item
 */
export async function restoreFromHistory(page: Page): Promise<void> {
  const restoreButton = page.locator(PLAYWRIGHT_TEST_SELECTORS.historyRestoreButton);
  await restoreButton.waitFor({ state: 'visible', timeout: 5000 });
  await expect(restoreButton).toBeEnabled({ timeout: 5000 });
  await restoreButton.click();
  await page.waitForTimeout(500);
}

/**
 * Edit document content (select all and type new content)
 */
export async function editDocumentContent(
  page: Page,
  editorLocator: any,
  content: string
): Promise<void> {
  await editorLocator.click();
  const isMac = process.platform === 'darwin';
  const selectAllKey = isMac ? 'Meta+a' : 'Control+a';
  await page.keyboard.press(selectAllKey);
  await page.keyboard.type(content);
  await page.waitForTimeout(200);
}

/**
 * Open AI Chat panel and create a session if needed
 * This is the CORRECT way to set up AI Chat for tests
 */
export async function openAIChatWithSession(page: Page): Promise<void> {
  // Check if AI Chat is already visible
  const aiChatVisible = await page.locator(PLAYWRIGHT_TEST_SELECTORS.aiChatPanel)
    .isVisible()
    .catch(() => false);

  if (!aiChatVisible) {
    // Open AI Chat panel using keyboard shortcut
    const isMac = process.platform === 'darwin';
    const chatKey = isMac ? 'Meta+Shift+A' : 'Control+Shift+A';
    await page.keyboard.press(chatKey);
    await page.waitForTimeout(500);
  }

  // Create a new session if needed
  const newSessionButton = page.locator(PLAYWRIGHT_TEST_SELECTORS.newSessionButton);
  const needsSession = await newSessionButton.isVisible().catch(() => false);

  if (needsSession) {
    await newSessionButton.click();
    await page.waitForTimeout(1000);
  }

  // Wait for chat input to be visible (use .first() to avoid strict mode violations)
  const chatInput = page.locator(PLAYWRIGHT_TEST_SELECTORS.chatInput).first();
  await chatInput.waitFor({ state: 'visible', timeout: 3000 });
}
