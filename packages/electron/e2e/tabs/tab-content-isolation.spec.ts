import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';
import { launchElectronApp, createTempWorkspace, TEST_TIMEOUTS, waitForAppReady, getKeyboardShortcut } from '../helpers';
import * as fs from 'fs/promises';
import * as path from 'path';

test.describe('Tab Content Isolation', () => {
  let electronApp: ElectronApplication;
  let page: Page;
  let workspaceDir: string;

  test.beforeEach(async () => {
    workspaceDir = await createTempWorkspace();

    // Create test files with distinct content
    await fs.writeFile(
      path.join(workspaceDir, 'alpha.md'),
      '# Alpha Document\n\nThis is the alpha file with unique content.\n',
      'utf8'
    );
    await fs.writeFile(
      path.join(workspaceDir, 'beta.md'),
      '# Beta Document\n\nThis is the beta file with different content.\n',
      'utf8'
    );
    await fs.writeFile(
      path.join(workspaceDir, 'gamma.md'),
      '# Gamma Document\n\nThis is the gamma file with its own content.\n',
      'utf8'
    );

    electronApp = await launchElectronApp({
      workspace: workspaceDir,
      env: { NODE_ENV: 'test' }
    });

    page = await electronApp.firstWindow();
    await waitForAppReady(page);
  });

  test.afterEach(async () => {
    await electronApp?.close();
    await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
  });

  test('should preserve each file content independently when switching tabs', async () => {
    const editor = page.locator('.editor [contenteditable="true"]');

    // Open alpha.md
    await page.locator('.file-tree-name', { hasText: 'alpha.md' }).click();
    await expect(page.locator('.tab.active .tab-title')).toContainText('alpha.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });

    // Add unique marker to alpha
    const alphaMarker = `alpha-marker-${Date.now()}`;
    await editor.click();
    await page.keyboard.press(getKeyboardShortcut('Mod+End'));
    await page.keyboard.type(`\n\n${alphaMarker}`);

    // Verify alpha content
    let editorText = await editor.innerText();
    expect(editorText).toContain('Alpha Document');
    expect(editorText).toContain(alphaMarker);

    // Switch to beta.md
    await page.locator('.file-tree-name', { hasText: 'beta.md' }).click();
    await expect(page.locator('.tab.active .tab-title')).toContainText('beta.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });
    await page.waitForTimeout(TEST_TIMEOUTS.DEFAULT_WAIT);

    // Add unique marker to beta
    const betaMarker = `beta-marker-${Date.now()}`;
    await editor.click();
    await page.keyboard.press(getKeyboardShortcut('Mod+End'));
    await page.keyboard.type(`\n\n${betaMarker}`);

    // Verify beta content (should NOT contain alpha content)
    editorText = await editor.innerText();
    expect(editorText).toContain('Beta Document');
    expect(editorText).toContain(betaMarker);
    expect(editorText).not.toContain('Alpha Document');
    expect(editorText).not.toContain(alphaMarker);

    // Switch to gamma.md
    await page.locator('.file-tree-name', { hasText: 'gamma.md' }).click();
    await expect(page.locator('.tab.active .tab-title')).toContainText('gamma.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });
    await page.waitForTimeout(TEST_TIMEOUTS.DEFAULT_WAIT);

    // Add unique marker to gamma
    const gammaMarker = `gamma-marker-${Date.now()}`;
    await editor.click();
    await page.keyboard.press(getKeyboardShortcut('Mod+End'));
    await page.keyboard.type(`\n\n${gammaMarker}`);

    // Verify gamma content (should NOT contain alpha or beta content)
    editorText = await editor.innerText();
    expect(editorText).toContain('Gamma Document');
    expect(editorText).toContain(gammaMarker);
    expect(editorText).not.toContain('Alpha Document');
    expect(editorText).not.toContain('Beta Document');
    expect(editorText).not.toContain(alphaMarker);
    expect(editorText).not.toContain(betaMarker);

    // Switch back to alpha - should still have alpha content only
    await page.locator('.tab', { has: page.locator('.tab-title', { hasText: 'alpha.md' }) }).click();
    await expect(page.locator('.tab.active .tab-title')).toContainText('alpha.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });
    await page.waitForTimeout(TEST_TIMEOUTS.DEFAULT_WAIT);

    editorText = await editor.innerText();
    expect(editorText).toContain('Alpha Document');
    expect(editorText).toContain(alphaMarker);
    expect(editorText).not.toContain('Beta Document');
    expect(editorText).not.toContain('Gamma Document');
    expect(editorText).not.toContain(betaMarker);
    expect(editorText).not.toContain(gammaMarker);

    // Switch back to beta - should still have beta content only
    await page.locator('.tab', { has: page.locator('.tab-title', { hasText: 'beta.md' }) }).click();
    await expect(page.locator('.tab.active .tab-title')).toContainText('beta.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });
    await page.waitForTimeout(TEST_TIMEOUTS.DEFAULT_WAIT);

    editorText = await editor.innerText();
    expect(editorText).toContain('Beta Document');
    expect(editorText).toContain(betaMarker);
    expect(editorText).not.toContain('Alpha Document');
    expect(editorText).not.toContain('Gamma Document');
    expect(editorText).not.toContain(alphaMarker);
    expect(editorText).not.toContain(gammaMarker);
  });

  test('should handle rapid tab switching without content corruption', async () => {
    const editor = page.locator('.editor [contenteditable="true"]');

    // Open all three files
    await page.locator('.file-tree-name', { hasText: 'alpha.md' }).click();
    await expect(page.locator('.tab .tab-title', { hasText: 'alpha.md' })).toBeVisible({ timeout: TEST_TIMEOUTS.TAB_SWITCH });

    await page.locator('.file-tree-name', { hasText: 'beta.md' }).click();
    await expect(page.locator('.tab .tab-title', { hasText: 'beta.md' })).toBeVisible({ timeout: TEST_TIMEOUTS.TAB_SWITCH });

    await page.locator('.file-tree-name', { hasText: 'gamma.md' }).click();
    await expect(page.locator('.tab .tab-title', { hasText: 'gamma.md' })).toBeVisible({ timeout: TEST_TIMEOUTS.TAB_SWITCH });

    // Add unique markers to each file
    const markers = {
      alpha: `rapid-alpha-${Date.now()}`,
      beta: `rapid-beta-${Date.now()}`,
      gamma: `rapid-gamma-${Date.now()}`
    };

    // Alpha
    await page.locator('.tab', { has: page.locator('.tab-title', { hasText: 'alpha.md' }) }).click();
    await editor.click();
    await page.keyboard.press(getKeyboardShortcut('Mod+End'));
    await page.keyboard.type(`\n${markers.alpha}`);

    // Beta
    await page.locator('.tab', { has: page.locator('.tab-title', { hasText: 'beta.md' }) }).click();
    await page.waitForTimeout(100); // Minimal wait
    await editor.click();
    await page.keyboard.press(getKeyboardShortcut('Mod+End'));
    await page.keyboard.type(`\n${markers.beta}`);

    // Gamma
    await page.locator('.tab', { has: page.locator('.tab-title', { hasText: 'gamma.md' }) }).click();
    await page.waitForTimeout(100);
    await editor.click();
    await page.keyboard.press(getKeyboardShortcut('Mod+End'));
    await page.keyboard.type(`\n${markers.gamma}`);

    // Rapid switching without waiting
    await page.locator('.tab', { has: page.locator('.tab-title', { hasText: 'alpha.md' }) }).click();
    await page.locator('.tab', { has: page.locator('.tab-title', { hasText: 'beta.md' }) }).click();
    await page.locator('.tab', { has: page.locator('.tab-title', { hasText: 'gamma.md' }) }).click();
    await page.locator('.tab', { has: page.locator('.tab-title', { hasText: 'alpha.md' }) }).click();

    // Wait for everything to settle
    await page.waitForTimeout(TEST_TIMEOUTS.DEFAULT_WAIT);

    // Verify alpha still has only its content
    let editorText = await editor.innerText();
    expect(editorText).toContain('Alpha Document');
    expect(editorText).toContain(markers.alpha);
    expect(editorText).not.toContain(markers.beta);
    expect(editorText).not.toContain(markers.gamma);

    // Verify beta
    await page.locator('.tab', { has: page.locator('.tab-title', { hasText: 'beta.md' }) }).click();
    await page.waitForTimeout(TEST_TIMEOUTS.DEFAULT_WAIT);
    editorText = await editor.innerText();
    expect(editorText).toContain('Beta Document');
    expect(editorText).toContain(markers.beta);
    expect(editorText).not.toContain(markers.alpha);
    expect(editorText).not.toContain(markers.gamma);

    // Verify gamma
    await page.locator('.tab', { has: page.locator('.tab-title', { hasText: 'gamma.md' }) }).click();
    await page.waitForTimeout(TEST_TIMEOUTS.DEFAULT_WAIT);
    editorText = await editor.innerText();
    expect(editorText).toContain('Gamma Document');
    expect(editorText).toContain(markers.gamma);
    expect(editorText).not.toContain(markers.alpha);
    expect(editorText).not.toContain(markers.beta);
  });

  test('should preserve dirty state correctly per tab', async () => {
    const editor = page.locator('.editor [contenteditable="true"]');

    // Open alpha and make it dirty
    await page.locator('.file-tree-name', { hasText: 'alpha.md' }).click();
    await expect(page.locator('.tab.active .tab-title')).toContainText('alpha.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });
    await editor.click();
    await page.keyboard.type('\nDirty alpha');

    // Verify alpha is dirty
    const alphaTab = page.locator('.tab', { has: page.locator('.tab-title', { hasText: 'alpha.md' }) });
    await expect(alphaTab.locator('.tab-dirty-indicator')).toBeVisible();

    // Open beta (clean)
    await page.locator('.file-tree-name', { hasText: 'beta.md' }).click();
    await expect(page.locator('.tab.active .tab-title')).toContainText('beta.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });

    // Beta should not be dirty
    const betaTab = page.locator('.tab', { has: page.locator('.tab-title', { hasText: 'beta.md' }) });
    await expect(betaTab.locator('.tab-dirty-indicator')).toHaveCount(0);

    // Alpha should still show dirty indicator
    await expect(alphaTab.locator('.tab-dirty-indicator')).toBeVisible();

    // Make beta dirty
    await editor.click();
    await page.keyboard.type('\nDirty beta');
    await expect(betaTab.locator('.tab-dirty-indicator')).toBeVisible();

    // Both tabs should now be dirty
    await expect(alphaTab.locator('.tab-dirty-indicator')).toBeVisible();
    await expect(betaTab.locator('.tab-dirty-indicator')).toBeVisible();
  });
});
