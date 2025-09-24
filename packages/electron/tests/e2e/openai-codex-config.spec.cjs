// @ts-check
const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const { execSync } = require('child_process');

function tmpWorkspaceRoot() {
  return path.join(os.tmpdir(), 'preditor-codex-test-');
}

function settingsShortcut() {
  return process.platform === 'darwin' ? 'Meta+Comma' : 'Control+Comma';
}

test.describe('OpenAI Codex Configuration', () => {
  test('should configure OpenAI Codex without warning symbols', async () => {
    const workspaceDir = await fs.mkdtemp(tmpWorkspaceRoot());
    const testFile = path.join(workspaceDir, 'test.md');
    await fs.writeFile(testFile, '# Test Document\n\nThis is a test document.\n', 'utf8');

    const electronMain = path.resolve(__dirname, '../../out/main/index.js');
    const electronCwd = path.resolve(__dirname, '../../../../');

    const electronApp = await electron.launch({
      args: [electronMain, '--workspace', workspaceDir],
      cwd: electronCwd,
      env: {
        ...process.env,
        OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? 'sk-test-key',
        ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
        PLAYWRIGHT: '1'
      }
    });

    // Check if openai-codex CLI is installed
    let isCodexInstalled = false;
    try {
      execSync('which openai-codex', { stdio: 'ignore' });
      isCodexInstalled = true;
    } catch {}

    // Check if claude-code CLI is installed
    let isClaudeCodeInstalled = false;
    try {
      execSync('which claude-code', { stdio: 'ignore' });
      isClaudeCodeInstalled = true;
    } catch {}

    try {
      const page = await electronApp.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      // Skip API key dialog if shown
      const apiDialog = page.locator('.api-key-dialog-overlay');
      if (await apiDialog.isVisible()) {
        await page.locator('.api-key-dialog-button.secondary').click();
      }

      await page.waitForSelector('.workspace-sidebar', { timeout: 15000 });

      // Open AI Models configuration
      await page.keyboard.press(settingsShortcut());
      await page.waitForTimeout(300);

      // Wait for AI Models dialog
      await page.waitForSelector('.ai-models-redesigned', { timeout: 5000 });

      // Check that OpenAI Codex appears in the sidebar
      const codexNavItem = page.locator('.nav-item:has-text("OpenAI Codex")');
      await expect(codexNavItem).toBeVisible();

      // Click on OpenAI Codex
      await codexNavItem.click();
      await page.waitForTimeout(200);

      // Verify the panel shows OpenAI Codex configuration
      const panelTitle = page.locator('.provider-panel-title:has-text("OpenAI Codex")');
      await expect(panelTitle).toBeVisible();

      // Check installation status section
      const installationSection = page.locator('.installation-status');
      await expect(installationSection).toBeVisible();

      // Click refresh to check actual installation status
      const refreshButton = page.locator('button:has-text("Refresh Status")');
      if (await refreshButton.isVisible()) {
        await refreshButton.click();
        await page.waitForTimeout(500);
      }

      // If installed, enable it
      if (isCodexInstalled) {
        const statusText = await installationSection.textContent();
        if (statusText?.includes('Installed')) {
          // Enable the provider
          const enableToggle = page.locator('.provider-toggle input[type="checkbox"]');
          const isEnabled = await enableToggle.isChecked();
          if (!isEnabled) {
            await enableToggle.click();
            await page.waitForTimeout(200);
          }

          // Add API key
          const apiKeyInput = page.locator('.api-key-input').first();
          if (await apiKeyInput.isVisible()) {
            await apiKeyInput.fill(process.env.OPENAI_API_KEY || 'sk-test-key');
          }
        }
      }

      // Also check Claude Code
      const claudeCodeNavItem = page.locator('.nav-item:has-text("Claude Code")');
      await claudeCodeNavItem.click();
      await page.waitForTimeout(200);

      const claudeInstallSection = page.locator('.installation-status');
      const claudeRefreshButton = page.locator('button:has-text("Refresh Status")');
      if (await claudeRefreshButton.isVisible()) {
        await claudeRefreshButton.click();
        await page.waitForTimeout(500);
      }

      // Save settings
      const saveButton = page.locator('button:has-text("Save")');
      await saveButton.click();
      await page.waitForTimeout(300);

      // Re-open settings to check warning symbols are gone
      await page.keyboard.press(settingsShortcut());
      await page.waitForTimeout(300);

      await page.waitForSelector('.ai-models-redesigned', { timeout: 5000 });

      // Check OpenAI Codex status indicator
      const openaiCodexNavItem = page.locator('.nav-item:has-text("OpenAI Codex")');
      const openaiCodexStatusIcon = await openaiCodexNavItem.locator('.nav-item-status');
      const openaiCodexStatusText = await openaiCodexStatusIcon.textContent();

      // Should not have warning symbol if properly configured
      if (isCodexInstalled) {
        expect(openaiCodexStatusText).not.toBe('⚠');
      }

      // Check Claude Code status indicator
      const claudeCodeNav = page.locator('.nav-item:has-text("Claude Code")');
      const claudeCodeStatusIcon = await claudeCodeNav.locator('.nav-item-status');
      const claudeCodeStatusText = await claudeCodeStatusIcon.textContent();

      if (isClaudeCodeInstalled) {
        expect(claudeCodeStatusText).not.toBe('⚠');
      }

      // Close settings
      const cancelButton = page.locator('button:has-text("Cancel")');
      await cancelButton.click();
      await page.waitForTimeout(200);

      // Open AI Chat to verify provider appears
      await page.keyboard.press('Meta+Shift+a');
      await page.waitForTimeout(300);

      // Check provider selector
      const providerSelector = page.locator('.provider-selector-trigger');
      if (await providerSelector.isVisible()) {
        await providerSelector.click();
        await page.waitForTimeout(200);

        // Verify OpenAI Codex appears in dropdown
        const codexOption = page.locator('.provider-selector-option:has-text("OpenAI Codex")');
        await expect(codexOption).toBeVisible();

        // Close dropdown
        await page.keyboard.press('Escape');
      }

    } finally {
      await electronApp.close().catch(() => undefined);
      await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});