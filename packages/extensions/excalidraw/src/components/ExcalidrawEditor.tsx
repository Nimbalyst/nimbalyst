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
        setInitialElements(data.elements as ExcalidrawElement[]);
        setInitialAppState({
          viewBackgroundColor: '#ffffff',
          collaborators: [],
          ...data.appState,
        });
        setInitialFiles(data.files || {});

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

        // Update Excalidraw via API
        if (excalidrawAPI) {
          // Suppress onChange -> setDirty while we're updating from external change
          isUpdatingFromExternalRef.current = true;
          try {
            excalidrawAPI.updateScene({
              elements: data.elements as ExcalidrawElement[],
              appState: data.appState,
            });
          } finally {
            // Reset after a microtask to ensure onChange has fired
            queueMicrotask(() => {
              isUpdatingFromExternalRef.current = false;
            });
          }
        }

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

  // Track previous elements for dirty detection
  const prevElementsRef = useRef<string>('');

  // Mark as dirty when diagram changes (but not from external updates)
  const onChange = useCallback((
    elements: readonly ExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles,
  ) => {
    // Don't mark dirty when we're programmatically updating from external file change
    if (isUpdatingFromExternalRef.current) {
      return;
    }

    // Excalidraw's onChange fires for many reasons (cursor, selection, etc.)
    // Only mark dirty if the actual elements or files changed
    const elementsJson = JSON.stringify(elements);
    if (elementsJson === prevElementsRef.current) {
      return; // No actual change to elements
    }
    prevElementsRef.current = elementsJson;

    console.log('[Excalidraw] Elements changed, marking dirty');
    host.setDirty(true);
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
