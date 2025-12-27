/**
 * useEditorHost Hook
 *
 * Encapsulates common patterns for custom editors using the EditorHost API:
 * - Content loading on mount with loading/error states
 * - File change subscriptions with echo detection
 * - Save request handling
 * - Dirty state management
 *
 * This hook provides a clean, minimal API that handles all the boilerplate
 * of integrating with the EditorHost system.
 *
 * Example usage:
 * ```tsx
 * function MyEditor({ host }: EditorHostProps) {
 *   const {
 *     content,
 *     setContent,
 *     isLoading,
 *     error,
 *   } = useEditorHost(host);
 *
 *   if (isLoading) return <Loading />;
 *   if (error) return <Error message={error.message} />;
 *
 *   return <Editor content={content} onChange={setContent} />;
 * }
 * ```
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { EditorHost } from './editorHost';

/**
 * Options for useEditorHost hook
 */
export interface UseEditorHostOptions<T = string> {
  /**
   * Parse raw content string into editor's internal format.
   * If not provided, content is used as-is (string).
   * Throw an error if parsing fails.
   */
  parse?: (raw: string) => T;

  /**
   * Serialize editor's internal format back to string for saving.
   * If not provided, content.toString() is used.
   */
  serialize?: (data: T) => string;

  /**
   * Called when content changes from external source (file watcher, AI edit).
   * Use this to update any secondary state that depends on content.
   */
  onExternalChange?: (newContent: T) => void;

  /**
   * Custom logger prefix for debugging.
   * @default '[Editor]'
   */
  logPrefix?: string;
}

/**
 * Return type for useEditorHost hook
 */
export interface UseEditorHostResult<T = string> {
  /**
   * Current content in editor's internal format.
   * null while loading.
   */
  content: T | null;

  /**
   * Update content. Automatically marks editor as dirty.
   */
  setContent: (newContent: T) => void;

  /**
   * Whether content is currently loading from disk.
   */
  isLoading: boolean;

  /**
   * Error that occurred during loading, or null if no error.
   */
  error: Error | null;

  /**
   * Mark the editor as clean (content matches disk).
   * Typically called after a save completes.
   */
  markClean: () => void;

  /**
   * Whether the editor has unsaved changes.
   */
  isDirty: boolean;

  /**
   * Trigger a manual save. Returns when save completes.
   * Note: Most saves happen automatically via onSaveRequested.
   */
  save: () => Promise<void>;
}

/**
 * Hook for custom editors to integrate with the EditorHost API.
 *
 * Handles:
 * - Content loading on mount
 * - File change subscriptions with echo detection
 * - Save request subscriptions
 * - Dirty state management
 *
 * @param host The EditorHost instance from props
 * @param options Configuration options
 * @returns Editor state and controls
 */
export function useEditorHost<T = string>(
  host: EditorHost,
  options: UseEditorHostOptions<T> = {}
): UseEditorHostResult<T> {
  const {
    parse,
    serialize,
    onExternalChange,
    logPrefix = '[Editor]',
  } = options;

  // Content state
  const [content, setContentState] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  // Track what we believe is on disk to detect echoes from our own saves
  const lastKnownDiskContentRef = useRef<string>('');

  // Stable references to callbacks
  const parseRef = useRef(parse);
  const serializeRef = useRef(serialize);
  const onExternalChangeRef = useRef(onExternalChange);

  // Update refs when callbacks change
  useEffect(() => {
    parseRef.current = parse;
    serializeRef.current = serialize;
    onExternalChangeRef.current = onExternalChange;
  }, [parse, serialize, onExternalChange]);

  // Parse raw content using the parse function if provided
  const parseContent = useCallback((raw: string): T => {
    if (parseRef.current) {
      return parseRef.current(raw);
    }
    // If no parse function, assume T is string
    return raw as unknown as T;
  }, []);

  // Serialize content using the serialize function if provided
  const serializeContent = useCallback((data: T): string => {
    if (serializeRef.current) {
      return serializeRef.current(data);
    }
    // If no serialize function, assume T is string or has toString
    return String(data);
  }, []);

  // Load content on mount
  useEffect(() => {
    let mounted = true;

    const loadContent = async () => {
      try {
        const raw = await host.loadContent();
        if (!mounted) return;

        const parsed = parseContent(raw);
        setContentState(parsed);
        lastKnownDiskContentRef.current = raw;
        setIsLoading(false);
        setError(null);

        console.log(`${logPrefix} Loaded content`);
      } catch (err) {
        if (!mounted) return;

        const loadError = err instanceof Error ? err : new Error(String(err));
        console.error(`${logPrefix} Failed to load content:`, loadError);
        setError(loadError);
        setIsLoading(false);
      }
    };

    loadContent();

    return () => {
      mounted = false;
    };
  }, [host, parseContent, logPrefix]);

  // Subscribe to file changes
  useEffect(() => {
    return host.onFileChanged((newRawContent) => {
      // Ignore echoes from our own saves
      if (newRawContent === lastKnownDiskContentRef.current) {
        console.log(`${logPrefix} File change ignored - matches our last known disk state`);
        return;
      }

      console.log(`${logPrefix} External file change detected, reloading`);

      try {
        const parsed = parseContent(newRawContent);
        setContentState(parsed);
        lastKnownDiskContentRef.current = newRawContent;
        setIsDirty(false);
        host.setDirty(false);

        // Notify caller of external change
        onExternalChangeRef.current?.(parsed);
      } catch (err) {
        console.error(`${logPrefix} Failed to parse external change:`, err);
      }
    });
  }, [host, parseContent, logPrefix]);

  // Subscribe to save requests
  useEffect(() => {
    return host.onSaveRequested(async () => {
      if (content === null) return;

      try {
        const serialized = serializeContent(content);
        // Update disk state BEFORE saving to prevent echo
        lastKnownDiskContentRef.current = serialized;
        await host.saveContent(serialized);
        setIsDirty(false);
        host.setDirty(false);
        console.log(`${logPrefix} Saved`);
      } catch (err) {
        console.error(`${logPrefix} Save failed:`, err);
      }
    });
  }, [host, content, serializeContent, logPrefix]);

  // Update content and mark dirty
  const setContent = useCallback((newContent: T) => {
    setContentState(newContent);
    setIsDirty(true);
    host.setDirty(true);
  }, [host]);

  // Mark as clean (after external save or reload)
  const markClean = useCallback(() => {
    setIsDirty(false);
    host.setDirty(false);
  }, [host]);

  // Manual save function
  const save = useCallback(async () => {
    if (content === null) return;

    const serialized = serializeContent(content);
    lastKnownDiskContentRef.current = serialized;
    await host.saveContent(serialized);
    setIsDirty(false);
    host.setDirty(false);
    console.log(`${logPrefix} Saved (manual)`);
  }, [host, content, serializeContent, logPrefix]);

  return {
    content,
    setContent,
    isLoading,
    error,
    markClean,
    isDirty,
    save,
  };
}
