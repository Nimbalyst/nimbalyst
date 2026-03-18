/**
 * Extension Marketplace Screenshots
 *
 * Captures screenshots of each extension's editor for the marketplace.
 * Reads the `marketplace.screenshots` field from each extension's manifest.json
 * to determine what files to open and what to capture.
 *
 * Output: packages/extensions/{ext}/screenshots/
 *
 * Run:
 *   cd packages/electron && npm run marketing:screenshots:grep -- "extension-"
 */

import { test } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import {
  launchMarketingApp,
  setTheme,
  SCREENSHOT_DIR,
  type Theme,
} from '../utils/helpers';
import type { ElectronApplication, Page } from 'playwright';

// Extension screenshot viewport (wider for marketplace cards)
const SCREENSHOT_VIEWPORT = { width: 1200, height: 800 };

interface ManifestScreenshot {
  alt: string;
  fileToOpen?: string;
  selector?: string;
}

interface ExtensionManifest {
  id: string;
  name: string;
  marketplace?: {
    screenshots?: ManifestScreenshot[];
  };
}

interface ExtensionInfo {
  manifest: ExtensionManifest;
  extensionPath: string;
  screenshotsDir: string;
}

/**
 * Discover all extensions with marketplace screenshots declared.
 */
async function discoverExtensions(): Promise<ExtensionInfo[]> {
  const extensionsRoot = path.resolve(__dirname, '../../../../extensions');
  const entries = await fs.readdir(extensionsRoot, { withFileTypes: true });
  const extensions: ExtensionInfo[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const manifestPath = path.join(extensionsRoot, entry.name, 'manifest.json');
    try {
      const raw = await fs.readFile(manifestPath, 'utf-8');
      const manifest: ExtensionManifest = JSON.parse(raw);

      if (manifest.marketplace?.screenshots && manifest.marketplace.screenshots.length > 0) {
        extensions.push({
          manifest,
          extensionPath: path.join(extensionsRoot, entry.name),
          screenshotsDir: path.join(extensionsRoot, entry.name, 'screenshots'),
        });
      }
    } catch {
      // No manifest or not JSON -- skip
    }
  }

  return extensions;
}

test.describe('extension-screenshots', () => {
  test.describe.configure({ mode: 'serial' });

  let app: ElectronApplication;
  let page: Page;
  let workspaceDir: string;

  test.beforeAll(async () => {
    const result = await launchMarketingApp({ theme: 'dark' });
    app = result.app;
    page = result.page;
    workspaceDir = result.workspaceDir;

    // Resize to screenshot viewport
    await app.evaluate(({ BrowserWindow }, viewport) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) {
        win.setSize(viewport.width, viewport.height);
        win.center();
      }
    }, SCREENSHOT_VIEWPORT);

    await page.waitForTimeout(500);
  });

  test.afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  test('capture extension editor screenshots', async () => {
    const extensions = await discoverExtensions();

    if (extensions.length === 0) {
      console.log('No extensions with marketplace.screenshots found. Skipping.');
      return;
    }

    for (const ext of extensions) {
      const { manifest, extensionPath, screenshotsDir } = ext;
      const screenshots = manifest.marketplace!.screenshots!;

      console.log(`Capturing screenshots for ${manifest.name} (${screenshots.length} screenshots)...`);

      // Ensure screenshots directory exists
      await fs.mkdir(screenshotsDir, { recursive: true });

      for (let i = 0; i < screenshots.length; i++) {
        const ss = screenshots[i];

        if (ss.fileToOpen) {
          // Copy the sample file to the workspace if it exists in the extension
          const samplePath = path.join(extensionPath, ss.fileToOpen);
          const destPath = path.join(workspaceDir, path.basename(ss.fileToOpen));

          try {
            await fs.copyFile(samplePath, destPath);
          } catch {
            console.warn(`  Sample file not found: ${samplePath}`);
            continue;
          }

          // Open the file in Nimbalyst via IPC
          await app.evaluate(({ BrowserWindow }, filePath) => {
            const win = BrowserWindow.getAllWindows()[0];
            if (win) {
              win.webContents.send('open-file', filePath);
            }
          }, destPath);

          // Wait for the custom editor to render
          await page.waitForTimeout(2000);
        }

        // Capture both dark and light theme screenshots
        for (const theme of ['dark', 'light'] as Theme[]) {
          await setTheme(app, theme);
          await page.waitForTimeout(600);

          const filename = `${manifest.id}-${i}-${theme}.png`;

          if (ss.selector) {
            // Capture specific element
            const element = page.locator(ss.selector);
            if (await element.isVisible()) {
              await element.screenshot({
                path: path.join(screenshotsDir, filename),
              });
            } else {
              console.warn(`  Selector not visible: ${ss.selector}`);
              // Fall back to full page
              await page.screenshot({
                path: path.join(screenshotsDir, filename),
              });
            }
          } else {
            // Capture the main editor area
            const editorArea = page.locator('.tab-editor-content, .custom-editor-container, .settings-view-main');
            if (await editorArea.first().isVisible()) {
              await editorArea.first().screenshot({
                path: path.join(screenshotsDir, filename),
              });
            } else {
              // Fall back to full page
              await page.screenshot({
                path: path.join(screenshotsDir, filename),
              });
            }
          }

          console.log(`  Captured: ${filename}`);
        }

        // Also save a "card" sized version (dark only, used for marketplace cards)
        await setTheme(app, 'dark');
        await page.waitForTimeout(300);

        const cardFilename = `${manifest.id}-${i}-card.png`;
        await page.screenshot({
          path: path.join(screenshotsDir, cardFilename),
          clip: {
            x: 0,
            y: 0,
            width: SCREENSHOT_VIEWPORT.width,
            height: SCREENSHOT_VIEWPORT.height,
          },
        });
        console.log(`  Captured: ${cardFilename}`);
      }
    }
  });
});
