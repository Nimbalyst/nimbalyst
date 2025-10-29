import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import {
  launchElectronApp,
  createTempWorkspace,
  waitForAppReady,
  TEST_TIMEOUTS,
} from '../helpers';
import * as fs from 'fs/promises';
import * as path from 'path';

let electronApp: ElectronApplication;
let page: Page;
let workspaceDir: string;

test.describe('Custom Tracker Loading', () => {
  test.beforeEach(async () => {
    workspaceDir = await createTempWorkspace();

    // Create .nimbalyst/trackers directory
    const trackersDir = path.join(workspaceDir, '.nimbalyst', 'trackers');
    await fs.mkdir(trackersDir, { recursive: true });

    // Create a custom character tracker YAML file
    const characterTrackerYAML = `type: character
displayName: Character
displayNamePlural: Characters
icon: person
color: "#8b5cf6"

modes:
  inline: true
  fullDocument: false

idPrefix: chr
idFormat: ulid

fields:
  - name: name
    type: string
    required: true

  - name: role
    type: select
    default: supporting
    options:
      - value: protagonist
        label: Protagonist
      - value: antagonist
        label: Antagonist
      - value: supporting
        label: Supporting

  - name: series
    type: string
    required: true

inlineTemplate: "{icon} {name} ({role})"
`;

    await fs.writeFile(
      path.join(trackersDir, 'character.yaml'),
      characterTrackerYAML,
      'utf8'
    );

    // Verify the file was created
    const filesInTrackersDir = await fs.readdir(trackersDir);
    console.log('[TEST] Workspace dir:', workspaceDir);
    console.log('[TEST] Trackers dir:', trackersDir);
    console.log('[TEST] Files in trackers dir before launch:', filesInTrackersDir);

    // Create a test markdown file
    const testFile = path.join(workspaceDir, 'test.md');
    await fs.writeFile(testFile, '# Test Document\n\nTest custom tracker.\n', 'utf8');

    // Add delay to ensure files are fully written and flushed
    await new Promise(resolve => setTimeout(resolve, 500));

    // Launch app with workspace
    electronApp = await launchElectronApp({ workspace: workspaceDir });
    page = await electronApp.firstWindow();

    // Set up console logging IMMEDIATELY after getting page
    page.on('console', msg => {
      const text = msg.text();
      console.log(`[BROWSER] ${text}`);
    });

    // Wait for app to load
    await page.waitForLoadState('domcontentloaded');

    // Wait for file tree to appear (more reliable than workspace-sidebar)
    await page.waitForSelector('.file-tree-name', { timeout: TEST_TIMEOUTS.FILE_TREE_LOAD });
  });

  test.afterEach(async () => {
    await electronApp.close();
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  test('should load custom character tracker from YAML file', async () => {
    // Wait for custom trackers to load - need to wait for:
    // 1. Workspace to be set (triggers useEffect)
    // 2. loadCustomTrackers to run
    // 3. Character to be registered
    await page.waitForTimeout(5000);

    // Check if character.yaml still exists on disk
    const trackersDir = path.join(workspaceDir, '.nimbalyst', 'trackers');
    const filesAfterLaunch = await fs.readdir(trackersDir);
    console.log('[TEST] Files in trackers dir AFTER launch:', filesAfterLaunch);

    // Open the test file
    await page.locator('.file-tree-name', { hasText: 'test.md' }).click();
    await page.waitForTimeout(500);

    // Wait for editor to be ready
    const editor = page.locator('.editor [contenteditable="true"]').first();
    await expect(editor).toBeVisible({ timeout: TEST_TIMEOUTS.EDITOR_LOAD });

    // Click in editor to focus
    await editor.click();
    await page.waitForTimeout(200);

    // Type # to trigger typeahead
    await page.keyboard.type('#');

    // Wait for menu to fully render
    await page.waitForTimeout(2000);

    // Take screenshot to verify Character appears
    await page.screenshot({
      path: path.join(workspaceDir, 'typeahead-screenshot.png'),
      fullPage: false
    });

    // Verify Character option is in the menu by checking the DOM
    const menuText = await page.locator('body').textContent();
    expect(menuText).toContain('Character');
    expect(menuText).toContain('Track a character');

    console.log('[TEST] ✓ Custom character tracker successfully loaded and appears in typeahead!');
  });
});
