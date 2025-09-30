# AI Editor Integration Tests

This directory contains end-to-end tests for AI-assisted editing features. These tests verify that AI models can correctly perform various editing operations in the editor.

## Overview

The tests use Playwright to launch the Electron app, interact with the AI Chat interface, and verify that the AI correctly applies changes to documents. This approach is inspired by the diff unit tests, but operates at the E2E level with real AI models.

## Test Structure

### `ai-list-editing.spec.ts`

Tests for AI-assisted list operations:
- **Adding items**: Add items to the end or at specific positions
- **Removing items**: Remove specific items from lists
- **Editing items**: Modify existing list item text
- **Batch operations**: Add multiple items at once

Uses **GPT-4 Turbo** for reliable, consistent results.

## Running the Tests

### Prerequisites

1. The `OPENAI_API_KEY` is loaded from the `.env` file in `packages/electron/.env`
   - The key should already be configured in the `.env` file
   - If not, add it: `OPENAI_API_KEY=your-key-here`

2. Build the Electron app:
   ```bash
   npm run build
   ```

### Run All AI Tests

```bash
npm run test:e2e -- ai/
```

### Run Specific Test File

```bash
npm run test:e2e -- ai/ai-list-editing.spec.ts
```

### Run in UI Mode (for debugging)

```bash
npm run test:e2e -- --ui ai/ai-list-editing.spec.ts
```

## Writing New Tests

### Basic Structure

```typescript
import { test, expect } from '@playwright/test';
import {
  launchElectronApp,
  createTempWorkspace,
  configureAIModel,
  sendAIPrompt,
  getEditorContent
} from '../helpers';

test.describe('Your Test Suite', () => {
  let electronApp: ElectronApplication;
  let page: Page;
  let workspaceDir: string;

  test.beforeEach(async () => {
    // Skip if no API key
    if (!process.env.OPENAI_API_KEY) {
      test.skip();
    }

    // Create workspace and launch app
    workspaceDir = await createTempWorkspace();
    electronApp = await launchElectronApp({
      workspace: workspaceDir,
      env: { OPENAI_API_KEY: process.env.OPENAI_API_KEY }
    });

    page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    // Configure AI model
    await configureAIModel(page, 'openai', 'gpt-4-turbo');
  });

  test('should do something', async () => {
    // Send prompt to AI
    await sendAIPrompt(page, 'Your prompt here');

    // Verify results
    const content = await getEditorContent(page);
    expect(content).toContain('expected text');
  });
});
```

### Helper Functions

#### `configureAIModel(page, provider, model)`
Configures which AI model to use for the test session.

**Example:**
```typescript
await configureAIModel(page, 'openai', 'gpt-4-turbo');
await configureAIModel(page, 'claude', 'claude-sonnet-4');
```

#### `sendAIPrompt(page, prompt, options?)`
Sends a prompt to the AI and waits for the response.

**Options:**
- `waitForCompletion`: Whether to wait for the response (default: true)
- `timeout`: Maximum time to wait in ms (default: 30000)

**Example:**
```typescript
await sendAIPrompt(page, 'Add a heading to the document');
await sendAIPrompt(page, 'Add a table', { timeout: 60000 });
```

#### `getEditorContent(page)`
Gets the current content from the editor.

**Example:**
```typescript
const content = await getEditorContent(page);
expect(content).toContain('expected text');
```

## Test Design Philosophy

### Start Simple

Begin with straightforward operations:
- Single, clear actions (add one item, remove one item)
- Simple document structures
- Explicit instructions

### Build Up Complexity

Gradually add more complex scenarios:
- Multiple operations in sequence
- Complex document structures
- Ambiguous instructions
- Edge cases

### Verify Specific Behaviors

Each test should verify a specific capability:
- ✅ Good: "should add item at specific position"
- ❌ Too broad: "should handle all list operations"

### Use Clear Prompts

Make prompts explicit and unambiguous:
- ✅ Good: "Add 'Grapes' to the end of the shopping list"
- ❌ Ambiguous: "Add some fruit"

## Future Test Areas

### Other Node Types
- **Headings**: Add, remove, change levels
- **Tables**: Add rows/columns, edit cells, delete
- **Code blocks**: Change language, modify content
- **Blockquotes**: Add, nest, remove
- **Links**: Create, modify URL/text, remove

### Complex Operations
- **Multi-step edits**: Combine multiple operations
- **Nested structures**: Lists within lists, tables in quotes
- **Format changes**: Bold, italic, inline code
- **Document restructuring**: Move sections, reorder content

### Error Handling
- **Invalid operations**: Test graceful failures
- **Ambiguous prompts**: How AI handles unclear instructions
- **Conflicting changes**: Multiple operations on same content

## Debugging Tips

### Take Screenshots

```typescript
await page.screenshot({ path: 'debug.png', fullPage: true });
```

### Inspect AI Responses

Check the console logs to see AI's reasoning and tool calls.

### Use Headed Mode

Run with `--headed` to watch the test execute:
```bash
npm run test:e2e -- --headed ai/ai-list-editing.spec.ts
```

### Check File Contents

Read the file directly to see exactly what was saved:
```typescript
const content = await fs.readFile(testFilePath, 'utf8');
console.log('File content:', content);
```

## Troubleshooting

### Tests Skip

**Problem**: Tests are skipped
**Solution**: Ensure `OPENAI_API_KEY` is set in `.env` file (should already be configured)

### Timeouts

**Problem**: Tests timeout waiting for AI
**Solution**: Increase timeout in `sendAIPrompt` options or check API connectivity

### Content Not Saved

**Problem**: Changes aren't persisted to disk
**Solution**: Add longer wait time after `sendAIPrompt` to allow for autosave

### Wrong Model Used

**Problem**: Tests use wrong AI model
**Solution**: Ensure `configureAIModel` is called in `beforeEach`
