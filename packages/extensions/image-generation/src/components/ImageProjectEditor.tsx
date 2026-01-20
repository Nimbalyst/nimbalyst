/**
 * Image Project Editor
 *
 * Custom editor for .imgproj files that provides a gallery view of generated images
 * with a bottom bar for creating new generations.
 */

import { useEffect, useRef, useCallback, useState, forwardRef } from 'react';
import type { EditorHostProps } from '@nimbalyst/runtime';
import type { ImageProject, Generation, ImageStyle, AspectRatio, GeneratedImage } from '../types';
import { Gallery } from './Gallery';
import { BottomBar } from './BottomBar';
import { registerEditor, unregisterEditor } from '../editorRegistry';
import { nanoBananaProvider } from '../providers/nanoBanana';

// Storage key for the Google AI API key
const GOOGLE_AI_KEY_STORAGE_KEY = 'google_ai_api_key';

/**
 * API Key Missing Banner
 * Shows when no API key is configured, directs user to Settings
 */
function ApiKeyMissingBanner({ theme }: { theme: 'light' | 'dark' }) {
  return (
    <div
      style={{
        padding: '12px 16px',
        background: theme === 'dark' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(245, 158, 11, 0.1)',
        borderBottom: '1px solid var(--warning-color, #f59e0b)',
        color: 'var(--warning-color, #f59e0b)',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        fontSize: 13,
      }}
    >
      <span style={{ flex: 1 }}>
        Google AI API key not configured. Go to <strong>Settings &gt; Extensions &gt; Image Generation</strong> to add your API key.
      </span>
    </div>
  );
}

export const ImageProjectEditor = forwardRef<unknown, EditorHostProps>(
  function ImageProjectEditor({ host }, _ref) {
    const { filePath, theme: hostTheme } = host;
    const theme = hostTheme === 'dark' || hostTheme === 'crystal-dark' ? 'dark' : 'light';

    // Loading state
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState<Error | null>(null);

    // Project state
    const [project, setProject] = useState<ImageProject | null>(null);

    // Generation in progress
    const [isGenerating, setIsGenerating] = useState(false);
    const [generationError, setGenerationError] = useState<string | null>(null);

    // API key state
    const [apiKeyConfigured, setApiKeyConfigured] = useState(false);

    // Track what we believe is on disk to ignore echoes from our own saves
    const lastKnownDiskContentRef = useRef<string>('');

    // Track if initial load has completed
    const hasLoadedRef = useRef(false);

    // Load API key from extension storage on mount
    useEffect(() => {
      const loadApiKey = async () => {
        try {
          const apiKey = await host.storage.getSecret(GOOGLE_AI_KEY_STORAGE_KEY);
          if (apiKey) {
            nanoBananaProvider.setApiKey(apiKey);
            setApiKeyConfigured(true);
            console.log('[ImageGen] API key loaded from storage');
          } else {
            console.log('[ImageGen] No API key configured');
          }
        } catch (error) {
          console.error('[ImageGen] Failed to load API key:', error);
        }
      };
      loadApiKey();
    }, [host.storage]);

    // Create a default empty project
    const createEmptyProject = (): ImageProject => ({
      version: 1,
      name: 'New Image Project',
      created: new Date().toISOString(),
      provider: 'nano-banana',
      generations: [],
      settings: {
        defaultStyle: 'sketch',
        variationsPerPrompt: 3,
        defaultAspectRatio: '1:1',
      },
    });

    // Load content on mount
    useEffect(() => {
      if (hasLoadedRef.current) return;

      let mounted = true;

      host
        .loadContent()
        .then((content) => {
          if (!mounted) return;

          hasLoadedRef.current = true;

          let data: ImageProject;
          if (content) {
            try {
              data = JSON.parse(content);
              // Ensure created timestamp is set
              if (!data.created) {
                data.created = new Date().toISOString();
              }
            } catch (error) {
              console.error('[ImageGen] Failed to parse file:', error);
              data = createEmptyProject();
            }
          } else {
            data = createEmptyProject();
          }

          setProject(data);
          lastKnownDiskContentRef.current = content || '';
          setIsLoading(false);
        })
        .catch((error) => {
          if (mounted) {
            hasLoadedRef.current = true;
            console.error('[ImageGen] Failed to load content:', error);
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
        if (newContent === lastKnownDiskContentRef.current) {
          return;
        }

        console.log('[ImageGen] External file change detected, reloading');

        try {
          const data: ImageProject = JSON.parse(newContent);
          setProject(data);
          lastKnownDiskContentRef.current = newContent;
        } catch (error) {
          console.error('[ImageGen] Failed to parse reloaded content:', error);
        }
      });
    }, [host]);

    // Subscribe to save requests from host
    useEffect(() => {
      return host.onSaveRequested(async () => {
        if (!project) {
          console.error('[ImageGen] Cannot save: no project loaded');
          return;
        }

        try {
          const content = JSON.stringify(project, null, 2);
          lastKnownDiskContentRef.current = content;
          await host.saveContent(content);
          host.setDirty(false);
          console.log('[ImageGen] Saved');
        } catch (error) {
          console.error('[ImageGen] Save failed:', error);
        }
      });
    }, [host, project]);

    // Update project and mark dirty
    const updateProject = useCallback(
      (updater: (prev: ImageProject) => ImageProject) => {
        setProject((prev) => {
          if (!prev) return prev;
          const updated = updater(prev);
          host.setDirty(true);
          return updated;
        });
      },
      [host]
    );

    // Get the images folder path
    const getImagesFolderPath = useCallback(() => {
      return filePath.replace('.imgproj', '.imgproj.images');
    }, [filePath]);

    // Save image to disk
    const saveImageToDisk = useCallback(
      async (filename: string, base64Data: string): Promise<void> => {
        const imagesFolder = getImagesFolderPath();
        const imagePath = `${imagesFolder}/${filename}`;

        // Use the electronAPI to write binary data
        const electronAPI = (window as any).electronAPI;
        if (electronAPI) {
          await electronAPI.invoke('extensions:write-binary', imagePath, base64Data);
          console.log('[ImageGen] Saved image:', imagePath);
        } else {
          throw new Error('electronAPI not available');
        }
      },
      [getImagesFolderPath]
    );

    // Handle generation request
    const handleGenerate = useCallback(
      async (
        prompt: string,
        style: ImageStyle,
        aspectRatio: AspectRatio,
        variations: number
      ) => {
        if (!project || isGenerating) return;

        // Check if API key is configured
        if (!nanoBananaProvider.isConfigured()) {
          setGenerationError(
            'Google AI API key not configured. Please set your API key in the extension settings.'
          );
          return;
        }

        setIsGenerating(true);
        setGenerationError(null);

        try {
          console.log('[ImageGen] Starting generation:', { prompt, style, aspectRatio, variations });

          // Call the actual image generation API
          const result = await nanoBananaProvider.generateImage({
            prompt,
            style,
            aspectRatio,
            numVariations: variations,
          });

          console.log('[ImageGen] Generation result:', result.images.length, 'images');

          // Save images to disk and strip the base64 data
          const savedImages: GeneratedImage[] = [];
          for (const image of result.images) {
            // Access the temporary _base64Data field
            const imageWithData = image as GeneratedImage & { _base64Data?: string };
            if (imageWithData._base64Data) {
              await saveImageToDisk(image.file, imageWithData._base64Data);
              // Create clean image object without base64 data
              savedImages.push({
                file: image.file,
                seed: image.seed,
                width: image.width,
                height: image.height,
              });
            }
          }

          // Create the generation entry
          const generation: Generation = {
            id: `gen-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            prompt,
            style,
            aspectRatio,
            parameters: {},
            timestamp: new Date().toISOString(),
            results: savedImages,
          };

          // Add the generation to the project (at the beginning for newest-first)
          updateProject((prev) => ({
            ...prev,
            generations: [generation, ...prev.generations],
          }));

          console.log('[ImageGen] Generation complete, added', savedImages.length, 'images');
        } catch (error) {
          console.error('[ImageGen] Generation failed:', error);
          setGenerationError(error instanceof Error ? error.message : 'Generation failed');
        } finally {
          setIsGenerating(false);
        }
      },
      [project, isGenerating, updateProject, saveImageToDisk]
    );

    // Handle edit & retry from gallery
    const handleEditPrompt = useCallback(
      (generation: Generation) => {
        // This will be handled by passing the prompt to the bottom bar
        // For now, just log
        console.log('[ImageGen] Edit prompt:', generation.prompt);
      },
      []
    );

    // Register editor API for AI tool access
    useEffect(() => {
      if (project) {
        registerEditor(filePath, {
          getProject: () => project,
          updateProject,
          generate: handleGenerate,
        });
        return () => {
          unregisterEditor(filePath);
        };
      }
    }, [filePath, project, updateProject, handleGenerate]);

    // Show loading state
    if (isLoading) {
      return (
        <div
          className="image-project-editor"
          data-theme={theme}
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--surface-primary, #2d2d2d)',
            color: 'var(--text-secondary, #b3b3b3)',
          }}
        >
          <div>Loading project...</div>
        </div>
      );
    }

    // Show error state
    if (loadError) {
      return (
        <div
          className="image-project-editor"
          data-theme={theme}
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--surface-primary, #2d2d2d)',
            color: 'var(--error-color, #ef4444)',
          }}
        >
          <div>Failed to load: {loadError.message}</div>
        </div>
      );
    }

    if (!project) {
      return null;
    }

    return (
      <div
        className="image-project-editor"
        data-theme={theme}
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--surface-primary, #2d2d2d)',
          color: 'var(--text-primary, #ffffff)',
        }}
      >
        {/* API Key Missing Banner */}
        {!apiKeyConfigured && (
          <ApiKeyMissingBanner theme={theme} />
        )}

        {/* Error Banner */}
        {generationError && (
          <div
            style={{
              padding: '12px 16px',
              background: 'var(--error-background, #3f1d1d)',
              borderBottom: '1px solid var(--error-color, #ef4444)',
              color: 'var(--error-color, #ef4444)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <span style={{ flex: 1 }}>{generationError}</span>
            <button
              onClick={() => setGenerationError(null)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--error-color, #ef4444)',
                cursor: 'pointer',
                padding: '4px 8px',
              }}
            >
              Dismiss
            </button>
          </div>
        )}

        <Gallery
          generations={project.generations}
          imagesBasePath={filePath.replace('.imgproj', '.imgproj.images')}
          onEditPrompt={handleEditPrompt}
          theme={theme}
        />
        <BottomBar
          defaultStyle={project.settings.defaultStyle}
          defaultAspectRatio={project.settings.defaultAspectRatio || '1:1'}
          defaultVariations={project.settings.variationsPerPrompt}
          isGenerating={isGenerating}
          onGenerate={handleGenerate}
          theme={theme}
        />
      </div>
    );
  }
);
