import { test, expect, ElectronApplication, Page } from '@playwright/test';
import { launchElectronApp, createTempWorkspace, waitForAppReady, TEST_TIMEOUTS } from '../helpers';
import { openFileFromTree, PLAYWRIGHT_TEST_SELECTORS } from '../utils/testHelpers';
import * as fs from 'fs/promises';
import * as path from 'path';

test.describe('Lexical list styling', () => {
  let electronApp: ElectronApplication;
  let page: Page;
  let workspaceDir: string;

  test.beforeEach(async () => {
    workspaceDir = await createTempWorkspace();

    // Create a markdown file with a bulleted list
    await fs.writeFile(
      path.join(workspaceDir, 'list-test.md'),
      '# List Test\n\n- Apple\n- Banana\n- Cherry\n',
      'utf8'
    );

    electronApp = await launchElectronApp({ workspace: workspaceDir, permissionMode: 'allow-all' });
    page = await electronApp.firstWindow();
    await waitForAppReady(page);
  });

  test.afterEach(async () => {
    await electronApp?.close();
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  test('bulleted list should render with nim-ul class and visible bullet markers', async () => {
    await openFileFromTree(page, 'list-test.md');

    // Wait for the editor to load
    const editor = page.locator(PLAYWRIGHT_TEST_SELECTORS.contentEditable).first();
    await expect(editor).toBeVisible({ timeout: TEST_TIMEOUTS.EDITOR_LOAD });

    // Check what class names the <ul> element actually has
    const ulInfo = await page.evaluate(() => {
      const uls = document.querySelectorAll('ul');
      return Array.from(uls).map(ul => ({
        className: ul.className,
        computedListStyle: window.getComputedStyle(ul).listStyleType,
        computedListStylePosition: window.getComputedStyle(ul).listStylePosition,
        childCount: ul.children.length,
        innerHTML: ul.innerHTML.substring(0, 200),
      }));
    });

    console.log('UL elements found:', JSON.stringify(ulInfo, null, 2));

    // Find the Lexical ul (should have nim-ul class)
    const lexicalUl = ulInfo.find(ul =>
      ul.className.includes('nim-ul') || ul.className.includes('PlaygroundEditorTheme__ul')
    );

    // Verify the nim-ul class is applied (not the old PlaygroundEditorTheme__ class)
    expect(lexicalUl, 'Should find a <ul> with nim-ul or PlaygroundEditorTheme__ul class').toBeTruthy();
    expect(lexicalUl!.className).toContain('nim-ul');
    expect(lexicalUl!.className).not.toContain('PlaygroundEditorTheme__ul');

    // Verify computed list-style-type is disc (not none)
    expect(lexicalUl!.computedListStyle).toBe('disc');

    // Check list items have nim-list-item class and proper styling
    const liInfo = await page.evaluate(() => {
      const editorEl = document.querySelector('[contenteditable="true"]');
      if (!editorEl) return [];
      const lis = editorEl.querySelectorAll('li');
      return Array.from(lis).map(li => {
        const styles = window.getComputedStyle(li);
        const markerStyles = window.getComputedStyle(li, '::marker');
        return {
          className: li.className,
          textContent: li.textContent?.trim(),
          computedDisplay: styles.display,
          computedMargin: styles.margin,
          computedPadding: styles.padding,
          computedLineHeight: styles.lineHeight,
          markerContent: markerStyles.content,
          markerColor: markerStyles.color,
          markerFontSize: markerStyles.fontSize,
          // Check list-item display (needed for bullets to show)
          listStyleType: styles.listStyleType,
        };
      });
    });

    console.log('LI elements found:', JSON.stringify(liInfo, null, 2));

    expect(liInfo.length).toBeGreaterThanOrEqual(3);
    // Verify they use nim- classes
    for (const li of liInfo) {
      expect(li.className).toContain('nim-list-item');
    }

    // Check what CSS rules apply display:flex to the list items
    const flexSource = await page.evaluate(() => {
      const li = document.querySelector('.nim-list-item');
      if (!li) return 'no li found';

      const inlineStyle = (li as HTMLElement).style.cssText;

      const sheets = document.styleSheets;
      const matchingRules: string[] = [];
      for (let s = 0; s < sheets.length; s++) {
        try {
          const rules = sheets[s].cssRules;
          for (let r = 0; r < rules.length; r++) {
            const rule = rules[r] as CSSStyleRule;
            if (rule.selectorText && li.matches(rule.selectorText)) {
              if (rule.style.display || rule.style.padding) {
                matchingRules.push(`${rule.selectorText} { display: ${rule.style.display || 'unset'}, padding: ${rule.style.padding || 'unset'} }`);
              }
            }
          }
        } catch (e) {
          // Cross-origin stylesheet
        }
      }

      return { inlineStyle, matchingRules };
    });

    console.log('Flex source analysis:', JSON.stringify(flexSource, null, 2));

    // The critical assertion: list items must NOT have display:flex
    // display:flex suppresses ::marker pseudo-elements, hiding bullets
    for (const li of liInfo) {
      expect(li.computedDisplay, `List item "${li.textContent}" should not have display:flex`).not.toBe('flex');
    }

    // Take a screenshot for visual verification
    await page.screenshot({ path: 'e2e-screenshots/list-styling.png' })
  });
});
