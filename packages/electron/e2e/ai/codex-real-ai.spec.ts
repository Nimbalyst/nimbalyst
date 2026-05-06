/**
 * Real-AI Codex E2E test.
 *
 * Drives a live `openai-codex` agent session against a temp workspace and
 * verifies the end-to-end edit-attribution -> transcript-diff pipeline:
 *
 *   Codex SDK -> raw event -> canonical event -> session_files
 *     -> ToolCallMatcher -> renderer ToolCallChanges -> DiffViewer/NewFilePreview
 *
 * Gate: requires `RUN_REAL_CODEX=1` and a host that already has Codex CLI
 * auth configured (Codex uses CLI-side auth, not a Nimbalyst-stored API key).
 * NEVER runs in CI by default. Skipped automatically without the env var.
 */

import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import {
  launchElectronApp,
  createTempWorkspace,
  waitForAppReady,
  dismissProjectTrustToast,
} from '../helpers';
import {
  PLAYWRIGHT_TEST_SELECTORS,
  dismissAPIKeyDialog,
  switchToAgentMode,
  submitChatPrompt,
} from '../utils/testHelpers';
import * as fs from 'fs/promises';
import * as path from 'path';

// Skip entire file unless the explicit opt-in is set.
test.skip(
  () => !process.env.RUN_REAL_CODEX,
  'Requires Codex CLI auth + RUN_REAL_CODEX=1'
);

// Codex API turn can take longer than typical UI interactions.
test.setTimeout(180000);

test.describe.configure({ mode: 'serial' });

let electronApp: ElectronApplication;
let page: Page;
let workspaceDir: string;

test.beforeAll(async () => {
  workspaceDir = await createTempWorkspace();

  // Seed one file so Codex has a workspace to look at.
  await fs.writeFile(
    path.join(workspaceDir, 'README.md'),
    '# Test workspace\n\nSeed file.\n',
    'utf8'
  );

  electronApp = await launchElectronApp({
    workspace: workspaceDir,
    permissionMode: 'allow-all',
  });
  page = await electronApp.firstWindow();

  await page.waitForLoadState('domcontentloaded');
  await waitForAppReady(page);
  await dismissAPIKeyDialog(page);
  await dismissProjectTrustToast(page);

  await switchToAgentMode(page);
  await page.waitForTimeout(1000);
});

test.afterAll(async () => {
  // If a turn is still mid-flight, cancel before tearing down so we don't
  // leak a Codex subprocess. Scope to the agent panel since the files-mode
  // chat sidebar also renders an .ai-chat-cancel-button.
  try {
    const cancelButton = page
      .locator(PLAYWRIGHT_TEST_SELECTORS.activeSession)
      .locator('.ai-chat-cancel-button');
    if (await cancelButton.first().isVisible({ timeout: 500 }).catch(() => false)) {
      await cancelButton.first().click();
      await page.waitForTimeout(500);
    }
  } catch {
    // No cancel button visible
  }

  await electronApp?.close();
  await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => {});
});

test('real Codex turn populates ToolCallChanges with a file diff', async () => {
  // Resolve the active agent session ID from the visible panel.
  const sessionPanel = page.locator(PLAYWRIGHT_TEST_SELECTORS.activeSession);
  await expect(sessionPanel).toBeVisible({ timeout: 5000 });
  const sessionId = await sessionPanel.getAttribute('data-session-id');
  expect(sessionId, 'agent-session-panel should expose data-session-id').toBeTruthy();

  // Switch the freshly-created session to Codex via the same IPC the model
  // picker uses. The handler derives provider from model id, broadcasts
  // `sessions:session-updated`, and invalidates the cached provider so the
  // next message is dispatched to OpenAICodexProvider.
  const updateResult = await page.evaluate(
    async ({ id, model }) => {
      return await (window as any).electronAPI.invoke(
        'sessions:update-metadata',
        id,
        { model }
      );
    },
    { id: sessionId!, model: 'openai-codex:gpt-5.4' }
  );
  expect(updateResult?.success, `update-metadata failed: ${JSON.stringify(updateResult)}`).toBe(true);
  await page.waitForTimeout(500);

  // Ask Codex to create a new file. New-file path exercises the
  // NewFilePreview branch of ToolCallChanges; an edit-existing-file would
  // exercise DiffViewer. Either is valid as far as this test is concerned.
  const targetFileName = 'codex-hello.txt';
  await submitChatPrompt(
    page,
    `Create a new file named "${targetFileName}" in the current workspace containing the single line "hi from codex". Do not ask any clarifying questions. Just create the file and stop.`
  );

  // Wait for the turn to finish: the cancel button is only mounted while
  // isLoading is true, so its disappearance is the canonical "done" signal.
  // Scoped to the agent panel because files-mode also renders one.
  // Codex model latency dominates here -- 90s gives headroom.
  const cancelButton = sessionPanel.locator('.ai-chat-cancel-button');
  await expect(cancelButton).toBeVisible({ timeout: 30000 });
  await expect(cancelButton).toHaveCount(0, { timeout: 90000 });

  // Sanity: Codex should have actually written the file to disk.
  const writtenPath = path.join(workspaceDir, targetFileName);
  await expect.poll(
    async () => fs.stat(writtenPath).then(() => true).catch(() => false),
    { timeout: 5000 }
  ).toBe(true);

  // The transcript should contain at least one tool card from Codex's edit.
  const toolContainers = sessionPanel.locator(
    PLAYWRIGHT_TEST_SELECTORS.richTranscriptToolContainer
  );
  await expect(toolContainers.first()).toBeVisible({ timeout: 5000 });

  // Codex routes file edits through one of two tool-call widgets:
  //   - `file_change`  -> FileChangeWidget (`.file-change-widget`) which
  //     renders fileSnapshots directly from the tool result.
  //   - `shell` / MCP  -> regular tool card whose embedded ToolCallChanges
  //     (`.tool-call-changes`) calls `session-files:get-tool-call-diffs` and
  //     renders DiffViewer / NewFilePreview.
  //
  // Both widget paths are valid evidence that the Codex edit-attribution
  // pipeline (synthetic edit-group ID -> canonical event -> session_files /
  // fileSnapshots -> renderer) produced a visible file diff. We accept
  // whichever one the model chose this turn.
  const fileChangeWidget = sessionPanel
    .locator('.file-change-widget', { hasText: targetFileName })
    .first();
  const toolCallChanges = sessionPanel
    .locator('.tool-call-changes', { hasText: targetFileName })
    .first();

  // Expand any unexpanded tool cards until one of the widgets shows our file.
  const isWidgetVisible = async () =>
    (await fileChangeWidget.isVisible().catch(() => false)) ||
    (await toolCallChanges.isVisible().catch(() => false));

  if (!(await isWidgetVisible())) {
    const cardCount = await toolContainers.count();
    for (let i = 0; i < cardCount; i++) {
      const headerButton = toolContainers
        .nth(i)
        .locator('.rich-transcript-tool-button, .file-change-widget > button')
        .first();
      if (await headerButton.isVisible().catch(() => false)) {
        await headerButton.click();
        await page.waitForTimeout(300);
        if (await isWidgetVisible()) break;
      }
    }
  }

  if (await fileChangeWidget.isVisible().catch(() => false)) {
    // FileChangeWidget path: validate the visible diff surface for `file_change`.
    // Both collapsed and expanded states include the filename and a kind label
    // ("Created"/"Updated"/"Deleted") -- that pair is enough evidence that the
    // tool result reached the renderer with the file attribution intact.
    await expect(fileChangeWidget).toContainText(targetFileName);
    await expect(fileChangeWidget).toContainText(/Created|Updated|Deleted/);

    // If the widget is still collapsed (its root is the outer button), click
    // it to expand so the per-file row is visible.
    const isCollapsed = await fileChangeWidget.evaluate(
      (el) => el.tagName === 'BUTTON'
    );
    if (isCollapsed) {
      await fileChangeWidget.click();
      await page.waitForTimeout(300);
    }

    // Once expanded, file rows are buttons inside `.file-change-widget`.
    // The visible row is enough evidence that the file diff rendered;
    // surfacing the snapshot pre depends on the tool result including
    // fileSnapshots, which is a Codex-internal contract not worth coupling
    // a smoke test to.
    const fileRow = page
      .locator('div.file-change-widget')
      .locator('button', { hasText: targetFileName })
      .first();
    await expect(fileRow).toBeVisible({ timeout: 5000 });
  } else {
    // ToolCallChanges path (Codex used shell / MCP). The collapsed summary
    // contains "(N files changed +X -Y)"; expanding it renders DiffViewer
    // or NewFilePreview.
    await expect(toolCallChanges).toBeVisible({ timeout: 5000 });
    await expect(toolCallChanges).toContainText(/\d+ files? changed/);
    await expect(toolCallChanges).toContainText(/\+\d+/);
    const filesChangesHeader = toolCallChanges.locator('button').first();
    await filesChangesHeader.click();
    await page.waitForTimeout(300);
    await expect(toolCallChanges).toContainText(targetFileName);
    const diffOrPreview = toolCallChanges.locator('.diff-viewer, .new-file-preview');
    await expect(diffOrPreview.first()).toBeVisible({ timeout: 5000 });
  }
});
