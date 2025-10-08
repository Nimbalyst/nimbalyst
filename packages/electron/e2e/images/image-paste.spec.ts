import { test, expect } from '@playwright/test';
import { launchElectronApp, createTempWorkspace, TEST_TIMEOUTS, ACTIVE_EDITOR_SELECTOR } from '../helpers';
import * as path from 'path';
import * as fs from 'fs';

test.describe('Image Paste', () => {
  test('should store pasted image as content-addressed asset', async () => {
    const workspace = await createTempWorkspace();

    // Create a test markdown file
    await fs.promises.writeFile(
      path.join(workspace, 'test.md'),
      '# Test Document\n\nPaste image here.\n',
      'utf8'
    );

    const app = await launchElectronApp({ workspace });
    const window = await app.firstWindow();

    try {
      // Wait for sidebar to load
      await window.waitForSelector('.workspace-sidebar', { timeout: 5000 });

      // Click the file to open it
      await window.locator('.file-tree-name', { hasText: 'test.md' }).click();
      await window.waitForTimeout(500);

      const editor = window.locator(ACTIVE_EDITOR_SELECTOR);
      await editor.click();

      // Create a minimal SVG image
      const svgContent = '<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="40" fill="red"/></svg>';
      const svgBlob = new Blob([svgContent], { type: 'image/svg+xml' });

      // Simulate paste event with image data
      await window.evaluate(async (svgData) => {
        const blob = new Blob([svgData], { type: 'image/svg+xml' });
        const file = new File([blob], 'test-image.svg', { type: 'image/svg+xml' });

        // Create a clipboard data transfer
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);

        // Get the editor element
        const editorElement = document.querySelector('.editor [contenteditable="true"]');
        if (!editorElement) throw new Error('Editor not found');

        // Create and dispatch paste event
        const pasteEvent = new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: dataTransfer as any,
        });

        editorElement.dispatchEvent(pasteEvent);
      }, svgContent);

      // Wait a bit for async processing
      await window.waitForTimeout(1000);

      // Check that .preditor/assets directory was created
      const assetsDir = path.join(workspace, '.preditor', 'assets');
      const assetsDirExists = fs.existsSync(assetsDir);
      expect(assetsDirExists).toBe(true);

      // Check that an asset file was created
      if (assetsDirExists) {
        const files = fs.readdirSync(assetsDir);
        expect(files.length).toBeGreaterThan(0);

        // Should be an SVG file with a hash name
        const svgFiles = files.filter(f => f.endsWith('.svg'));
        expect(svgFiles.length).toBe(1);

        console.log('Created asset file:', svgFiles[0]);

        // Verify the file contains our SVG content
        const assetContent = fs.readFileSync(path.join(assetsDir, svgFiles[0]), 'utf-8');
        expect(assetContent).toContain('circle');
        expect(assetContent).toContain('fill="red"');
      }

      // Check that an image was inserted (look for img tag, not just text)
      const hasImage = await window.evaluate(() => {
        const editorElement = document.querySelector('.editor [contenteditable="true"]');
        const images = editorElement?.querySelectorAll('img');
        if (images && images.length > 0) {
          return {
            count: images.length,
            src: images[0].getAttribute('src'),
            html: editorElement?.innerHTML || ''
          };
        }
        return null;
      });

      console.log('Image check:', hasImage);

      expect(hasImage).not.toBeNull();
      expect(hasImage?.count).toBeGreaterThan(0);
      expect(hasImage?.src).toContain('.preditor/assets/');
      expect(hasImage?.src).not.toContain('data:image');

    } finally {
      await app.close();
      await fs.promises.rm(workspace, { recursive: true, force: true });
    }
  });

  test('should deduplicate identical pasted images', async () => {
    const workspace = await createTempWorkspace();

    // Create a test markdown file
    await fs.promises.writeFile(
      path.join(workspace, 'test-dup.md'),
      '# Deduplication Test\n\n',
      'utf8'
    );

    const app = await launchElectronApp({ workspace });
    const window = await app.firstWindow();

    try {
      // Wait for sidebar and open file
      await window.waitForSelector('.workspace-sidebar', { timeout: 5000 });
      await window.locator('.file-tree-name', { hasText: 'test-dup.md' }).click();
      await window.waitForTimeout(500);

      const editor = window.locator(ACTIVE_EDITOR_SELECTOR);
      await editor.click();

      const svgContent = '<svg width="50" height="50"><rect width="50" height="50" fill="blue"/></svg>';

      // Paste the same image twice
      for (let i = 0; i < 2; i++) {
        await window.evaluate(async (svgData) => {
          const blob = new Blob([svgData], { type: 'image/svg+xml' });
          const file = new File([blob], 'duplicate.svg', { type: 'image/svg+xml' });

          const dataTransfer = new DataTransfer();
          dataTransfer.items.add(file);

          const editorElement = document.querySelector('.editor [contenteditable="true"]');
          if (!editorElement) throw new Error('Editor not found');

          const pasteEvent = new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData: dataTransfer as any,
          });

          editorElement.dispatchEvent(pasteEvent);
        }, svgContent);

        await window.waitForTimeout(500);
      }

      // Check that only ONE asset file was created (deduplication)
      const assetsDir = path.join(workspace, '.preditor', 'assets');
      const files = fs.readdirSync(assetsDir);
      const svgFiles = files.filter(f => f.endsWith('.svg'));

      console.log('Asset files after duplicate paste:', svgFiles);
      expect(svgFiles.length).toBe(1); // Should be deduplicated!

    } finally {
      await app.close();
      await fs.promises.rm(workspace, { recursive: true, force: true });
    }
  });
});
