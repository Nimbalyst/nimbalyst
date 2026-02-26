/**
 * useIPCListener - A hook for safely subscribing to IPC events.
 *
 * This hook solves the "MaxListenersExceededWarning" problem that occurs when:
 * 1. useEffect dependencies include objects/arrays that change reference on every render
 * 2. The effect adds an IPC listener and the cleanup runs on every re-render
 * 3. Due to React's timing, new listeners can accumulate faster than cleanup
 *
 * Key features:
 * - Uses useRef to maintain a stable handler reference
 * - Handler always has access to latest callback via ref (no stale closure)
 * - Only subscribes/unsubscribes when channel changes (rare)
 * - Optional enabled flag for conditional listening
 *
 * @example
 * // Basic usage - handler always has access to latest state
 * useIPCListener('file-changed', (data) => {
 *   if (data.path === currentPath) {
 *     reloadFile();
 *   }
 * });
 *
 * @example
 * // Conditional listening
 * useIPCListener('ai:message', handleMessage, { enabled: isSessionActive });
 *
 * @example
 * // With session filtering (common pattern)
 * useIPCListener('ai:message-logged', (data) => {
 *   if (data.sessionId === sessionId) {
 *     addMessage(data.message);
 *   }
 * });
 */

import { useEffect, useRef, useCallback } from 'react';

type IPCHandler<T = any> = (data: T) => void;

interface UseIPCListenerOptions {
  /**
   * When false, the listener is not subscribed.
   * Useful for conditional listening based on component state.
   */
  enabled?: boolean;
}

/**
 * Subscribe to an IPC channel with automatic cleanup and stable references.
 *
 * @param channel - The IPC channel to listen to
 * @param handler - Callback invoked when event is received (can reference latest state)
 * @param options - Optional configuration
 */
export function useIPCListener<T = any>(
  channel: string,
  handler: IPCHandler<T>,
  options: UseIPCListenerOptions = {}
): void {
  const { enabled = true } = options;

  // Store the latest handler in a ref so we don't need it in deps
  const handlerRef = useRef<IPCHandler<T>>(handler);

  // Update ref on every render so handler always has access to latest closure values
  useEffect(() => {
    handlerRef.current = handler;
  });

  // Create a stable wrapper that calls the latest handler
  const stableHandler = useCallback((data: T) => {
    handlerRef.current(data);
  }, []);

  useEffect(() => {
    if (!enabled || !window.electronAPI?.on) {
      return;
    }

    const cleanup = window.electronAPI.on(channel, stableHandler);

    return () => {
      cleanup?.();
    };
  }, [channel, enabled, stableHandler]);
}

/**
 * Subscribe to multiple IPC channels with a single handler.
 *
 * Useful when multiple events should trigger the same action.
 *
 * @example
 * useIPCListeners(
 *   ['file-saved', 'file-reverted', 'external-change'],
 *   () => reloadDocument()
 * );
 */
export function useIPCListeners<T = any>(
  channels: string[],
  handler: IPCHandler<T>,
  options: UseIPCListenerOptions = {}
): void {
  const { enabled = true } = options;

  const handlerRef = useRef<IPCHandler<T>>(handler);

  useEffect(() => {
    handlerRef.current = handler;
  });

  const stableHandler = useCallback((data: T) => {
    handlerRef.current(data);
  }, []);

  useEffect(() => {
    if (!enabled || !window.electronAPI?.on) {
      return;
    }

    const cleanups = channels.map((channel) =>
      window.electronAPI.on(channel, stableHandler)
    );

    return () => {
      cleanups.forEach((cleanup) => cleanup?.());
    };
    // Using JSON.stringify for stable deps - channels array is typically static
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(channels), enabled, stableHandler]);
}

/**
 * Subscribe to an IPC channel only when a specific condition matches.
 *
 * This is a convenience wrapper for the common pattern of filtering by sessionId.
 *
 * @example
 * useIPCListenerForSession('ai:message-logged', sessionId, (data) => {
 *   addMessage(data.message);
 * });
 */
export function useIPCListenerForSession<T extends { sessionId: string }>(
  channel: string,
  sessionId: string | null | undefined,
  handler: (data: T) => void,
  options: UseIPCListenerOptions = {}
): void {
  const { enabled = true } = options;

  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  });

  // Capture sessionId in a ref so we can check it in the handler
  const sessionIdRef = useRef(sessionId);
  useEffect(() => {
    sessionIdRef.current = sessionId;
  });

  const stableHandler = useCallback((data: T) => {
    if (data.sessionId === sessionIdRef.current) {
      handlerRef.current(data);
    }
  }, []);

  useEffect(() => {
    if (!enabled || !sessionId || !window.electronAPI?.on) {
      return;
    }

    const cleanup = window.electronAPI.on(channel, stableHandler);

    return () => {
      cleanup?.();
    };
  }, [channel, enabled, sessionId, stableHandler]);
}
