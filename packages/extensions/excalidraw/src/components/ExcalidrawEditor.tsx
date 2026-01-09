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
  const [initialAppState, setInitialAppState] = useState<Partial<AppState>>({
    viewBackgroundColor: '#ffffff',
    collaborators: [],
  });
  const [initialFiles, setInitialFiles] = useState<BinaryFiles>({});

  // Excalidraw API reference
  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawImperativeAPI | null>(null);

  // Track what we believe is on disk to ignore echoes from our own saves
  const lastKnownDiskContentRef = useRef<string>('');

  // Track if initial load has completed
  const hasLoadedRef = useRef(false);

  // Track when we're programmatically updating the scene (to suppress onChange -> dirty)
  const isUpdatingFromExternalRef = useRef(false);

  // Track previous elements to detect actual content changes vs view-only changes
  const previousElementsRef = useRef<readonly ExcalidrawElement[]>([]);
  const previousFilesCountRef = useRef<number>(0);

  // Default empty Excalidraw file
  const createEmptyFile = (): ExcalidrawFile => ({
    type: 'excalidraw',
    version: 2,
    source: 'https://excalidraw.com',
    elements: [],
    appState: {
      viewBackgroundColor: '#ffffff',
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
          viewBackgroundColor: '#ffffff',
          collaborators: [],
          ...data.appState,
        });
        setInitialFiles(files);

        // Initialize previous refs for change detection
        previousElementsRef.current = elements;
        previousFilesCountRef.current = Object.keys(files).length;

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

        // Update Excalidraw via API
        if (excalidrawAPI) {
          // Suppress onChange -> setDirty while we're updating from external change
          isUpdatingFromExternalRef.current = true;
          try {
            excalidrawAPI.updateScene({
              elements,
              appState: data.appState,
            });
          } finally {
            // Reset after a microtask to ensure onChange has fired
            queueMicrotask(() => {
              isUpdatingFromExternalRef.current = false;
            });
          }
        }

        // Update previous refs to match new content
        previousElementsRef.current = elements;
        previousFilesCountRef.current = Object.keys(files).length;

        lastKnownDiskContentRef.current = newContent;
      } catch (error) {
        console.error('[Excalidraw] Failed to parse reloaded content:', error);
      }
    });
  }, [host, excalidrawAPI]);

  // Subscribe to save requests from host
  useEffect(() => {
    return host.onSaveRequested(async () => {
      if (!excalidrawAPI) {
        console.error('[Excalidraw] Cannot save: API not ready');
        return;
      }

      try {
        const elements = excalidrawAPI.getSceneElements();
        const appState = excalidrawAPI.getAppState();
        const files = excalidrawAPI.getFiles();

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
  }, [host, excalidrawAPI]);

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
    const prevElements = previousElementsRef.current;

    // Fast path: same reference means no change
    if (elements === prevElements) {
      return;
    }

    // Check if elements actually differ
    let elementsChanged = elements.length !== prevElements.length;

    if (!elementsChanged) {
      // Check if any element version changed
      for (let i = 0; i < elements.length; i++) {
        const curr = elements[i];
        const prev = prevElements[i];
        // Elements have version numbers that increment on changes
        if (curr.id !== prev.id || curr.version !== prev.version) {
          elementsChanged = true;
          break;
        }
      }
    }

    // Also check if files changed (embedded images)
    const currFilesCount = Object.keys(files).length;
    const filesChanged = currFilesCount !== previousFilesCountRef.current;

    // Update previous refs for next comparison
    previousElementsRef.current = elements;
    previousFilesCountRef.current = currFilesCount;

    // Only mark dirty if actual content changed
    if (elementsChanged || filesChanged) {
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
      <div className="excalidraw-editor" data-theme={theme} style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: 'var(--text-secondary)' }}>Loading diagram...</div>
      </div>
    );
  }

  // Show error state
  if (loadError) {
    return (
      <div className="excalidraw-editor" data-theme={theme} style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: 'var(--text-error)' }}>
          Failed to load: {loadError.message}
        </div>
      </div>
    );
  }

  // Render Excalidraw following the exact Rexical pattern
  // Key by theme to force remount when theme changes
  return (
    <div className="excalidraw-editor" style={{ width: '100%', height: '100%' }}>
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
