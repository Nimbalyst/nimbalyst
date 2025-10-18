/**
 * Debug test for file mention typeahead
 * This test will help identify why the typeahead menu isn't appearing
 */

import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import {
  launchElectronApp,
  createTempWorkspace,
  TEST_TIMEOUTS
} from '../helpers';
import * as fs from 'fs';
import * as path from 'path';

test.describe('AI File Mention Typeahead Debug', () => {
  let electronApp: ElectronApplication;
  let page: Page;
  let workspaceDir: string;

  test.beforeEach(async () => {
    // Create temporary workspace with test files
    workspaceDir = await createTempWorkspace();

    // Create several test files
    const files = [
      { name: 'test-file-1.md', content: '# Test File 1\n\nContent here.' },
      { name: 'test-file-2.md', content: '# Test File 2\n\nMore content.' },
      { name: 'readme.md', content: '# README\n\nProject docs.' }
    ];

    for (const file of files) {
      fs.writeFileSync(path.join(workspaceDir, file.name), file.content);
    }

    // Launch app with workspace
    electronApp = await launchElectronApp({ workspace: workspaceDir });
    page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('.workspace-sidebar', { timeout: TEST_TIMEOUTS.SIDEBAR_LOAD });
  });

  test.afterEach(async () => {
    await electronApp.close();
  });

  test('debug: check document service returns files', async () => {
    // Check if DocumentService has files
    const docs = await page.evaluate(async () => {
      return await (window as any).electronAPI.invoke('document-service:list');
    });

    console.log('Documents from service:', docs);
    expect(docs).toBeDefined();
    expect(Array.isArray(docs)).toBe(true);
    expect(docs.length).toBeGreaterThan(0);
  });

  test('debug: check AI chat input exists and can be interacted with', async () => {
    // Open a file first (AI Chat needs a document context)
    await page.click('text=test-file-1.md');
    await page.waitForTimeout(500);

    // Open AI Chat panel
    await page.keyboard.press('Meta+Shift+A');
    await page.waitForTimeout(1000);

    // Check if AI chat panel is visible
    const aiChatPanel = page.locator('[data-testid="ai-chat-panel"]');
    const isVisible = await aiChatPanel.isVisible().catch(() => false);
    console.log('AI Chat panel visible:', isVisible);

    if (!isVisible) {
      // Try alternative selector
      const altPanel = page.locator('.ai-chat-container, .ai-chat-panel');
      const altVisible = await altPanel.isVisible().catch(() => false);
      console.log('Alternative AI Chat selector visible:', altVisible);
    }

    // Look for the input field
    const chatInput = page.locator('.ai-chat-input-field, textarea[placeholder*="Ask"]').first();
    await chatInput.waitFor({ state: 'visible', timeout: 5000 });

    const inputVisible = await chatInput.isVisible();
    console.log('Chat input visible:', inputVisible);
    expect(inputVisible).toBe(true);

    // Check if input is enabled
    const isDisabled = await chatInput.isDisabled();
    console.log('Chat input disabled:', isDisabled);

    // If disabled, we need to create a session first
    if (isDisabled) {
      console.log('Input is disabled - need to create a session');

      // Use the correct selector for the new session button
      const newSessionBtn = page.locator('.new-session-button-main');
      const btnVisible = await newSessionBtn.isVisible().catch(() => false);
      console.log('New session button visible:', btnVisible);

      if (btnVisible) {
        await newSessionBtn.click();
        await page.waitForTimeout(1000);

        // Check if input is now enabled
        const stillDisabled = await chatInput.isDisabled();
        console.log('Input still disabled after creating session:', stillDisabled);
      }
    }
  });

  test('debug: type @ and capture all console logs', async () => {
    // Capture all console messages
    const consoleLogs: string[] = [];
    page.on('console', msg => {
      const text = msg.text();
      consoleLogs.push(`[${msg.type()}] ${text}`);
    });

    // Open a file
    await page.click('text=test-file-1.md');
    await page.waitForTimeout(500);

    // Open AI Chat
    await page.keyboard.press('Meta+Shift+A');
    await page.waitForTimeout(1000);

    // Find and focus the input
    const chatInput = page.locator('.ai-chat-input-field, textarea[placeholder*="Ask"]').first();
    await chatInput.waitFor({ state: 'visible', timeout: 5000 });

    // Check if we need to create a session
    const isDisabled = await chatInput.isDisabled();
    if (isDisabled) {
      console.log('Input is disabled - need to create a session');

      // Check for empty state (no API key configured)
      const emptyState = page.locator('.ai-chat-empty-state');
      const hasEmptyState = await emptyState.isVisible().catch(() => false);

      if (hasEmptyState) {
        console.log('ERROR: No AI provider configured - cannot test file mention typeahead');
        console.log('Please configure an AI provider in settings before running this test');
        await page.screenshot({ path: 'test-results/no-provider-configured.png', fullPage: true });
        // Skip the rest of the test
        return;
      }

      const newSessionBtn = page.locator('.new-session-button-main');
      const btnExists = await newSessionBtn.isVisible().catch(() => false);
      console.log('New session button found:', btnExists);

      if (btnExists) {
        await newSessionBtn.click();
        await page.waitForTimeout(2000); // Wait longer for session creation

        // Verify input is now enabled
        const stillDisabled = await chatInput.isDisabled();
        console.log('Input still disabled after creating session:', stillDisabled);

        if (stillDisabled) {
          console.log('WARNING: Input is still disabled after creating session');
          console.log('This likely means no AI model is configured. Check current model value.');

          // Get the placeholder text to see what it says
          const placeholder = await chatInput.getAttribute('placeholder');
          console.log('Input placeholder:', placeholder);

          await page.screenshot({ path: 'test-results/session-not-created.png', fullPage: true });
          return;
        }
      } else {
        console.log('ERROR: Could not find new session button with selector .new-session-button-main');
        await page.screenshot({ path: 'test-results/no-session-button.png', fullPage: true });
        return;
      }
    }

    // Clear previous logs
    consoleLogs.length = 0;

    // Type "@"
    await chatInput.click();
    await chatInput.type('@', { delay: 100 });
    await page.waitForTimeout(1000);

    // Print all console logs
    console.log('\n=== CONSOLE LOGS AFTER TYPING @ ===');
    consoleLogs.forEach(log => console.log(log));
    console.log('=== END CONSOLE LOGS ===\n');

    // Check for useFileMention logs
    const hasDocLoadLog = consoleLogs.some(log => log.includes('[useFileMention] Loading documents'));
    const hasDocCountLog = consoleLogs.some(log => log.includes('[useFileMention] Loaded documents'));
    const hasOptionsLog = consoleLogs.some(log => log.includes('[useFileMention] Generated options'));
    const hasTriggerLog = consoleLogs.some(log => log.includes('[ChatInput] Typeahead trigger check'));

    console.log('Debug checks:');
    console.log('  - Documents loading:', hasDocLoadLog);
    console.log('  - Documents loaded:', hasDocCountLog);
    console.log('  - Options generated:', hasOptionsLog);
    console.log('  - Trigger detected:', hasTriggerLog);

    // Check if typeahead element exists in DOM
    const typeaheadExists = await page.locator('.generic-typeahead').count();
    console.log('Typeahead elements in DOM:', typeaheadExists);

    // Check if any elements have the typeahead class
    const allTypeaheadClasses = await page.evaluate(() => {
      const elements = document.querySelectorAll('[class*="typeahead"]');
      return Array.from(elements).map(el => ({
        class: el.className,
        visible: (el as HTMLElement).offsetParent !== null
      }));
    });
    console.log('All typeahead-related elements:', allTypeaheadClasses);

    // Get the actual input value
    const inputValue = await chatInput.inputValue();
    console.log('Input value:', inputValue);

    // Check React component state if possible
    const componentState = await page.evaluate(() => {
      const input = document.querySelector('.ai-chat-input-field') as any;
      if (input && input._reactProps) {
        return {
          hasFileMentionOptions: !!input._reactProps.fileMentionOptions,
          optionsLength: input._reactProps.fileMentionOptions?.length,
          hasOnFileMentionSearch: !!input._reactProps.onFileMentionSearch
        };
      }
      return null;
    });
    console.log('React component state:', componentState);

    // Take a screenshot for visual debugging
    await page.screenshot({ path: 'test-results/file-mention-debug.png', fullPage: true });
    console.log('Screenshot saved to test-results/file-mention-debug.png');
  });

  test('debug: check if AIChat is passing props to ChatInput', async () => {
    // Open a file
    await page.click('text=test-file-1.md');
    await page.waitForTimeout(500);

    // Open AI Chat
    await page.keyboard.press('Meta+Shift+A');
    await page.waitForTimeout(1000);

    // Inject a script to inspect the ChatInput props
    const inputProps = await page.evaluate(() => {
      // Try to find the ChatInput component in React's fiber tree
      const input = document.querySelector('.ai-chat-input-field');
      if (!input) return { error: 'Input element not found' };

      // Try to access React internals (this is hacky but useful for debugging)
      const reactKey = Object.keys(input).find(key => key.startsWith('__reactFiber'));
      if (!reactKey) return { error: 'React fiber not found' };

      const fiber = (input as any)[reactKey];
      if (!fiber) return { error: 'Fiber is null' };

      // Walk up to find ChatInput component
      let current = fiber;
      let depth = 0;
      while (current && depth < 20) {
        if (current.memoizedProps) {
          const props = current.memoizedProps;
          if (props.fileMentionOptions !== undefined) {
            return {
              hasFileMentionOptions: true,
              optionsCount: props.fileMentionOptions?.length || 0,
              hasOnFileMentionSearch: typeof props.onFileMentionSearch === 'function',
              hasOnFileMentionSelect: typeof props.onFileMentionSelect === 'function',
              placeholder: props.placeholder
            };
          }
        }
        current = current.return;
        depth++;
      }

      return { error: 'Could not find props with fileMentionOptions' };
    });

    console.log('ChatInput props inspection:', inputProps);
  });
});
