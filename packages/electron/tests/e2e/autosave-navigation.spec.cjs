// @ts-check
const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');

function tmpWorkspaceRoot() {
  return path.join(os.tmpdir(), 'preditor-autosave-');
}

function selectAllShortcut() {
  return process.platform === 'darwin' ? 'Meta+A' : 'Control+A';
}

test.describe('Autosave before navigation', () => {
  test('saves dirty document when navigating via document link', async () => {
    const workspaceDir = await fs.mkdtemp(tmpWorkspaceRoot());
    const sourceFile = path.join(workspaceDir, 'source.md');
    const targetFile = path.join(workspaceDir, 'target.md');

    await fs.writeFile(sourceFile, '# Source\n\nOriginal content before autosave.\n', 'utf8');
    await fs.writeFile(targetFile, '# Target\n\nThis is the target document.\n', 'utf8');

    const electronMain = path.resolve(__dirname, '../../out/main/index.js');
    const electronCwd = path.resolve(__dirname, '../../../../');

    const electronApp = await electron.launch({
      args: [electronMain, '--workspace', workspaceDir],
      cwd: electronCwd,
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? 'playwright-test-key',
        ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
        PLAYWRIGHT: '1'
      }
    });

    const marker = `autosave-marker-${Date.now()}`;

    try {
      const page = await electronApp.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      const apiDialog = page.locator('.api-key-dialog-overlay');
      if (await apiDialog.isVisible()) {
        await page.locator('.api-key-dialog-button.secondary').click();
      }

      await page.waitForSelector('.workspace-sidebar', { timeout: 15000 });
      await page.locator('.file-tree-name', { hasText: 'source.md' }).first().waitFor({ timeout: 15000 });
      await page.locator('.file-tree-name', { hasText: 'target.md' }).first().waitFor({ timeout: 15000 });

      await page.locator('.file-tree-name', { hasText: 'source.md' }).click();
      await expect(page.locator('.tab.active .tab-title')).toHaveText('source.md', { timeout: 10000 });

      const editor = page.locator('.editor [contenteditable="true"]');
      await editor.click();
      await page.keyboard.press(selectAllShortcut());
      await page.keyboard.type(`Autosave before navigation\n\nDirty section ${marker}\n\n[`);
      await page.keyboard.type('target');
      await page.waitForTimeout(150);
      await page.keyboard.press('Enter');

      const documentReference = page.locator('.document-reference', { hasText: 'target.md' });
      await expect(documentReference).toBeVisible({ timeout: 10000 });
      await expect(page.locator('.tab.active .tab-dirty-indicator')).toBeVisible();

      await documentReference.click();
      await expect(page.locator('.tab.active .tab-title')).toHaveText('target.md', { timeout: 15000 });

      const sourceTabDirty = page.locator('.tab', {
        has: page.locator('.tab-title', { hasText: 'source.md' })
      }).locator('.tab-dirty-indicator');
      await expect(sourceTabDirty).toHaveCount(0);

      await expect.poll(async () => fs.readFile(sourceFile, 'utf8'), {
        timeout: 10000,
        message: 'Expected source file to contain autosaved marker'
      }).toContain(marker);

      await page.locator('.tab-title', { hasText: 'source.md' }).click();
      await expect(page.locator('.tab.active .tab-title')).toHaveText('source.md');
      await expect(page.locator('.tab.active .tab-dirty-indicator')).toHaveCount(0);

      const editorText = await editor.innerText();
      expect(editorText).toContain(marker);
    } finally {
      await electronApp.close().catch(() => undefined);
      await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
