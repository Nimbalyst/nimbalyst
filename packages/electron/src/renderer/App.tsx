import React, { useEffect, useState, useCallback, useRef } from 'react';
import { StravuEditor } from 'stravu-editor';
import 'stravu-editor/styles';

// Electron API interface
interface ElectronAPI {
  onFileNew: (callback: () => void) => () => void;
  onFileOpen: (callback: () => void) => () => void;
  onFileSave: (callback: () => void) => () => void;
  onFileSaveAs: (callback: () => void) => () => void;
  onFileOpenedFromOS: (callback: (data: { filePath: string; content: string }) => void) => () => void;
  openFile: () => Promise<{ filePath: string; content: string } | null>;
  saveFile: (content: string) => Promise<{ success: boolean; filePath: string } | null>;
  saveFileAs: (content: string) => Promise<{ success: boolean; filePath: string } | null>;
  setDocumentEdited: (edited: boolean) => void;
  setTitle: (title: string) => void;
  setCurrentFile: (filePath: string | null) => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}


export default function App() {
  console.log('App component rendering');
  const [content, setContent] = useState('');
  const [currentFilePath, setCurrentFilePath] = useState<string | null>(null);
  const [currentFileName, setCurrentFileName] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const getContentRef = useRef<(() => string) | null>(null);
  const initialContentRef = useRef<string>('');

  // Handle new file
  const handleNew = useCallback(() => {
    setContent('');
    setCurrentFilePath(null);
    setCurrentFileName(null);
    setIsDirty(false);
    initialContentRef.current = '';
    // Notify main process to clear file path
    if (window.electronAPI) {
      window.electronAPI.setCurrentFile(null);
    }
  }, []);

  // Handle open file
  const handleOpen = useCallback(async () => {
    if (!window.electronAPI) return;
    
    try {
      const result = await window.electronAPI.openFile();
      if (result) {
        setContent(result.content);
        setCurrentFilePath(result.filePath);
        setCurrentFileName(result.filePath.split('/').pop() || result.filePath);
        setIsDirty(false);
        initialContentRef.current = result.content;
        // Notify main process about the file path
        window.electronAPI.setCurrentFile(result.filePath);
      }
    } catch (error) {
      console.error('Failed to open file:', error);
    }
  }, []);

  // Handle save as
  const handleSaveAs = useCallback(async () => {
    console.log('handleSaveAs called');
    if (!window.electronAPI || !getContentRef.current) return;
    
    const content = getContentRef.current();
    
    try {
      console.log('Calling electronAPI.saveFileAs');
      const result = await window.electronAPI.saveFileAs(content);
      console.log('Save as result:', result);
      if (result) {
        console.log('Setting current file path to:', result.filePath);
        setCurrentFilePath(result.filePath);
        setCurrentFileName(result.filePath.split('/').pop() || result.filePath);
        setIsDirty(false);
        initialContentRef.current = content;
      }
    } catch (error) {
      console.error('Failed to save file as:', error);
    }
  }, []);

  // Handle save
  const handleSave = useCallback(async () => {
    console.log('handleSave called, currentFilePath:', currentFilePath);
    if (!window.electronAPI || !getContentRef.current) return;
    
    const content = getContentRef.current();
    console.log('Saving content:', { contentLength: content.length, hasFilePath: !!currentFilePath, currentFilePath });
    
    if (!currentFilePath) {
      console.log('No file path, triggering save as');
      // No file loaded, for Cmd+S we should trigger save as
      // This matches typical editor behavior
      await handleSaveAs();
      return;
    }
    
    try {
      console.log('Calling electronAPI.saveFile');
      const result = await window.electronAPI.saveFile(content);
      console.log('Save result:', result);
      if (result) {
        setCurrentFilePath(result.filePath);
        setCurrentFileName(result.filePath.split('/').pop() || result.filePath);
        setIsDirty(false);
        initialContentRef.current = content;
        console.log('File saved successfully');
      } else {
        console.log('Save returned null - no current file in main process');
      }
    } catch (error) {
      console.error('Failed to save file:', error);
    }
  }, [currentFilePath, handleSaveAs]);

  // Update window title and dirty state
  useEffect(() => {
    if (!window.electronAPI) return;
    
    const title = currentFileName 
      ? `${currentFileName}${isDirty ? ' •' : ''} - Stravu Editor`
      : 'Stravu Editor';
    
    window.electronAPI.setTitle(title);
    window.electronAPI.setDocumentEdited(isDirty);
  }, [currentFileName, isDirty]);

  // Set up IPC listeners
  useEffect(() => {
    if (!window.electronAPI) return;
    
    console.log('Setting up IPC listeners, currentFilePath:', currentFilePath);
    
    // Set up listeners and store cleanup functions
    const cleanupFns: Array<() => void> = [];
    
    cleanupFns.push(window.electronAPI.onFileNew(handleNew));
    cleanupFns.push(window.electronAPI.onFileOpen(handleOpen));
    cleanupFns.push(window.electronAPI.onFileSave(handleSave));
    cleanupFns.push(window.electronAPI.onFileSaveAs(handleSaveAs));
    cleanupFns.push(window.electronAPI.onFileOpenedFromOS((data) => {
      console.log('File opened from OS:', data.filePath);
      setContent(data.content);
      setCurrentFilePath(data.filePath);
      setCurrentFileName(data.filePath.split('/').pop() || data.filePath);
      setIsDirty(false);
      initialContentRef.current = data.content;
    }));
    
    // Clean up listeners when dependencies change
    return () => {
      console.log('Cleaning up IPC listeners');
      cleanupFns.forEach(cleanup => cleanup());
    };
  }, [handleNew, handleOpen, handleSave, handleSaveAs]);

  // Handle drag and drop
  useEffect(() => {
    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    
    const handleDrop = async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        const file = files[0];
        // Check if it's a markdown file
        if (file.name.endsWith('.md') || file.name.endsWith('.markdown') || file.type === 'text/markdown') {
          // In Electron, we can access the path property
          const filePath = (file as any).path;
          if (filePath && window.electronAPI) {
            // Use the same logic as opening a file
            try {
              const text = await file.text();
              setContent(text);
              setCurrentFilePath(filePath);
              setCurrentFileName(file.name);
              setIsDirty(false);
              initialContentRef.current = text;
              // Notify main process about the file path
              window.electronAPI.setCurrentFile(filePath);
              console.log('File dropped with path:', filePath);
            } catch (error) {
              console.error('Error reading dropped file:', error);
            }
          } else {
            // Fallback for non-Electron or no path
            try {
              const text = await file.text();
              setContent(text);
              setCurrentFilePath(null); // Will need to save-as
              setCurrentFileName(file.name);
              setIsDirty(false);
              initialContentRef.current = text;
              console.log('File dropped (no path):', file.name);
            } catch (error) {
              console.error('Error reading dropped file:', error);
            }
          }
        } else {
          console.log('Not a markdown file:', file.name, file.type);
        }
      }
    };
    
    document.addEventListener('dragover', handleDragOver);
    document.addEventListener('drop', handleDrop);
    
    return () => {
      document.removeEventListener('dragover', handleDragOver);
      document.removeEventListener('drop', handleDrop);
    };
  }, []);

  console.log('Rendering App with config:', {
    contentLength: content.length,
    currentFileName
  });

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <StravuEditor
        config={{
          initialContent: content,
          onContentChange: (newContent) => {
            console.log('Content changed:', newContent.length);
            // Check if content actually changed from initial
            if (getContentRef.current) {
              const currentContent = getContentRef.current();
              const hasChanged = currentContent !== initialContentRef.current;
              if (hasChanged !== isDirty) {
                setIsDirty(hasChanged);
              }
            }
          },
          onGetContent: (getContentFn) => {
            console.log('Received getContent function');
            getContentRef.current = getContentFn;
          },
          isRichText: true,
          showTreeView: false,
        }}
      />
    </div>
  );
}