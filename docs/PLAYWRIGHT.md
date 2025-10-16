# Playwright End-to-End Testing

This repository uses [Playwright](https://playwright.dev) for automated end-to-end coverage across the web playground and the Electron desktop shell.

## Installation

```bash
npm install -D @playwright/test
npx playwright install --with-deps
```

> **Tip:** run these commands at the repository root so all workspace projects share the same Playwright binaries.

## Running Tests

- `npm run test:e2e` runs every Playwright project defined in `playwright.config.ts`.
- `npm run test:e2e -- --project=electron` executes only the Electron scenario.
- `npx playwright test e2e/ai/diff-reliability.spec.ts` runs a specific test file.
- `npx playwright test e2e/ai/diff-reliability.spec.ts:55` runs a specific test by line number.

> **Build first:** make sure `npm run build --workspace @preditor/electron` has been executed so `packages/electron/out/main/index.js` exists before launching the Electron project.

Artifacts (traces, screenshots, videos) are captured on the first retry or failure and saved under `playwright-report/`.

## Test File Organization

Tests are organized by feature area under `packages/electron/e2e/`:

- `e2e/ai/` - AI-related tests (diff reliability, file mentions, etc.)
- `e2e/core/` - Core app functionality (window restore, workspace tabs, etc.)
- `e2e/files/` - File operations (manual save, autosave, file watching, etc.)
- `e2e/tabs/` - Tab management (reordering, autosave navigation, etc.)
- `e2e/theme/` - Theme switching tests
- `e2e/plugins/` - Plugin-specific tests

## Writing Tests

### Test Setup Best Practices

**CRITICAL: Always create test files BEFORE launching the app!** Tests will fail if files are created after the app starts because the file tree won't be populated.

```typescript
test.beforeEach(async () => {
  workspaceDir = await createTempWorkspace();
  testFilePath = path.join(workspaceDir, 'test.md');

  // ALWAYS create files BEFORE launching the app
  await fs.writeFile(testFilePath, '# Test\n\nInitial content.\n', 'utf8');

  // NOW launch the app with the workspace
  electronApp = await launchElectronApp({ workspace: workspaceDir });
  page = await electronApp.firstWindow();
  await waitForAppReady(page);
});
```

### Workspace Setup Pattern

```typescript
import {
  launchElectronApp,
  createTempWorkspace,
  waitForAppReady,
  TEST_TIMEOUTS
} from '../helpers';
import * as fs from 'fs/promises';
import * as path from 'path';

let electronApp: ElectronApplication;
let page: Page;
let workspaceDir: string;
let testFilePath: string;

test.beforeEach(async () => {
  // 1. Create temporary workspace directory
  workspaceDir = await createTempWorkspace();
  testFilePath = path.join(workspaceDir, 'test.md');

  // 2. Create test files BEFORE launching app
  await fs.writeFile(testFilePath, 'Initial content', 'utf8');

  // 3. Launch Electron app with workspace
  electronApp = await launchElectronApp({ workspace: workspaceDir });

  // 4. Get the first window and wait for app to be ready
  page = await electronApp.firstWindow();
  await waitForAppReady(page);
});

test.afterEach(async () => {
  // Clean up: close app and remove temp files
  await electronApp.close();
  await fs.rm(workspaceDir, { recursive: true, force: true });
});
```

### Opening Files in Tests

After the app is ready, open files using the file tree:

```typescript
// Click file in file tree using locator
await page.locator('.file-tree-name', { hasText: 'test.md' }).click();

// Wait for tab to become active
await expect(page.locator('.tab.active .tab-title'))
  .toContainText('test.md', { timeout: TEST_TIMEOUTS.TAB_SWITCH });

// Wait for editor to be ready
await waitForEditorReady(page);
```

### Saving Files in Tests

**Use manual save utilities instead of waiting for autosave:**

```typescript
import { triggerManualSave, waitForSave } from '../utils/aiToolSimulator';

// After making changes to the editor...

// Trigger manual save via IPC (simulates Cmd+S)
await triggerManualSave(electronApp);

// Wait for save to complete (dirty indicator disappears)
await waitForSave(page, 'test.md');

// Now verify content on disk
const diskContent = await fs.readFile(testFilePath, 'utf8');
expect(diskContent).toContain('expected text');
```

**Why not use keyboard shortcuts?** Using `page.keyboard.press('Meta+s')` simulates browser keyboard events, which don't trigger Electron menu actions. Always use `triggerManualSave()` to properly simulate Cmd+S.

## IPC Communication in Tests

The Electron app uses IPC (Inter-Process Communication) between main and renderer processes. Understanding this is crucial for writing reliable tests.

### How IPC Works

1. **Main Process** (Node.js) handles file operations, window management, etc.
2. **Renderer Process** (Browser/React) handles UI
3. **IPC Bridge** (`window.electronAPI`) connects them

### Key IPC Events

#### File Operations

```typescript
// Save file (triggered by Cmd+S menu)
// Main process sends 'file-save' event to renderer
window.electronAPI.on('file-save', handleSave);

// To simulate in tests:
await electronApp.evaluate(({ BrowserWindow }) => {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused) {
    focused.webContents.send('file-save');
  }
});
```

#### Document Operations

```typescript
// Open file
const result = await window.electronAPI.openFile();

// Save file as
const result = await window.electronAPI.saveFileAs(content);

// Create file
await window.electronAPI.createFile(filePath, content);

// Get folder contents
const tree = await window.electronAPI.getFolderContents(workspacePath);
```

#### Editor Registry

The EditorRegistry is exposed on `window` for test access:

```typescript
// Tests can access the editor registry directly
const editorRegistry = (window as any).__editorRegistry;

// Apply diff replacements
await editorRegistry.applyReplacements(filePath, [
  { oldText: 'foo', newText: 'bar' }
]);

// Get content
const content = editorRegistry.getContent(filePath);

// Stream content
editorRegistry.startStreaming(filePath, config);
editorRegistry.streamContent(filePath, streamId, chunk);
editorRegistry.endStreaming(filePath, streamId);
```

### AI Tool Simulator

For testing AI operations without actual AI calls, use the AI Tool Simulator utilities:

```typescript
import {
  simulateApplyDiff,
  simulateStreamContent,
  triggerManualSave,
  waitForSave,
  waitForEditorReady
} from '../utils/aiToolSimulator';

// Simulate applying a diff (text replacement)
const result = await simulateApplyDiff(page, testFilePath, [
  { oldText: 'hello', newText: 'world' }
]);

// After AI edits, accept the changes
await page.click('button:has-text("Accept All")');
await page.waitForTimeout(200);

// Save the changes
await triggerManualSave(electronApp);
await waitForSave(page, 'test.md');
```

## Environment Variables for Testing

```typescript
const testEnv = {
  ANTHROPIC_API_KEY: 'playwright-test-key', // Dummy key for tests
  ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
  ELECTRON_RENDERER_URL: 'http://localhost:5273', // Dev server for HMR
  PLAYWRIGHT: '1', // Skips session restoration by default
};

// To enable session restoration in tests:
electronApp = await launchElectronApp({
  workspace: workspaceDir,
  env: { ENABLE_SESSION_RESTORE: '1' }
});
```

## Common Test Patterns

### Testing File Changes

```typescript
test('should detect external file changes', async () => {
  // Open file
  await page.locator('.file-tree-name', { hasText: 'test.md' }).click();
  await waitForEditorReady(page);

  // Modify file externally
  await fs.writeFile(testFilePath, 'New content', 'utf8');

  // App should detect the change (file watcher)
  await page.waitForTimeout(500);

  // Verify editor updated
  const content = await page.evaluate(() => {
    const editor = document.querySelector('.editor');
    return editor?.textContent || '';
  });
  expect(content).toContain('New content');
});
```

### Testing Diff Operations

```typescript
test('should apply diff correctly', async () => {
  // Set up initial content
  const content = '# Title\n\nOriginal text.\n';
  await fs.writeFile(testFilePath, content, 'utf8');

  // Open file
  await page.locator('.file-tree-name', { hasText: 'test.md' }).click();
  await waitForEditorReady(page);

  // Apply diff
  const result = await simulateApplyDiff(page, testFilePath, [
    { oldText: 'Original text', newText: 'Modified text' }
  ]);

  expect(result.success).toBe(true);

  // Accept changes
  await page.click('button:has-text("Accept All")');
  await page.waitForTimeout(200);

  // Save
  await triggerManualSave(electronApp);
  await waitForSave(page, 'test.md');

  // Verify on disk
  const updatedContent = await fs.readFile(testFilePath, 'utf8');
  expect(updatedContent).toContain('Modified text');
});
```

### Testing Streaming Content

```typescript
test('should stream content correctly', async () => {
  await fs.writeFile(testFilePath, '# Document\n', 'utf8');

  await page.locator('.file-tree-name', { hasText: 'test.md' }).click();
  await waitForEditorReady(page);

  // Stream content to end of document
  await simulateStreamContent(page, '\n- Item 1\n- Item 2', {
    insertAtEnd: true
  });

  // Save
  await triggerManualSave(electronApp);
  await waitForSave(page, 'test.md');

  const content = await fs.readFile(testFilePath, 'utf8');
  expect(content).toContain('Item 1');
  expect(content).toContain('Item 2');
});
```

## Test Utilities Reference

### Helper Functions

```typescript
// From e2e/helpers.ts

// Launch Electron app with options
launchElectronApp(options?: { workspace?: string; env?: Record<string, string> })

// Create temporary workspace directory
createTempWorkspace(): Promise<string>

// Wait for app to be ready (sidebar loaded)
waitForAppReady(page: Page): Promise<void>

// Wait for editor to be ready (contenteditable visible)
waitForEditor(page: Page): Promise<void>

// Get keyboard shortcut for current platform
getKeyboardShortcut(key: string): string
```

### AI Tool Simulator Functions

```typescript
// From e2e/utils/aiToolSimulator.ts

// Apply diff replacements
simulateApplyDiff(page, filePath, replacements): Promise<{ success: boolean }>

// Stream content to document
simulateStreamContent(page, content, config?): Promise<void>

// Get document content
simulateGetDocumentContent(page, filePath?): Promise<string>

// Trigger manual save (Cmd+S)
triggerManualSave(electronApp): Promise<void>

// Wait for file to be saved
waitForSave(page, fileName?, timeout?): Promise<void>

// Wait for editor to be ready
waitForEditorReady(page, timeout?): Promise<void>

// Verify text exists in editor
verifyEditorContains(page, text, shouldExist?): Promise<boolean>
```

## Timeouts

Standard timeouts are defined in `e2e/helpers.ts`:

```typescript
export const TEST_TIMEOUTS = {
  APP_LAUNCH: 5000,       // App should launch quickly
  SIDEBAR_LOAD: 5000,     // Sidebar should appear fast
  FILE_TREE_LOAD: 5000,   // File tree items should load fast
  TAB_SWITCH: 3000,       // Tab switching is instant
  EDITOR_LOAD: 3000,      // Editor loads quickly
  SAVE_OPERATION: 2000,   // Saves are fast
  DEFAULT_WAIT: 500,      // Standard wait between operations
};
```

## Selectors Reference

Common CSS selectors used in tests:

```typescript
// Editor
'.multi-editor-instance.active .editor [contenteditable="true"]'
'.editor [contenteditable="true"]'

// Tabs
'.tab.active'
'.tab-title'
'.tab-dirty-indicator'  // Dot showing unsaved changes

// File Tree
'.file-tree-name'
'.workspace-sidebar'

// Buttons
'button:has-text("Accept All")'
'button:has-text("Reject All")'
```

## Debugging Tests

### Run with UI

```bash
npx playwright test --ui
npx playwright test e2e/ai/diff-reliability.spec.ts --ui
```

### Run in headed mode

```bash
npx playwright test --headed
```

### Debug specific test

```bash
npx playwright test e2e/ai/diff-reliability.spec.ts:55 --headed --debug
```

### View test report

```bash
npx playwright show-report
```

### Enable verbose logging

Tests include console.log statements for debugging. Check the test output or use:

```bash
npx playwright test --reporter=line
```

## Conventions

- Electron specs live under `packages/electron/e2e/` and use TypeScript (`.ts`) extension.
- Keep specs self-cleaning: temporary files and launched apps must be disposed in `test.afterEach()`.
- Prefer Playwright locators over raw selectors to benefit from auto-waiting and improved error messages.
- Always create test files BEFORE launching the app to ensure file tree is populated.
- Use manual save utilities (`triggerManualSave`, `waitForSave`) instead of keyboard shortcuts or autosave waits.
- Use AI Tool Simulator utilities for testing AI features without actual API calls.

## Common Pitfalls

1. **Creating files after app launch** - File tree won't update. Always create files before `launchElectronApp()`.
2. **Using keyboard shortcuts for save** - `page.keyboard.press('Meta+s')` doesn't trigger Electron menus. Use `triggerManualSave()`.
3. **Waiting for autosave** - Slow and unreliable. Use manual save instead.
4. **Importing EditorRegistry dynamically** - Use `window.__editorRegistry` instead of dynamic imports.
5. **Not waiting for editor ready** - Always call `waitForEditorReady()` after opening a file.
6. **Forgetting to accept diffs** - After applying diffs, click "Accept All" before saving.

## Future Work

- Add smoke test for the web playground once the existing Playwright setup is extended with a web project.
- Capture additional regression scenarios such as AI interactions with multiple files and complex markdown structures.
- Add tests for collaborative editing features when implemented.
- Expand theme switching tests to cover all theme variants.
