# IPC Guide for Stravu Editor

This document explains how inter-process communication (IPC) is organized in the Electron application that powers Stravu Editor. Use it as a reference when adding new platform features or debugging communication between the renderer and the main process.

## Architecture Overview

Stravu Editor runs as a typical secure Electron app:
- **Main process** (Node.js environment) manages application state, filesystem access, and window lifecycles. Its entry point is `packages/electron/src/main/index.ts`.
- **Preload script** (`packages/electron/src/preload/index.ts`) runs in an isolated context for every `BrowserWindow`. It exposes a curated `window.electronAPI` object via `contextBridge` so renderers never import `electron` directly.
- **Renderer** (React app in `packages/electron/src/renderer/`) consumes the safe API surface exported by the preload script and never touches Node globals.

This separation lets us keep `contextIsolation` enabled and maintain a small, auditable bridge between privileged and unprivileged code.

## Where IPC Handlers Live

Main-process IPC handlers are registered during `app.whenReady()` inside `packages/electron/src/main/index.ts`. Each capability is organized by feature:

- `src/main/ipc/` contains focused handler modules (`SettingsHandlers.ts`, `WindowHandlers.ts`, `SessionFileHandlers.ts`, etc.).
- `src/main/services/` modules expose richer APIs (for example, `AIService.ts` registers many `ai:*` channels).
- `src/main/window/` modules sometimes register window-specific channels (e.g., Session Manager export functions).

Every handler module exports a function that is invoked from `index.ts` (for example `registerSettingsHandlers()`). This keeps startup readable and makes it obvious which features have IPC coverage.

## Naming Conventions

- **Invoke-style requests** use `ipcMain.handle(channel, async () => …)` and are consumed through `ipcRenderer.invoke(channel, …)`. Return values resolve as Promises in the renderer.
- **Fire-and-forget events** use `ipcMain.on(channel, (event, payload) => …)` and correspond to `ipcRenderer.send(channel, payload)`.
- Channel names follow a `namespace:action` pattern (`'history:create-snapshot'`, `'session-files:get-by-session'`) to avoid collisions and to make debugging easier.
- Renderer-to-renderer broadcasts always go through the main process: `window.webContents.send('theme-change', theme)`.

## Preload Bridge Pattern

`packages/electron/src/preload/index.ts` mirrors the registered channels. Each bridge function:

1. Calls `ipcRenderer.invoke` or `ipcRenderer.send` with the relevant channel.
2. Returns a disposer when registering event listeners (e.g., `onThemeChange`).
3. Avoids exposing raw `ipcRenderer` to renderers.

When you add a new handler in the main process, add a matching function in the preload script and update `packages/electron/src/renderer/electron.d.ts` so TypeScript consumers get accurate typings.

```ts
// preload
contextBridge.exposeInMainWorld('electronAPI', {
  doThing: (input: string) => ipcRenderer.invoke('my-feature:do-thing', input),
  onThingCompleted: (cb: (result: Result) => void) => {
    const handler = (_event, result) => cb(result);
    ipcRenderer.on('my-feature:completed', handler);
    return () => ipcRenderer.removeListener('my-feature:completed', handler);
  }
});
```

```ts
// renderer usage
const outcome = await window.electronAPI.doThing('hello');
const unsubscribe = window.electronAPI.onThingCompleted((result) => {
  console.log('Result arrived', result);
});
```

## Renderer Consumption

React components and hooks import nothing from Electron directly. They call `window.electronAPI` helpers and wrap them in domain-specific services (see `src/renderer/services/aiApi.ts`). Keep these helpers thin so testing remains straightforward.

When invoking IPC from the renderer:

- Always `await` invoke calls and handle failures gracefully (`try/catch`).
- Debounce high-frequency events (like resizing) before sending to the main process.
- Remove event listeners during cleanup by calling the disposer returned from the preload bridge.

## Adding a New IPC Flow

1. **Define the main handler.** Choose the file that owns the feature (create a new module under `src/main/ipc/` if necessary). Use `ipcMain.handle` for request/response or `ipcMain.on` for simple notifications. Validate inputs and prefer returning structured objects (`{ success, data?, error? }`).
2. **Expose it through the preload bridge.** Add a function in `src/preload/index.ts` that invokes the new channel, plus optional listener helpers.
3. **Type it.** Update `src/renderer/electron.d.ts` so `window.electronAPI` reflects the new capability.
4. **Call it from the renderer.** Use the bridge helper inside your React code or service layer.
5. **(Optional) Broadcast results.** If other windows or the same renderer need to react, use `browserWindow.webContents.send('channel', payload)` in the main process.

## Debugging Tips

- **Check the channel name** on both sides—typos are the most common source of `undefined` results.
- **Ensure a return statement** inside `ipcMain.handle` callbacks. If you forget to `return`, `ipcRenderer.invoke` resolves to `undefined`.
- **Use DevTools**: run `await window.electronAPI.invoke('channel', …)` from the console to inspect responses.
- **Log with context**: `logger.main` in the main process and `logger.ui` / `console` in renderers make correlation easier.
- **Profile payload size**: avoid sending very large blobs through IPC; use shared files when possible.

## Security Considerations

- Keep the preload surface minimal; exposing a single generic `invoke(channel, …)` helper is intentional, but **do not** leak Node primitives or unsanitized user input to the main process.
- Validate arguments in the main handler before touching the filesystem or executing shell commands.
- Prefer whitelisting operations instead of passing through arbitrary channel names from the renderer.

Following this pattern keeps Stravu Editor’s IPC predictable, testable, and secure while still letting features evolve quickly.
