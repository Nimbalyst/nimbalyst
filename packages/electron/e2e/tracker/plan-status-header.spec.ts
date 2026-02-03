/**
 * E2E test for Plan Status Document Header
 *
 * Tests the unified tracker system's document header functionality
 * for plan documents with planStatus frontmatter.
 *
 * Key scenarios:
 * - Header renders correctly on file open
 * - Header updates when file is externally modified (simulating agent edit)
 */

import { test, expect, type Page } from '@playwright/test';
import { launchElectronApp, createTempWorkspace, TEST_TIMEOUTS } from '../helpers';
import { PLAYWRIGHT_TEST_SELECTORS, openFileFromTree } from '../utils/testHelpers';
import path from 'path';
import fs from 'fs/promises';

test.describe('Plan Status Document Header', () => {
  let electronApp: any;
  let page: Page;
  let workspaceDir: string;

  test.beforeEach(async () => {
    // Create temp workspace
    workspaceDir = await createTempWorkspace();

    // Create test plan document with initial values
    const testPlanPath = path.join(workspaceDir, 'test-plan.md');
    const testPlanContent = `---
planStatus:
  planId: plan-test-simple
  title: Simple Test Plan
  status: draft
  planType: feature
  priority: high
  owner: tester
  stakeholders:
    - team-a
  tags:
    - test
    - tracker
  created: "2025-10-23"
  updated: "2025-10-23T19:45:00.000Z"
  progress: 25
---

# Simple Test Plan

This is a simple test plan document for e2e testing of the tracker document header.

## Goals

- Test document header rendering
- Verify header updates on external file changes

## Implementation

The tracker document header should update when the file is modified externally.
`;
    await fs.writeFile(testPlanPath, testPlanContent, 'utf-8');

    // Launch app
    electronApp = await launchElectronApp({ workspace: workspaceDir, permissionMode: 'allow-all' });

    // Get the first window
    page = await electronApp.firstWindow();

    // Wait for app to be ready
    await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.workspaceSidebar, { timeout: TEST_TIMEOUTS.APP_LAUNCH });
  });

  test.afterEach(async () => {
    if (electronApp) {
      await electronApp.close();
    }
    // Cleanup temp workspace
    if (workspaceDir) {
      await fs.rm(workspaceDir, { recursive: true, force: true });
    }
  });

  test('should update document header when file is externally modified', async () => {
    const testPlanPath = path.join(workspaceDir, 'test-plan.md');

    // Step 1: Open the test plan file
    await openFileFromTree(page, 'test-plan.md');

    // Wait for editor to load
    await page.waitForSelector('.editor-shell', { timeout: TEST_TIMEOUTS.EDITOR_LOAD });

    // Step 2: Verify document header is visible with initial values
    const documentHeader = page.locator(PLAYWRIGHT_TEST_SELECTORS.documentHeaderContainer);
    await expect(documentHeader).toBeVisible({ timeout: TEST_TIMEOUTS.EDITOR_LOAD });

    const statusBar = page.locator(PLAYWRIGHT_TEST_SELECTORS.statusBar);
    await expect(statusBar).toBeVisible();

    // Verify initial progress value is 25
    const progressInput = page.locator(PLAYWRIGHT_TEST_SELECTORS.sliderNumberInput);
    await expect(progressInput).toHaveValue('25', { timeout: 5000 });

    // Step 3: Externally modify the file (simulating agent edit)
    const updatedContent = `---
planStatus:
  planId: plan-test-simple
  title: Simple Test Plan
  status: completed
  planType: feature
  priority: high
  owner: tester
  stakeholders:
    - team-a
  tags:
    - test
    - tracker
  created: "2025-10-23"
  updated: "2025-10-23T19:45:00.000Z"
  progress: 100
---

# Simple Test Plan

This is a simple test plan document for e2e testing of the tracker document header.

## Goals

- Test document header rendering
- Verify header updates on external file changes

## Implementation

The tracker document header should update when the file is modified externally.
`;
    await fs.writeFile(testPlanPath, updatedContent, 'utf-8');

    // Step 4: Wait for file watcher to detect change and update UI
    // The progress input should update from 25 to 100
    await expect(progressInput).toHaveValue('100', { timeout: 10000 });

    // Step 5: Verify status select also updated to "completed"
    // The status field label is "status" (case insensitive), scope to that field
    const statusField = statusBar.locator('.status-bar-field', { has: page.locator('label', { hasText: /^status$/i }) });
    const statusSelectValue = statusField.locator(PLAYWRIGHT_TEST_SELECTORS.customSelectValue);
    await expect(statusSelectValue).toContainText('Completed', { timeout: 5000 });
  });
});
