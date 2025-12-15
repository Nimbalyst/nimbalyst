import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { launchElectronApp, createTempWorkspace, waitForAppReady } from '../helpers';
import * as fs from 'fs/promises';
import * as path from 'path';

let electronApp: ElectronApplication;
let page: Page;
let workspaceDir: string;

test.describe('DataModelLM Claude Plugin', () => {
  test.beforeEach(async () => {
    // Create a temp workspace with a test file
    workspaceDir = await createTempWorkspace();
    const testFilePath = path.join(workspaceDir, 'test.md');
    await fs.writeFile(testFilePath, '# Test Document\n\nTest content.\n', 'utf8');

    // Launch the app
    electronApp = await launchElectronApp({ workspace: workspaceDir });
    page = await electronApp.firstWindow();
    await waitForAppReady(page);
  });

  test.afterEach(async () => {
    if (electronApp) {
      await electronApp.close();
    }
    if (workspaceDir) {
      await fs.rm(workspaceDir, { recursive: true, force: true });
    }
  });

  test('should recognize datamodellm extension and show command in UI suggestions', async () => {
    // 1. Check if the extension is listed as installed
    const installedExtensions = await page.evaluate(async () => {
      return await window.electronAPI.extensions.listInstalled();
    });

    console.log('Installed extensions:', JSON.stringify(installedExtensions, null, 2));

    const datamodellmExt = installedExtensions.find(
      (ext: any) => ext.id === 'com.nimbalyst.datamodellm' || ext.manifest?.id === 'com.nimbalyst.datamodellm'
    );

    if (!datamodellmExt) {
      console.log('DataModelLM extension not found in installed extensions');
      console.log('Extension IDs found:', installedExtensions.map((e: any) => e.id));
    }

    expect(datamodellmExt, 'DataModelLM extension should be installed').toBeTruthy();
    expect(datamodellmExt.manifest.contributions?.claudePlugin, 'Extension should have claudePlugin contribution').toBeTruthy();

    // 2. Check the plugin commands API returns the command
    const pluginCommands = await page.evaluate(async () => {
      return await window.electronAPI.extensions.getClaudePluginCommands();
    });

    console.log('Plugin commands from API:', JSON.stringify(pluginCommands, null, 2));

    const datamodelCmd = pluginCommands.find(
      (cmd: any) => cmd.pluginNamespace === 'datamodellm' && cmd.commandName === 'datamodel'
    );

    expect(datamodelCmd, 'datamodellm:datamodel command should be available from API').toBeTruthy();
    expect(datamodelCmd.description).toContain('Prisma');

    // 3. Open a file and switch to agent mode
    await page.locator('.file-tree-name', { hasText: 'test.md' }).click();
    await expect(page.locator('.file-tabs-container .tab.active .tab-title')).toContainText('test.md', { timeout: 3000 });

    // Switch to agent mode
    const agentModeButton = page.locator('[data-mode="agent"]');
    if (await agentModeButton.isVisible()) {
      await agentModeButton.click();
      await page.waitForTimeout(500);
    }

    // 4. Type "/" in the chat input to trigger the slash command menu
    const chatInput = page.locator('.ai-chat-input textarea, .chat-input textarea, [data-testid="chat-input"]');
    await chatInput.waitFor({ state: 'visible', timeout: 5000 });
    await chatInput.click();
    await chatInput.fill('/da');
    await page.waitForTimeout(500);

    // Debug: Check what menus are visible
    const menuInfo = await page.evaluate(() => {
      const menus = document.querySelectorAll('[class*="menu"], [class*="dropdown"], [class*="suggestions"], [class*="typeahead"]');
      return Array.from(menus).map(m => ({
        className: m.className,
        visible: (m as HTMLElement).offsetParent !== null,
        text: m.textContent?.substring(0, 200),
      }));
    });
    console.log('Visible menus after typing /:', JSON.stringify(menuInfo, null, 2));

    // Look for the slash command menu - it uses GenericTypeahead component
    const typeahead = page.locator('.generic-typeahead');
    await expect(typeahead).toBeVisible({ timeout: 3000 });

    // Get all option labels
    const menuOptions = await page.locator('.generic-typeahead-option .generic-typeahead-option-label').allTextContents();
    console.log('Menu options:', menuOptions);

    // Check if datamodellm:datamodel is in the menu
    const hasDatamodelCommand = menuOptions.some(opt => opt.includes('datamodellm:datamodel') || opt.includes('datamodel'));
    expect(hasDatamodelCommand, 'datamodellm:datamodel should appear in slash command menu').toBe(true);
  });
});
