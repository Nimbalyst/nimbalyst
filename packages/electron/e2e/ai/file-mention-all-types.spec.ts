/**
 * File Mention All Types Test
 *
 * Tests that the @ mention typeahead shows all supported file types,
 * not just markdown files.
 */

import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import {
  launchElectronApp,
  createTempWorkspace,
  TEST_TIMEOUTS
} from '../helpers';
import {
  PLAYWRIGHT_TEST_SELECTORS,
  switchToAgentMode
} from '../utils/testHelpers';
import * as fs from 'fs';
import * as path from 'path';

test.describe('File Mention All Types', () => {
  let electronApp: ElectronApplication;
  let page: Page;
  let workspaceDir: string;

  test.beforeEach(async () => {
    // Create temporary workspace
    workspaceDir = await createTempWorkspace();

    // Create test files of different types
    const testFiles = [
      // Markdown
      { name: 'notes.md', content: '# Notes\n\nSome notes.' },
      // TypeScript
      { name: 'index.ts', content: 'export const foo = "bar";' },
      // JavaScript
      { name: 'script.js', content: 'console.log("hello");' },
      // Python
      { name: 'main.py', content: 'print("hello world")' },
      // JSON
      { name: 'config.json', content: '{"key": "value"}' },
      // YAML
      { name: 'docker-compose.yml', content: 'version: "3"\nservices:\n  web:\n    image: nginx' },
      // HTML
      { name: 'index.html', content: '<html><body>Hello</body></html>' },
      // CSS
      { name: 'styles.css', content: 'body { margin: 0; }' }
    ];

    for (const file of testFiles) {
      const filePath = path.join(workspaceDir, file.name);
      fs.writeFileSync(filePath, file.content);
    }

    // Create a nested file to test subdirectory search
    const subdir = path.join(workspaceDir, 'src', 'components');
    fs.mkdirSync(subdir, { recursive: true });
    fs.writeFileSync(path.join(subdir, 'Button.tsx'), 'export const Button = () => <button />');

    // Launch app
    electronApp = await launchElectronApp({ workspace: workspaceDir });
    page = await electronApp.firstWindow();

    // Wait for app to load
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector(PLAYWRIGHT_TEST_SELECTORS.workspaceSidebar, {
      timeout: TEST_TIMEOUTS.SIDEBAR_LOAD
    });

    // Open a markdown file first to initialize the editor
    await page.click('text=notes.md');
    await page.waitForTimeout(1000);

    // Switch to agent mode to access AI chat
    await switchToAgentMode(page);
    await page.waitForTimeout(500);
  });

  test.afterEach(async () => {
    await electronApp.close().catch(() => {
      // Ignore errors during close
    });
  });

  test('should show all file types and find nested files by name', async () => {
    // Test 1: Type @ to show all files
    const chatInput = page.locator(PLAYWRIGHT_TEST_SELECTORS.chatInput).first();
    await chatInput.click();
    await chatInput.fill('@');
    await page.waitForTimeout(300);

    const typeahead = page.locator('.generic-typeahead');
    await expect(typeahead).toBeVisible({ timeout: 3000 });

    let options = await page.locator('.generic-typeahead-option').allTextContents();
    expect(options.length).toBeGreaterThan(0);

    // Verify all file types are present
    const fileNames = options.map(opt => opt.trim().toLowerCase());
    expect(fileNames.some(name => name.includes('notes.md'))).toBe(true);
    expect(fileNames.some(name => name.includes('index.ts'))).toBe(true);
    expect(fileNames.some(name => name.includes('script.js'))).toBe(true);
    expect(fileNames.some(name => name.includes('main.py'))).toBe(true);
    expect(fileNames.some(name => name.includes('config.json'))).toBe(true);
    expect(fileNames.some(name => name.includes('docker-compose.yml'))).toBe(true);
    expect(fileNames.some(name => name.includes('index.html'))).toBe(true);
    expect(fileNames.some(name => name.includes('styles.css'))).toBe(true);

    // Test 2: Search for nested file by filename only
    await chatInput.fill('@Button');
    await page.waitForTimeout(300);

    options = await page.locator('.generic-typeahead-option').allTextContents();
    expect(options.some(opt => opt.toLowerCase().includes('button'))).toBe(true);
  });
});
