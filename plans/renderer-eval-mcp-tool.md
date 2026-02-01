---
planStatus:
  planId: plan-renderer-eval-mcp-tool
  title: Renderer Console Eval MCP Tool
  status: draft
  planType: feature
  priority: medium
  owner: ghinkle
  stakeholders: []
  tags:
    - extension-dev-kit
    - mcp
    - developer-tools
  created: "2026-01-31"
  updated: "2026-01-31T00:00:00.000Z"
  progress: 0
---
# Renderer Console Eval MCP Tool

## Overview

Add an MCP tool to the extension-dev-kit that allows executing JavaScript in the Nimbalyst renderer context. This enables the AI agent to:
- Inspect computed styles (e.g., `getComputedStyle(document.documentElement).getPropertyValue('--nim-text')`)
- Query the DOM state
- Debug extension rendering issues
- Verify UI state after making changes

## Use Cases

1. **Style verification**: Check if CSS variables are correctly applied
2. **DOM inspection**: Query elements to verify structure
3. **Extension debugging**: Run diagnostics on custom editors
4. **State inspection**: Access global state for debugging (where exposed)

## Architecture

The tool will follow the same pattern as `extension_get_status`:

1. **MCP Server (main process)**: `packages/electron/src/main/mcp/extensionDevServer.ts`
  - Define the `renderer_eval` tool
  - Send IPC message to the correct renderer window (using workspacePath routing)
  - Wait for response with timeout

2. **Preload**: Uses existing generic `on`/`send` methods (lines 927-958 in preload)

3. **Renderer listener**: `packages/electron/src/renderer/plugins/registerExtensionSystem.ts`
  - Listen for `renderer:eval` IPC messages
  - Execute the JavaScript code in a sandboxed manner
  - Return result or error

## Security Considerations

This tool should ONLY be available in development mode for several reasons:

1. **Arbitrary code execution**: Allows running any JavaScript in renderer
2. **Security risk in production**: Could be exploited to access sensitive data
3. **Developer tool only**: Only useful for development/debugging workflows

### Safeguards

1. **Dev mode only**: Check `process.env.NODE_ENV === 'development'` before executing
2. **Timeout**: Maximum execution time (e.g., 5 seconds)
3. **Result size limit**: Truncate large results to prevent memory issues
4. **Error handling**: Catch and report all errors safely
5. **No access to privileged APIs**: Execute in a limited scope

## Implementation Details

### Tool Definition (extensionDevServer.ts)

```typescript
{
  name: 'renderer_eval',
  description: 'Execute JavaScript in the Nimbalyst renderer context. Only available in development mode. Useful for debugging, inspecting DOM state, and checking computed styles.',
  inputSchema: {
    type: 'object',
    properties: {
      expression: {
        type: 'string',
        description: 'JavaScript expression to evaluate. Supports async/await. Return values will be serialized. Examples: "document.querySelector(\'.my-class\').textContent", "getComputedStyle(document.documentElement).getPropertyValue(\'--nim-text\')", "await fetch(\'/api/status\').then(r => r.json())"'
      },
      timeout: {
        type: 'number',
        description: 'Maximum execution time in milliseconds (default: 5000, max: 30000)'
      }
    },
    required: ['expression']
  }
}
```

### Tool Handler (extensionDevServer.ts)

```typescript
case 'renderer_eval': {
  // Check dev mode
  const isDev = process.env.NODE_ENV === 'development' || !!process.env.ELECTRON_RENDERER_URL;
  if (!isDev) {
    return {
      content: [{ type: 'text', text: 'Error: renderer_eval is only available in development mode.' }],
      isError: true
    };
  }

  const expression = args?.expression as string;
  if (!expression) {
    return {
      content: [{ type: 'text', text: 'Error: expression is required' }],
      isError: true
    };
  }

  // Validate timeout
  let timeout = (args?.timeout as number) || 5000;
  timeout = Math.min(Math.max(100, timeout), 30000);

  // Require workspace path for routing
  if (!workspacePath) {
    return {
      content: [{ type: 'text', text: 'Error: workspacePath is required to route to the correct window' }],
      isError: true
    };
  }

  // Find the target window
  const targetWindow = findWindowByWorkspace(workspacePath);
  if (!targetWindow || targetWindow.isDestroyed()) {
    return {
      content: [{ type: 'text', text: `Error: No window found for workspace: ${workspacePath}` }],
      isError: true
    };
  }

  // Execute in renderer
  return new Promise((resolve) => {
    const responseChannel = `renderer-eval-response-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const timeoutId = setTimeout(() => {
      resolve({
        content: [{ type: 'text', text: `Error: Evaluation timed out after ${timeout}ms` }],
        isError: true
      });
    }, timeout);

    const { ipcMain } = require('electron');
    ipcMain.once(responseChannel, (_event: any, result: any) => {
      clearTimeout(timeoutId);

      if (result.error) {
        resolve({
          content: [{ type: 'text', text: `Error: ${result.error}\n${result.stack || ''}` }],
          isError: true
        });
        return;
      }

      resolve({
        content: [{ type: 'text', text: `Result:\n${result.value}` }],
        isError: false
      });
    });

    targetWindow.webContents.send('renderer:eval', {
      expression,
      responseChannel
    });
  });
}
```

### Renderer Listener (registerExtensionSystem.ts)

Add a new setup function similar to `setupExtensionStatusListener`:

```typescript
let rendererEvalListenerSetup = false;

/**
 * Serialize a value for returning to the MCP tool.
 * Handles special types like DOM elements, functions, etc.
 */
function serializeEvalResult(result: unknown): string {
  try {
    if (result === undefined) {
      return 'undefined';
    } else if (result === null) {
      return 'null';
    } else if (typeof result === 'function') {
      return `[Function: ${result.name || 'anonymous'}]`;
    } else if (result instanceof Element) {
      const html = result.outerHTML;
      return html.substring(0, 1000) + (html.length > 1000 ? '...' : '');
    } else if (result instanceof NodeList || result instanceof HTMLCollection) {
      return `[${result.constructor.name}: ${result.length} items]`;
    } else if (typeof result === 'object') {
      const json = JSON.stringify(result, null, 2);
      if (json.length > 10000) {
        return json.substring(0, 10000) + '\n... (truncated)';
      }
      return json;
    } else {
      return String(result);
    }
  } catch {
    return `[Unserializable: ${typeof result}]`;
  }
}

function setupRendererEvalListener(): void {
  if (rendererEvalListenerSetup) return;
  rendererEvalListenerSetup = true;

  const electronAPI = (window as any).electronAPI;
  if (!electronAPI?.on) {
    console.warn('[ExtensionSystem] electronAPI.on not available for renderer eval listener');
    return;
  }

  electronAPI.on('renderer:eval', async (data: { expression: string; responseChannel: string }) => {
    console.log(`[ExtensionSystem] Renderer eval request`);

    try {
      // Wrap in async IIFE to support await expressions
      // This allows expressions like: await fetch('/api/status').then(r => r.json())
      // eslint-disable-next-line no-eval
      const asyncEval = eval(`(async () => { return (${data.expression}); })()`);

      // Await the result (handles both sync and async expressions)
      const result = await asyncEval;

      electronAPI.send(data.responseChannel, {
        value: serializeEvalResult(result)
      });
    } catch (error) {
      console.error('[ExtensionSystem] Renderer eval failed:', error);

      electronAPI.send(data.responseChannel, {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
    }
  });

  console.log('[ExtensionSystem] Renderer eval IPC listener set up');
}
```

Call `setupRendererEvalListener()` from `registerExtensionSystem()` after the other listener setups.

## Files to Modify

1. **`packages/electron/src/main/mcp/extensionDevServer.ts`**
  - Add tool definition to `ListToolsRequestSchema` handler
  - Add tool implementation to `CallToolRequestSchema` handler

2. **`packages/electron/src/renderer/plugins/registerExtensionSystem.ts`**
  - Add `setupRendererEvalListener()` function
  - Call it from `registerExtensionSystem()`

## Testing

1. Start Nimbalyst in dev mode
2. Verify tool appears in MCP tool list
3. Test basic expressions:
  - `getComputedStyle(document.documentElement).getPropertyValue('--nim-text')`
  - `document.title`
  - `document.querySelectorAll('.tab-button').length`
4. Test error handling:
  - Invalid syntax
  - Timeout (with long-running code)
  - Accessing undefined variables
5. Verify tool is NOT available in production builds

## Example Usage

Agent calls:
```json
{
  "tool": "renderer_eval",
  "arguments": {
    "expression": "getComputedStyle(document.documentElement).getPropertyValue('--nim-text')"
  }
}
```

Response:
```
Result:
#1f2937
```

## Open Questions

1. **~~Should we support async expressions?~~** Yes - implemented by wrapping in async IIFE
2. **Should results include type information?** e.g., `(string) "hello"` vs just `"hello"`
3. **Should we add a \****`selector`**\*\* shorthand?** e.g., auto-query DOM with a selector string

## Alternatives Considered

### webContents.executeJavaScript

Electron provides `webContents.executeJavaScript()` which could be used directly from the main process. However:
- It executes with full privileges (can access Node.js require in some contexts)
- Less control over serialization
- Harder to add custom safeguards

The IPC approach is preferred because it:
- Keeps execution in the normal renderer context
- Allows custom result serialization
- Makes security checks explicit
- Follows the existing pattern for renderer-side operations

## Implementation Checklist

- [ ] Add tool definition to extensionDevServer.ts
- [ ] Add tool handler to extensionDevServer.ts
- [ ] Add setupRendererEvalListener to registerExtensionSystem.ts
- [ ] Call setup function from registerExtensionSystem
- [ ] Test in development mode
- [ ] Verify blocked in production mode
- [ ] Document in CLAUDE.md if needed
