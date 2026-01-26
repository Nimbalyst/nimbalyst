/**
 * Excalidraw Editor
 *
 * Custom editor for .excalidraw files that integrates with Nimbalyst's EditorHost API.
 */

import { useEffect, useRef, useCallback, useState, forwardRef } from 'react';
import { Excalidraw } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI, ExcalidrawElement, AppState, BinaryFiles } from '@excalidraw/excalidraw/types/types';
import type { EditorHostProps } from '@nimbalyst/runtime';
import type { ExcalidrawFile } from '../types';
import { registerEditor, unregisterEditor } from '../editorRegistry';

export const ExcalidrawEditor = forwardRef<any, EditorHostProps>(function ExcalidrawEditor({ host }, ref) {
  const { filePath, theme: hostTheme } = host;
  // Excalidraw only supports 'light' or 'dark' - map our themes accordingly
  const theme = (hostTheme === 'dark' || hostTheme === 'crystal-dark') ? 'dark' : 'light';

  // Loading state
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<Error | null>(null);

  // Excalidraw state - following the Rexical pattern
  const [initialElements, setInitialElements] = useState<ExcalidrawElement[]>([]);
  // Use theme-aware background color to prevent white flash in dark mode
  const defaultBackgroundColor = theme === 'dark' ? '#1e1e1e' : '#ffffff';
  const [initialAppState, setInitialAppState] = useState<Partial<AppState>>({
    viewBackgroundColor: defaultBackgroundColor,
    collaborators: [],
  });
  const [initialFiles, setInitialFiles] = useState<BinaryFiles>({});

  // Excalidraw API reference
  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawImperativeAPI | null>(null);
  // Ref to access API in callbacks without stale closures
  const excalidrawAPIRef = useRef<ExcalidrawImperativeAPI | null>(null);
  useEffect(() => {
    excalidrawAPIRef.current = excalidrawAPI;
  }, [excalidrawAPI]);

  // Track what we believe is on disk to ignore echoes from our own saves
  const lastKnownDiskContentRef = useRef<string>('');

  // Track if initial load has completed
  const hasLoadedRef = useRef(false);

  // Track when we're programmatically updating the scene (to suppress onChange -> dirty)
  const isUpdatingFromExternalRef = useRef(false);

  // Track previous state to detect actual content changes
  // NOTE: Excalidraw reuses the same array reference (mutates in place), so we track
  // a Map of element id -> version instead of the array reference
  const previousElementVersionsRef = useRef<Map<string, number>>(new Map());
  const previousFilesCountRef = useRef<number>(0);
  // Track appState that gets saved (scroll, zoom, background color)
  const previousAppStateRef = useRef<{
    scrollX: number;
    scrollY: number;
    zoom: number;
    viewBackgroundColor: string;
  } | null>(null);

  // Default empty Excalidraw file
  const createEmptyFile = (): ExcalidrawFile => ({
    type: 'excalidraw',
    version: 2,
    source: 'https://excalidraw.com',
    elements: [],
    appState: {
      viewBackgroundColor: defaultBackgroundColor,
      collaborators: [],
    },
    files: {},
  });

  // Load content on mount (only once)
  useEffect(() => {
    if (hasLoadedRef.current) return;

    let mounted = true;

    host.loadContent()
      .then((content) => {
        if (!mounted) return;

        hasLoadedRef.current = true;

        let data: ExcalidrawFile;
        if (content) {
          try {
            data = JSON.parse(content);
          } catch (error) {
            console.error('[Excalidraw] Failed to parse file:', error);
            data = createEmptyFile();
          }
        } else {
          data = createEmptyFile();
        }

        // Set initial state for Excalidraw with proper defaults
        const elements = data.elements as ExcalidrawElement[];
        const files = data.files || {};
        setInitialElements(elements);
        setInitialAppState({
          viewBackgroundColor: defaultBackgroundColor,
          collaborators: [],
          ...data.appState,
        });
        setInitialFiles(files);

        // Initialize previous refs for change detection
        const versionMap = new Map<string, number>();
        for (const el of elements) {
          versionMap.set(el.id, el.version);
        }
        previousElementVersionsRef.current = versionMap;
        previousFilesCountRef.current = Object.keys(files).length;
        // Initialize appState tracking
        previousAppStateRef.current = {
          scrollX: data.appState?.scrollX ?? 0,
          scrollY: data.appState?.scrollY ?? 0,
          zoom: typeof data.appState?.zoom === 'object' ? data.appState.zoom.value : (data.appState?.zoom ?? 1),
          viewBackgroundColor: data.appState?.viewBackgroundColor ?? defaultBackgroundColor,
        };

        lastKnownDiskContentRef.current = content || '';
        setIsLoading(false);
      })
      .catch((error) => {
        if (mounted) {
          hasLoadedRef.current = true;
          console.error('[Excalidraw] Failed to load content:', error);
          setLoadError(error);
          setIsLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [host]);


  // Subscribe to file change notifications
  useEffect(() => {
    return host.onFileChanged((newContent) => {
      console.log('[Excalidraw] onFileChanged called, content match:', newContent === lastKnownDiskContentRef.current);
      if (newContent === lastKnownDiskContentRef.current) {
        console.log('[Excalidraw] Ignoring file change - matches last known disk content');
        return;
      }

      console.log('[Excalidraw] External file change detected, reloading');

      try {
        const data: ExcalidrawFile = JSON.parse(newContent);
        const elements = data.elements as ExcalidrawElement[];
        const files = data.files || {};

        // Update Excalidraw via API (use ref to avoid stale closure)
        const api = excalidrawAPIRef.current;
        if (api) {
          // Suppress onChange -> setDirty while we're updating from external change
          isUpdatingFromExternalRef.current = true;
          try {
            api.updateScene({
              elements,
              appState: data.appState,
            });
          } finally {
            // Reset after a microtask to ensure onChange has fired
            queueMicrotask(() => {
              isUpdatingFromExternalRef.current = false;
            });
          }
        } else {
          console.warn('[Excalidraw] API not ready for external file change update');
        }

        // Update previous refs to match new content
        const versionMap = new Map<string, number>();
        for (const el of elements) {
          versionMap.set(el.id, el.version);
        }
        previousElementVersionsRef.current = versionMap;
        previousFilesCountRef.current = Object.keys(files).length;
        // Update appState tracking
        previousAppStateRef.current = {
          scrollX: data.appState?.scrollX ?? 0,
          scrollY: data.appState?.scrollY ?? 0,
          zoom: typeof data.appState?.zoom === 'object' ? data.appState.zoom.value : (data.appState?.zoom ?? 1),
          viewBackgroundColor: data.appState?.viewBackgroundColor ?? defaultBackgroundColor,
        };

        lastKnownDiskContentRef.current = newContent;
      } catch (error) {
        console.error('[Excalidraw] Failed to parse reloaded content:', error);
      }
    });
  }, [host]);

  // Subscribe to save requests from host
  useEffect(() => {
    return host.onSaveRequested(async () => {
      const api = excalidrawAPIRef.current;
      if (!api) {
        console.error('[Excalidraw] Cannot save: API not ready');
        return;
      }

      try {
        const elements = api.getSceneElements();
        const appState = api.getAppState();
        const files = api.getFiles();

        const fileData: ExcalidrawFile = {
          type: 'excalidraw',
          version: 2,
          source: 'https://excalidraw.com',
          elements,
          appState: {
            viewBackgroundColor: appState.viewBackgroundColor,
            scrollX: appState.scrollX,
            scrollY: appState.scrollY,
            zoom: appState.zoom,
          },
          files,
        };

        const content = JSON.stringify(fileData, null, 2);
        lastKnownDiskContentRef.current = content;
        await host.saveContent(content);
        host.setDirty(false);
        console.log('[Excalidraw] Saved');
      } catch (error) {
        console.error('[Excalidraw] Save failed:', error);
      }
    });
  }, [host]);

  // Mark as dirty only when elements actually change (not just view state)
  const onChange = useCallback((
    elements: readonly ExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles,
  ) => {
    // Don't mark dirty when we're programmatically updating from external file change
    if (isUpdatingFromExternalRef.current) {
      return;
    }

    // Check if elements actually changed (not just selection/view state)
    // Excalidraw fires onChange for every state change including cursor, selection, zoom
    // NOTE: Excalidraw reuses the same array reference (mutates in place), so we cannot
    // use reference equality. Instead, we track element IDs and versions.
    const prevVersions = previousElementVersionsRef.current;

    // Check if elements actually differ by comparing versions
    let elementsChanged = elements.length !== prevVersions.size;

    if (!elementsChanged) {
      // Check if any element version changed
      for (const element of elements) {
        const prevVersion = prevVersions.get(element.id);
        if (prevVersion === undefined || prevVersion !== element.version) {
          elementsChanged = true;
          break;
        }
      }
    }

    // Also check if files changed (embedded images)
    const currFilesCount = Object.keys(files).length;
    const filesChanged = currFilesCount !== previousFilesCountRef.current;

    // Check if appState that we save has changed (scroll, zoom, background color)
    const prevAppState = previousAppStateRef.current;
    const zoomValue = typeof appState.zoom === 'object' ? appState.zoom.value : appState.zoom;
    const appStateChanged = prevAppState === null ||
      prevAppState.scrollX !== appState.scrollX ||
      prevAppState.scrollY !== appState.scrollY ||
      prevAppState.zoom !== zoomValue ||
      prevAppState.viewBackgroundColor !== appState.viewBackgroundColor;

    // Update previous refs for next comparison
    // Store a Map of id -> version for accurate tracking
    const newVersions = new Map<string, number>();
    for (const element of elements) {
      newVersions.set(element.id, element.version);
    }
    previousElementVersionsRef.current = newVersions;
    previousFilesCountRef.current = currFilesCount;
    previousAppStateRef.current = {
      scrollX: appState.scrollX,
      scrollY: appState.scrollY,
      zoom: zoomValue,
      viewBackgroundColor: appState.viewBackgroundColor,
    };

    // Only mark dirty if actual content changed
    if (elementsChanged || filesChanged || appStateChanged) {
      host.setDirty(true);
    }
  }, [host]);


  // Register editor API for AI tool access
  useEffect(() => {
    if (excalidrawAPI) {
      registerEditor(filePath, excalidrawAPI);
      return () => {
        unregisterEditor(filePath);
      };
    }
  }, [filePath, excalidrawAPI]);

  // Show loading state
  if (isLoading) {
    return (
      <div className="excalidraw-editor w-full h-full flex items-center justify-center" data-theme={theme}>
        <div className="text-nim-muted">Loading diagram...</div>
      </div>
    );
  }

  // Show error state
  if (loadError) {
    return (
      <div className="excalidraw-editor w-full h-full flex items-center justify-center" data-theme={theme}>
        <div className="text-nim-error">
          Failed to load: {loadError.message}
        </div>
      </div>
    );
  }

  // Render Excalidraw following the exact Rexical pattern
  // Key by theme to force remount when theme changes
  return (
    <div className="excalidraw-editor w-full h-full" data-theme={theme}>
      <Excalidraw
        key={theme}
        onChange={onChange}
        excalidrawAPI={setExcalidrawAPI}
        initialData={{
          appState: initialAppState,
          elements: initialElements,
          files: initialFiles,
        }}
        theme={theme}
      />
    </div>
  );
});
