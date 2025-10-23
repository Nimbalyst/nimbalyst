/**
 * E2E test for Plan Status Document Header
 *
 * Tests the new unified tracker system's document header functionality
 * for plan documents with planStatus frontmatter.
 */

import { test, expect, type Page } from '@playwright/test';
import { launchElectronApp, createTempWorkspace, TEST_TIMEOUTS } from '../helpers';
import path from 'path';
import fs from 'fs/promises';

test.describe('Plan Status Document Header', () => {
  let electronApp: any;
  let page: Page;
  let workspaceDir: string;

  test.beforeEach(async () => {
    // Create temp workspace
    workspaceDir = await createTempWorkspace();

    // Copy test plan document to workspace
    const testPlanPath = path.join(workspaceDir, 'test-plan.md');
    const testPlanContent = `---
planStatus:
  planId: plan-test-simple
  title: Simple Test Plan
  status: in-development
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
  progress: 50
---

# Simple Test Plan

This is a simple test plan document for e2e testing of the tracker document header.

## Goals

- Test document header rendering
- Verify field display
- Ensure frontmatter compatibility

## Implementation

The tracker document header should appear at the top of the editor.
`;
    await fs.writeFile(testPlanPath, testPlanContent, 'utf-8');

    // Launch app
    electronApp = await launchElectronApp({ workspace: workspaceDir });

    // Get the first window
    page = await electronApp.firstWindow();

    // Wait for app to be ready
    await page.waitForSelector('.workspace-sidebar', { timeout: TEST_TIMEOUTS.APP_LAUNCH });
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

  test('should render document header for plan status', async () => {
    // Open the test plan file
    const fileItem = page.locator('.file-tree-item').filter({ hasText: 'test-plan.md' });
    await fileItem.click();

    // Wait for editor to load
    await page.waitForSelector('.editor-shell', { timeout: TEST_TIMEOUTS.EDITOR_LOAD });

    // Verify document header container is visible
    const documentHeader = page.locator('.document-header-container');
    await expect(documentHeader).toBeVisible({ timeout: TEST_TIMEOUTS.EDITOR_LOAD });

    // Verify status bar is rendered
    const statusBar = page.locator('.status-bar');
    await expect(statusBar).toBeVisible();

    // Verify status bar header shows tracker type indicator
    const statusBarHeader = page.locator('.status-bar-header');
    await expect(statusBarHeader).toBeVisible();
  });
});
