/**
 * Custom hook for managing file operations in the editor.
 * Handles file service state, file operations, and dirty tracking.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { LexicalEditor } from 'lexical';
import { $convertFromMarkdownString, $convertToMarkdownString } from '@lexical/markdown';
import { $getRoot } from 'lexical';
import { PLAYGROUND_TRANSFORMERS } from '../plugins/MarkdownTransformers';
import { FileService } from '../FileService';
import { EditorConfig } from '../EditorConfig';

export interface UseFileOperationsProps {
  editor: LexicalEditor;
  config: EditorConfig;
}

export interface FileOperationsState {
  internalFileService: FileService | null;
  currentFileName: string | null;
  isDirty: boolean;
  lastSaved: Date | null;
  isLoading: boolean;
}

export interface FileOperations {
  handleNewFile: () => void;
  handleOpenFile: () => Promise<void>;
  handleSaveAs: () => Promise<void>;
  saveContent: (content: string, forceManualSave?: boolean) => Promise<void>;
  getMarkdownContent: () => string;
}

export function useFileOperations({ editor, config }: UseFileOperationsProps) {
  const [internalFileService, setInternalFileService] = useState<FileService | null>(null);
  const [currentFileName, setCurrentFileName] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [lastSavedContent, setLastSavedContent] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Helper function to extract markdown content
  const getMarkdownContent = useCallback(() => {
    return editor.read(() => {
      const markdown = $convertToMarkdownString(PLAYGROUND_TRANSFORMERS, undefined, true);
      // remove frontmatter
      const frontmatterRegex = /^---\s*\n(?:.*\n)*?---\s*\n/;
      const markdownWithoutFrontmatter = markdown.replace(frontmatterRegex, '');
      return markdownWithoutFrontmatter;
    });
  }, [editor]);

  // Provide getContent function to parent component
  useEffect(() => {
    if (config.onGetContent) {
      config.onGetContent(getMarkdownContent);
    }
  }, [config.onGetContent, getMarkdownContent]);

  // Auto-save functionality
  const saveContent = useCallback(async (content: string, forceManualSave = false) => {
    if (!internalFileService) {
      // No file service - create one with showSaveFilePicker if this is a manual save
      if (!forceManualSave) return;
      
      if (!('showSaveFilePicker' in window)) {
        alert('File System Access API not supported in this browser');
        return;
      }

      try {
        const fileHandle = await (window as any).showSaveFilePicker({
          suggestedName: 'document.md',
          types: [
            {
              description: 'Markdown files',
              accept: { 'text/markdown': ['.md'] },
            },
          ],
        });

        const writable = await fileHandle.createWritable();
        await writable.write(content);
        await writable.close();

        // Create a file service for future saves to this file
        const newFileService = {
          canAutoSave: false,
          canAutoLoad: false,
          
          getCurrentFileName() {
            return fileHandle.name;
          },
          
          async loadFile() {
            const file = await fileHandle.getFile();
            return await file.text();
          },
          
          async saveFile(content: string) {
            const writable = await fileHandle.createWritable();
            await writable.write(content);
            await writable.close();
          }
        };

        // Store the file service internally
        setInternalFileService(newFileService);
        setCurrentFileName(fileHandle.name);
        setLastSavedContent(content);
        setIsDirty(false);
      } catch (error) {
        console.error('Failed to save file:', error);
        if (error.name !== 'AbortError') {
          alert('Failed to save file');
        }
      }
      return;
    }

    // Only check canAutoSave for automatic saves, not manual saves
    if (!forceManualSave && !internalFileService.canAutoSave) return;

    try {
      await internalFileService.saveFile(content);
      setLastSaved(new Date());
      setLastSavedContent(content);
      setIsDirty(false);
    } catch (error) {
      console.error('Failed to save file:', error);
    }
  }, [internalFileService]);

  // File operations
  const handleNewFile = useCallback(() => {
    setInternalFileService(null);
    setCurrentFileName(null);
    setLastSavedContent('');
    setIsDirty(false);
    editor.update(() => {
      const root = $getRoot();
      root.clear();
    });
  }, [editor]);

  const handleOpenFile = useCallback(async () => {
    try {
      if (!('showOpenFilePicker' in window)) {
        alert('File System Access API not supported in this browser');
        return;
      }

      const [fileHandle] = await (window as any).showOpenFilePicker({
        types: [
          {
            description: 'Markdown files',
            accept: { 'text/markdown': ['.md'] },
          },
        ],
      });

      const file = await fileHandle.getFile();
      const content = await file.text();

      // Create file service for this file
      const newFileService = {
        canAutoSave: false,
        canAutoLoad: false,
        
        getCurrentFileName() {
          return fileHandle.name;
        },
        
        async loadFile() {
          const file = await fileHandle.getFile();
          return await file.text();
        },
        
        async saveFile(content: string) {
          const writable = await fileHandle.createWritable();
          await writable.write(content);
          await writable.close();
        }
      };

      // Load content into editor
      editor.update(() => {
        const root = $getRoot();
        root.clear();
        if (content.trim()) {
          $convertFromMarkdownString(content, PLAYGROUND_TRANSFORMERS, undefined, true);
        }
      });

      setInternalFileService(newFileService);
      setCurrentFileName(fileHandle.name);
      setLastSavedContent(content);
      setIsDirty(false);
    } catch (error) {
      console.error('Failed to open file:', error);
      if (error.name !== 'AbortError') {
        alert('Failed to open file');
      }
    }
  }, [editor]);

  const handleSaveAs = useCallback(async () => {
    const content = getMarkdownContent();
    await saveContent(content, true); // This will show the save picker
  }, [getMarkdownContent, saveContent]);

  // Provide save function to parent component
  useEffect(() => {
    if (config.onSave) {
      const manualSave = async () => {
        const content = getMarkdownContent();
        await saveContent(content, true);
      };
      config.onSave(manualSave);
    }
  }, [config.onSave, getMarkdownContent, saveContent]);

  // Handle content changes
  useEffect(() => {
    const removeUpdateListener = editor.registerUpdateListener(({dirtyElements, dirtyLeaves}) => {
      // Only trigger save if there are actual changes
      if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return;

      const content = getMarkdownContent();

      // Call onChange callback if provided
      if (config.onContentChange) {
        config.onContentChange(content);
      }

      // Check if content has changed since last save
      if (content !== lastSavedContent) {
        setIsDirty(true);
      }

      // Schedule auto-save for services that support it
      if (internalFileService?.canAutoSave && config.autoSaveInterval) {
        // Clear existing timeout
        if (autoSaveTimeoutRef.current) {
          clearTimeout(autoSaveTimeoutRef.current);
        }

        // Schedule new auto-save
        autoSaveTimeoutRef.current = setTimeout(() => {
          saveContent(content);
        }, config.autoSaveInterval);
      }
    });

    return () => {
      removeUpdateListener();
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
    };
  }, [editor, internalFileService, config.onContentChange, config.autoSaveInterval, saveContent, getMarkdownContent, lastSavedContent]);

  // Handle save on tab blur/visibility change
  useEffect(() => {
    if (!config.fileService) return;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        const content = getMarkdownContent();
        saveContent(content, true); // Force save when tab becomes hidden
      }
    };

    const handleBeforeUnload = () => {
      const content = getMarkdownContent();
      saveContent(content, true); // Force save before page unload
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [config.fileService, saveContent, getMarkdownContent]);

  const state: FileOperationsState = {
    internalFileService,
    currentFileName,
    isDirty,
    lastSaved,
    isLoading,
  };

  const operations: FileOperations = {
    handleNewFile,
    handleOpenFile,
    handleSaveAs,
    saveContent,
    getMarkdownContent,
  };

  return { state, operations };
}