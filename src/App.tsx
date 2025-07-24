/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import type {JSX} from 'react';

import {LexicalComposer} from '@lexical/react/LexicalComposer';
import {useState, useEffect} from 'react';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isTextNode,
  DOMConversionMap,
  TextNode,
} from 'lexical';

import {DEFAULT_EDITOR_CONFIG, type EditorConfig} from './EditorConfig';
import {FlashMessageContext} from './context/FlashMessageContext';
import {SharedHistoryContext} from './context/SharedHistoryContext';
import {ThemeProvider} from './context/ThemeContext';
import {ToolbarContext} from './context/ToolbarContext';
import Editor from './Editor';
import {createFileService, type FileService} from './FileService';
import EditorNodes from './nodes/EditorNodes';
import {TableContext} from './plugins/TablePlugin';
import {parseAllowedFontSize} from './plugins/ToolbarPlugin/fontSize';
import PlaygroundEditorTheme from './themes/PlaygroundEditorTheme';
import {parseAllowedColor} from './ui/ColorPicker';

function $createEmptyEditor() {
  const root = $getRoot();
  if (root.getFirstChild() === null) {
    const paragraph = $createParagraphNode();
    root.append(paragraph);
  }
}

function getExtraStyles(element: HTMLElement): string {
  // Parse styles from pasted input, but only if they match exactly the
  // sort of styles that would be produced by exportDOM
  let extraStyles = '';
  const fontSize = parseAllowedFontSize(element.style.fontSize);
  const backgroundColor = parseAllowedColor(element.style.backgroundColor);
  const color = parseAllowedColor(element.style.color);
  if (fontSize !== '' && fontSize !== '15px') {
    extraStyles += `font-size: ${fontSize};`;
  }
  if (backgroundColor !== '' && backgroundColor !== 'rgb(255, 255, 255)') {
    extraStyles += `background-color: ${backgroundColor};`;
  }
  if (color !== '' && color !== 'rgb(0, 0, 0)') {
    extraStyles += `color: ${color};`;
  }
  return extraStyles;
}

function buildImportMap(): DOMConversionMap {
  const importMap: DOMConversionMap = {};

  // Wrap all TextNode importers with a function that also imports
  // the custom styles implemented by the playground
  for (const [tag, fn] of Object.entries(TextNode.importDOM() || {})) {
    importMap[tag] = (importNode) => {
      const importer = fn(importNode);
      if (!importer) {
        return null;
      }
      return {
        ...importer,
        conversion: (element) => {
          const output = importer.conversion(element);
          if (
            output === null ||
            output.forChild === undefined ||
            output.after !== undefined ||
            output.node !== null
          ) {
            return output;
          }
          const extraStyles = getExtraStyles(element);
          if (extraStyles) {
            const {forChild} = output;
            return {
              ...output,
              forChild: (child, parent) => {
                const textNode = forChild(child, parent);
                if ($isTextNode(textNode)) {
                  textNode.setStyle(textNode.getStyle() + extraStyles);
                }
                return textNode;
              },
            };
          }
          return output;
        },
      };
    };
  }

  return importMap;
}

interface StravaEditorProps {
  config?: EditorConfig;
}

function StravaEditor({config = DEFAULT_EDITOR_CONFIG}: StravaEditorProps): JSX.Element {
  const initialConfig = {
    editorState: config.emptyEditor ? undefined : $createEmptyEditor,
    html: {import: buildImportMap()},
    namespace: 'StravaEditor',
    nodes: [...EditorNodes],
    onError: (error: Error) => {
      throw error;
    },
    theme: PlaygroundEditorTheme,
  };

  return (
    <ThemeProvider>
      <LexicalComposer initialConfig={initialConfig}>
        <SharedHistoryContext>
          <TableContext>
            <ToolbarContext>
              <div className="editor-shell">
                <Editor config={config} />
              </div>
            </ToolbarContext>
          </TableContext>
        </SharedHistoryContext>
      </LexicalComposer>
    </ThemeProvider>
  );
}

// Dev mode component with file operations
function DevModeEditor(): JSX.Element {
  const [currentFileName, setCurrentFileName] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [initialContent, setInitialContent] = useState<string>('');
  
  // Initialize file service and load content based on URL parameter
  const [fileService, setFileService] = useState<FileService | undefined>();
  
  // Initialize file service (but don't auto-load content or show filename)
  useEffect(() => {
    const initializeFileService = () => {
      // Clear any file parameters from URL since we're not auto-loading
      const url = new URL(window.location.href);
      url.searchParams.delete('file');
      window.history.replaceState({}, '', url.toString());
      
      // Default to draft.md service but don't show filename until loaded
      try {
        const service = createFileService({ type: 'opfs', fileName: 'draft.md' });
        setFileService(service);
        setCurrentFileName(null); // Don't show filename until file is actually loaded
        setInitialContent(''); // Start with empty content
      } catch (error) {
        console.warn('OPFS not available:', error);
      }
    };
    
    initializeFileService();
  }, []); // Empty dependency array - only run on mount

  // Update URL when file name changes
  const handleFileNameChange = (fileName: string | null) => {
    setCurrentFileName(fileName);
    
    const url = new URL(window.location.href);
    if (fileName && fileName !== 'draft.md') {
      url.searchParams.set('file', fileName);
    } else {
      url.searchParams.delete('file');
    }
    
    // Update URL without reloading the page
    window.history.replaceState({}, '', url.toString());
  };

  const handleOpenFile = async () => {
    try {
      const newFileService = createFileService({ type: 'web' });
      // Manually trigger the file load since it requires user gesture
      const content = await newFileService.loadFile();
      
      // Set both the service and the initial content
      setFileService(newFileService);
      setInitialContent(content);
      
      // Update the URL with the opened file name
      const fileName = newFileService.getCurrentFileName();
      if (fileName) {
        handleFileNameChange(fileName);
      }
    } catch (error) {
      console.error('Failed to open file:', error);
      if (error.name === 'SecurityError') {
        alert('File picker requires user interaction');
      } else {
        alert('File System Access API is not supported in this browser');
      }
    }
  };

  const handleSaveFile = async () => {
    if (!fileService || fileService.canAutoSave) return;
    
    try {
      // For web file service, this will trigger save dialog
      await fileService.saveFile(''); // Content will be provided by editor
    } catch (error) {
      console.error('Failed to save file:', error);
    }
  };

  const handleLoadFile = async () => {
    if (!fileService) return;
    
    try {
      const content = await fileService.loadFile();
      setInitialContent(content);
      
      // Only show filename and update URL when file is actually loaded
      const fileName = fileService.getCurrentFileName();
      if (fileName) {
        handleFileNameChange(fileName);
      }
    } catch (error) {
      console.error('Failed to load file:', error);
      alert('Failed to load file. File may not exist yet.');
    }
  };

  const handleNewFile = () => {
    const fileName = prompt('Enter file name (without extension):');
    if (fileName) {
      const fullFileName = fileName.endsWith('.md') ? fileName : `${fileName}.md`;
      try {
        const newFileService = createFileService({ type: 'opfs', fileName: fullFileName });
        setFileService(newFileService);
        setInitialContent(''); // Start with empty content
        handleFileNameChange(fullFileName);
      } catch (error) {
        console.error('Failed to create new file:', error);
      }
    }
  };

  const config: EditorConfig = {
    ...DEFAULT_EDITOR_CONFIG,
    fileService,
    initialContent,
    onFileNameChange: handleFileNameChange,
    onContentChange: (content) => {
      // Update last saved time for auto-save services
      if (fileService?.canAutoSave) {
        setLastSaved(new Date());
      }
    },
  };

  // Don't render editor until file service is initialized
  if (!fileService) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div>Initializing file service...</div>
      </div>
    );
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Dev mode toolbar */}
      <div style={{ 
        padding: '8px 16px', 
        backgroundColor: '#f5f5f5', 
        borderBottom: '1px solid #ddd',
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        fontSize: '14px'
      }}>
        <button onClick={handleNewFile}>
          New File
        </button>
        {fileService?.canAutoSave && (
          <button onClick={handleLoadFile} disabled={!fileService}>
            Load File
          </button>
        )}
        <button onClick={handleOpenFile}>
          Open File
        </button>
        {!fileService?.canAutoSave && (
          <button onClick={handleSaveFile} disabled={!fileService}>
            Save File
          </button>
        )}
        {currentFileName && (
          <span>
            <strong>File:</strong> {currentFileName}
          </span>
        )}
        {fileService?.canAutoSave && lastSaved && (
          <span style={{ color: '#666' }}>
            Auto-saved at {lastSaved.toLocaleTimeString()}
          </span>
        )}
        {!fileService && (
          <span style={{ color: '#999' }}>
            No file service available
          </span>
        )}
      </div>
      
      {/* Editor */}
      <div style={{ flex: 1 }}>
        <StravaEditor config={config} />
      </div>
    </div>
  );
}

// For development builds - fullscreen editor with file operations
export default function App(): JSX.Element {
  return (
    <ThemeProvider>
      <FlashMessageContext>
        <DevModeEditor />
      </FlashMessageContext>
    </ThemeProvider>
  );
}

// Export the main component for use in other projects  
export {StravaEditor};
