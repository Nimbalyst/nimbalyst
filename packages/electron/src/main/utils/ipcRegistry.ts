import { ipcMain, IpcMainInvokeEvent } from 'electron';

/**
 * IPC Registry - Prevents duplicate IPC handler registration
 *
 * This module provides safe wrappers around ipcMain.handle() and ipcMain.on()
 * that prevent crashes from duplicate handler registration.
 *
 * Why this is needed:
 * - Dynamic imports can cause modules to be bundled into separate chunks
 * - If a chunk is loaded multiple times (or bundled with duplicated dependencies),
 *   IPC handlers may attempt to register twice
 * - Electron throws if you try to register the same handler twice
 *
 * This is defense-in-depth alongside manualChunks in vite config.
 */

const registeredHandlers = new Set<string>();
const registeredListeners = new Map<string, Set<Function>>();

/**
 * Safe ipcMain.handle() - prevents duplicate registration
 *
 * Use this instead of ipcMain.handle() for all invoke-style handlers.
 * If the handler is already registered, this will log a warning and skip.
 */
export function safeHandle(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: any[]) => any
): void {
  if (registeredHandlers.has(channel)) {
    console.warn(`[IPC] Handler already registered, skipping: ${channel}`);
    return;
  }
  registeredHandlers.add(channel);
  ipcMain.handle(channel, handler);
}

/**
 * Safe ipcMain.on() - prevents duplicate registration of the same handler
 *
 * Use this instead of ipcMain.on() for all event-style handlers.
 * If the exact same handler function is already registered, this will skip.
 *
 * Note: This uses function identity to detect duplicates. If you pass
 * a new function each time, it won't prevent duplicates. For handlers
 * defined inline, consider using safeOnce() or defining the handler
 * as a named function.
 */
export function safeOn(
  channel: string,
  handler: (event: Electron.IpcMainEvent, ...args: any[]) => void
): void {
  if (!registeredListeners.has(channel)) {
    registeredListeners.set(channel, new Set());
  }
  const handlers = registeredListeners.get(channel)!;
  if (handlers.has(handler)) {
    console.warn(`[IPC] Listener already registered, skipping: ${channel}`);
    return;
  }
  handlers.add(handler);
  ipcMain.on(channel, handler);
}

/**
 * Safe version of ipcMain.once() - prevents duplicate registration
 *
 * Note: once() handlers auto-remove after first call, but during
 * initialization we might still register the same once handler twice
 * before the first event fires.
 */
export function safeOnce(
  channel: string,
  handler: (event: Electron.IpcMainEvent, ...args: any[]) => void
): void {
  if (!registeredListeners.has(channel)) {
    registeredListeners.set(channel, new Set());
  }
  const handlers = registeredListeners.get(channel)!;
  if (handlers.has(handler)) {
    console.warn(`[IPC] Once listener already registered, skipping: ${channel}`);
    return;
  }
  handlers.add(handler);

  // Wrap to remove from our tracking when the handler fires
  const wrappedHandler = (event: Electron.IpcMainEvent, ...args: any[]) => {
    handlers.delete(handler);
    handler(event, ...args);
  };
  ipcMain.once(channel, wrappedHandler);
}

/**
 * Remove a handler (for cleanup or replacement)
 */
export function removeHandler(channel: string): void {
  if (registeredHandlers.has(channel)) {
    registeredHandlers.delete(channel);
    ipcMain.removeHandler(channel);
  }
}

/**
 * Remove all listeners for a channel
 */
export function removeAllListeners(channel: string): void {
  registeredListeners.delete(channel);
  ipcMain.removeAllListeners(channel);
}

/**
 * Check if a handler is registered (for debugging)
 */
export function isHandlerRegistered(channel: string): boolean {
  return registeredHandlers.has(channel);
}

/**
 * Get count of registered handlers (for debugging)
 */
export function getRegisteredHandlerCount(): number {
  return registeredHandlers.size;
}

/**
 * Get all registered handler channels (for debugging)
 */
export function getRegisteredChannels(): string[] {
  return Array.from(registeredHandlers);
}
