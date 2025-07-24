/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import type {JSX} from 'react';

import {AutoFocusPlugin} from '@lexical/react/LexicalAutoFocusPlugin';
import {CharacterLimitPlugin} from '@lexical/react/LexicalCharacterLimitPlugin';
import {CheckListPlugin} from '@lexical/react/LexicalCheckListPlugin';
import {ClearEditorPlugin} from '@lexical/react/LexicalClearEditorPlugin';
import {ClickableLinkPlugin} from '@lexical/react/LexicalClickableLinkPlugin';
import {CollaborationPlugin} from '@lexical/react/LexicalCollaborationPlugin';
import {useLexicalComposerContext} from '@lexical/react/LexicalComposerContext';
import {LexicalErrorBoundary} from '@lexical/react/LexicalErrorBoundary';
import {HashtagPlugin} from '@lexical/react/LexicalHashtagPlugin';
import {HistoryPlugin} from '@lexical/react/LexicalHistoryPlugin';
import {HorizontalRulePlugin} from '@lexical/react/LexicalHorizontalRulePlugin';
import {ListPlugin} from '@lexical/react/LexicalListPlugin';
import {PlainTextPlugin} from '@lexical/react/LexicalPlainTextPlugin';
import {RichTextPlugin} from '@lexical/react/LexicalRichTextPlugin';
import {SelectionAlwaysOnDisplay} from '@lexical/react/LexicalSelectionAlwaysOnDisplay';
import {TabIndentationPlugin} from '@lexical/react/LexicalTabIndentationPlugin';
import {TablePlugin} from '@lexical/react/LexicalTablePlugin';
import {useLexicalEditable} from '@lexical/react/useLexicalEditable';
import {CAN_USE_DOM} from '@lexical/utils';
import * as React from 'react';
import {useCallback, useEffect, useRef, useState} from 'react';

import {$convertFromMarkdownString, $convertToMarkdownString} from '@lexical/markdown';
import {$getRoot} from 'lexical';

import {createWebsocketProvider} from './collaboration';
import {DEFAULT_EDITOR_CONFIG, type EditorConfig} from './EditorConfig';
import {useSharedHistoryContext} from './context/SharedHistoryContext';
import {PLAYGROUND_TRANSFORMERS} from './plugins/MarkdownTransformers';
import ActionsPlugin from './plugins/ActionsPlugin';
import AutocompletePlugin from './plugins/AutocompletePlugin';
import AutoEmbedPlugin from './plugins/AutoEmbedPlugin';
import AutoLinkPlugin from './plugins/AutoLinkPlugin';
import CodeActionMenuPlugin from './plugins/CodeActionMenuPlugin';
import CodeHighlightPrismPlugin from './plugins/CodeHighlightPrismPlugin';
import CodeHighlightShikiPlugin from './plugins/CodeHighlightShikiPlugin';
import CollapsiblePlugin from './plugins/CollapsiblePlugin';
import CommentPlugin from './plugins/CommentPlugin';
import ComponentPickerPlugin from './plugins/ComponentPickerPlugin';
import ContextMenuPlugin from './plugins/ContextMenuPlugin';
import DragDropPaste from './plugins/DragDropPastePlugin';
import DraggableBlockPlugin from './plugins/DraggableBlockPlugin';
import EmojiPickerPlugin from './plugins/EmojiPickerPlugin';
import EmojisPlugin from './plugins/EmojisPlugin';
import EquationsPlugin from './plugins/EquationsPlugin';
import ExcalidrawPlugin from './plugins/ExcalidrawPlugin';
import FigmaPlugin from './plugins/FigmaPlugin';
import FloatingLinkEditorPlugin from './plugins/FloatingLinkEditorPlugin';
import FloatingTextFormatToolbarPlugin from './plugins/FloatingTextFormatToolbarPlugin';
import ImagesPlugin from './plugins/ImagesPlugin';
import InlineImagePlugin from './plugins/InlineImagePlugin';
import KeywordsPlugin from './plugins/KeywordsPlugin';
import {LayoutPlugin} from './plugins/LayoutPlugin/LayoutPlugin';
import LinkPlugin from './plugins/LinkPlugin';
import MarkdownShortcutPlugin from './plugins/MarkdownShortcutPlugin';
import {MaxLengthPlugin} from './plugins/MaxLengthPlugin';
import MentionsPlugin from './plugins/MentionsPlugin';
import PageBreakPlugin from './plugins/PageBreakPlugin';
import PollPlugin from './plugins/PollPlugin';
import ShortcutsPlugin from './plugins/ShortcutsPlugin';
import SpecialTextPlugin from './plugins/SpecialTextPlugin';
import SpeechToTextPlugin from './plugins/SpeechToTextPlugin';
import TabFocusPlugin from './plugins/TabFocusPlugin';
import TableCellActionMenuPlugin from './plugins/TableActionMenuPlugin';
import TableCellResizer from './plugins/TableCellResizer';
import TableHoverActionsPlugin from './plugins/TableHoverActionsPlugin';
import TableOfContentsPlugin from './plugins/TableOfContentsPlugin';
import ToolbarPlugin from './plugins/ToolbarPlugin';
import TreeViewPlugin from './plugins/TreeViewPlugin';
import TwitterPlugin from './plugins/TwitterPlugin';
import YouTubePlugin from './plugins/YouTubePlugin';
import ContentEditable from './ui/ContentEditable';

const skipCollaborationInit =
  // @ts-expect-error
  window.parent != null && window.parent.frames.right === window;

interface EditorProps {
  config?: EditorConfig;
}

export default function Editor({config = DEFAULT_EDITOR_CONFIG}: EditorProps): JSX.Element {
  const {historyState} = useSharedHistoryContext();
  const {
    isCodeHighlighted,
    isCodeShiki,
    isCollab,
    isAutocomplete,
    isMaxLength,
    isCharLimit,
    hasLinkAttributes,
    isCharLimitUtf8,
    isRichText,
    showTreeView,
    showTableOfContents,
    shouldUseLexicalContextMenu,
    shouldPreserveNewLinesInMarkdown,
    tableCellMerge,
    tableCellBackgroundColor,
    tableHorizontalScroll,
    shouldAllowHighlightingWithBrackets,
    selectionAlwaysOnDisplay,
    listStrictIndent,
  } = config;
  const isEditable = useLexicalEditable();
  const placeholder = isCollab
    ? 'Enter some collaborative rich text...'
    : isRichText
    ? 'Enter some rich text...'
    : 'Enter some plain text...';
  const [floatingAnchorElem, setFloatingAnchorElem] =
    useState<HTMLDivElement | null>(null);
  const [isSmallWidthViewport, setIsSmallWidthViewport] =
    useState<boolean>(false);
  const [editor] = useLexicalComposerContext();
  const [activeEditor, setActiveEditor] = useState(editor);
  const [isLinkEditMode, setIsLinkEditMode] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [internalFileService, setInternalFileService] = useState<FileService | null>(null);
  const [currentFileName, setCurrentFileName] = useState<string | null>(null);
  const [showFileMenu, setShowFileMenu] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [lastSavedContent, setLastSavedContent] = useState<string>('');

  const onRef = (_floatingAnchorElem: HTMLDivElement) => {
    if (_floatingAnchorElem !== null) {
      setFloatingAnchorElem(_floatingAnchorElem);
    }
  };

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


  // Load initial content if provided
  useEffect(() => {
    if (!config.initialContent) return;

    editor.update(() => {
      const root = $getRoot();
      root.clear();
      if (config.initialContent.trim()) {
        $convertFromMarkdownString(config.initialContent, PLAYGROUND_TRANSFORMERS, undefined, true);
      }
    });
  }, [config.initialContent, editor]);

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
  const handleNewFile = () => {
    setInternalFileService(null);
    setCurrentFileName(null);
    setLastSavedContent('');
    setIsDirty(false);
    editor.update(() => {
      const root = $getRoot();
      root.clear();
    });
  };

  const handleOpenFile = async () => {
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
  };

  const handleSaveAs = async () => {
    const content = getMarkdownContent();
    await saveContent(content, true); // This will show the save picker
  };

  // Helper function for keyboard shortcut display
  const getShortcutDisplay = (key: string, shift = false) => {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const modifier = isMac ? '⌘' : 'Ctrl+';
    const shiftKey = shift ? (isMac ? '⇧' : 'Shift+') : '';
    return `${modifier}${shiftKey}${key.toUpperCase()}`;
  };

  // Close file menu on escape, click outside, or item click
  useEffect(() => {
    if (!showFileMenu) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowFileMenu(false);
      }
    };

    const handleClickOutside = (event: MouseEvent) => {
      setShowFileMenu(false);
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('click', handleClickOutside);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('click', handleClickOutside);
    };
  }, [showFileMenu]);

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

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const cmdOrCtrl = isMac ? event.metaKey : event.ctrlKey;

      if (cmdOrCtrl && event.key === 's') {
        event.preventDefault();
        const content = getMarkdownContent();
        saveContent(content, true);
      } else if (cmdOrCtrl && event.shiftKey && event.key.toLowerCase() === 's') {
        event.preventDefault();
        handleSaveAs();
      } else if (cmdOrCtrl && event.key === 'n') {
        event.preventDefault();
        handleNewFile();
      } else if (cmdOrCtrl && event.key === 'o') {
        event.preventDefault();
        handleOpenFile();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [saveContent, getMarkdownContent, handleSaveAs, handleNewFile, handleOpenFile]);

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

  useEffect(() => {
    const updateViewPortWidth = () => {
      const isNextSmallWidthViewport =
        CAN_USE_DOM && window.matchMedia('(max-width: 1025px)').matches;

      if (isNextSmallWidthViewport !== isSmallWidthViewport) {
        setIsSmallWidthViewport(isNextSmallWidthViewport);
      }
    };
    updateViewPortWidth();
    window.addEventListener('resize', updateViewPortWidth);

    return () => {
      window.removeEventListener('resize', updateViewPortWidth);
    };
  }, [isSmallWidthViewport]);

  return (
    <>
      {/* File Menu */}
      <div style={{
        padding: '8px 16px',
        backgroundColor: 'var(--bg-secondary, #f8f9fa)',
        borderBottom: '1px solid var(--border-color, #e9ecef)',
        display: 'flex',
        alignItems: 'center',
        fontSize: '14px',
        position: 'relative'
      }}>
        <div style={{ position: 'relative' }}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowFileMenu(!showFileMenu);
            }}
            style={{
              background: 'none',
              border: 'none',
              padding: '4px 8px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '14px',
              fontWeight: 'bold',
              color: 'var(--text-primary, #333)',
              borderRadius: '4px'
            }}
          >
            <i className="file-text" />
            {currentFileName || 'Untitled'}{isDirty && <span style={{ color: 'var(--text-danger, #dc3545)' }}>•</span>}
            <i className="chevron-down" />
          </button>

          {showFileMenu && (
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                backgroundColor: 'var(--bg-primary, white)',
                border: '1px solid var(--border-color, #ccc)',
                borderRadius: '4px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                zIndex: 1000,
                minWidth: '200px',
                overflow: 'hidden'
              }}>
              <div
                onClick={() => { handleNewFile(); setShowFileMenu(false); }}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  width: '90%',
                  padding: '6px 12px',
                  border: 'none',
                  background: 'none',
                  textAlign: 'left',
                  cursor: 'pointer',
                  color: 'var(--text-primary, #333)',
                  fontSize: '13px'
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-hover, #f0f0f0)'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                <span>New</span>
                <span style={{ fontSize: '11px', color: 'var(--text-secondary, #666)', marginLeft: '16px' }}>{getShortcutDisplay('N')}</span>
              </div>
              <div
                onClick={() => { handleOpenFile(); setShowFileMenu(false); }}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  width: '90%',
                  padding: '6px 12px',
                  border: 'none',
                  background: 'none',
                  textAlign: 'left',
                  cursor: 'pointer',
                  color: 'var(--text-primary, #333)',
                  fontSize: '13px'
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-hover, #f0f0f0)'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                <span>Open...</span>
                <span style={{ fontSize: '11px', color: 'var(--text-secondary, #666)', marginLeft: '16px' }}>{getShortcutDisplay('O')}</span>
              </div>
              <hr style={{ margin: '4px 0', border: 'none', borderTop: '1px solid var(--border-color, #eee)' }} />
              <div
                onClick={() => {
                  if (internalFileService) {
                    const content = getMarkdownContent();
                    saveContent(content, true);
                  } else {
                    handleSaveAs();
                  }
                  setShowFileMenu(false);
                }}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  width: '90%',
                  padding: '6px 12px',
                  border: 'none',
                  background: 'none',
                  textAlign: 'left',
                  cursor: 'pointer',
                  color: 'var(--text-primary, #333)',
                  fontSize: '13px'
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-hover, #f0f0f0)'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                <span>Save</span>
                <span style={{ fontSize: '11px', color: 'var(--text-secondary, #666)', marginLeft: '16px' }}>{getShortcutDisplay('S')}</span>
              </div>
              <div
                onClick={() => { handleSaveAs(); setShowFileMenu(false); }}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  width: '90%',
                  padding: '6px 12px',
                  border: 'none',
                  background: 'none',
                  textAlign: 'left',
                  cursor: 'pointer',
                  color: 'var(--text-primary, #333)',
                  fontSize: '13px'
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-hover, #f0f0f0)'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                <span>Save As...</span>
                <span style={{ fontSize: '11px', color: 'var(--text-secondary, #666)', marginLeft: '16px' }}>{getShortcutDisplay('S', true)}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {isRichText && (
        <ToolbarPlugin
          editor={editor}
          activeEditor={activeEditor}
          setActiveEditor={setActiveEditor}
          setIsLinkEditMode={setIsLinkEditMode}
        />
      )}
      {isRichText && (
        <ShortcutsPlugin
          editor={activeEditor}
          setIsLinkEditMode={setIsLinkEditMode}
        />
      )}
      {isLoading && (
        <div className="editor-loading">
          Loading file...
        </div>
      )}
      <div
        className={`editor-container ${showTreeView ? 'tree-view' : ''} ${
          !isRichText ? 'plain-text' : ''
        } ${isLoading ? 'loading' : ''}`}>
        {isMaxLength && <MaxLengthPlugin maxLength={30} />}
        <DragDropPaste />
        <AutoFocusPlugin />
        {selectionAlwaysOnDisplay && <SelectionAlwaysOnDisplay />}
        <ClearEditorPlugin />
        <ComponentPickerPlugin />
        <EmojiPickerPlugin />
        <AutoEmbedPlugin />
        <MentionsPlugin />
        <EmojisPlugin />
        <HashtagPlugin />
        <KeywordsPlugin />
        <SpeechToTextPlugin />
        <AutoLinkPlugin />
        {/*<CommentPlugin*/}
        {/*  providerFactory={isCollab ? createWebsocketProvider : undefined}*/}
        {/*/>*/}
        {isRichText ? (
          <>
            {isCollab ? (
              <CollaborationPlugin
                id="main"
                providerFactory={createWebsocketProvider}
                shouldBootstrap={!skipCollaborationInit}
              />
            ) : (
              <HistoryPlugin externalHistoryState={historyState} />
            )}
            <RichTextPlugin
              contentEditable={
                <div className="editor-scroller">
                  <div className="editor" ref={onRef}>
                    <ContentEditable placeholder={placeholder} />
                  </div>
                </div>
              }
              ErrorBoundary={LexicalErrorBoundary}
            />
            <MarkdownShortcutPlugin />
            {isCodeHighlighted &&
              (isCodeShiki ? (
                <CodeHighlightShikiPlugin />
              ) : (
                <CodeHighlightPrismPlugin />
              ))}
            <ListPlugin hasStrictIndent={listStrictIndent} />
            <CheckListPlugin />
            <TablePlugin
              hasCellMerge={tableCellMerge}
              hasCellBackgroundColor={tableCellBackgroundColor}
              hasHorizontalScroll={tableHorizontalScroll}
            />
            <TableCellResizer />
            <ImagesPlugin />
            <InlineImagePlugin />
            <LinkPlugin hasLinkAttributes={hasLinkAttributes} />
            <PollPlugin />
            <TwitterPlugin />
            <YouTubePlugin />
            <FigmaPlugin />
            <ClickableLinkPlugin disabled={isEditable} />
            <HorizontalRulePlugin />
            <EquationsPlugin />
            <ExcalidrawPlugin />
            <TabFocusPlugin />
            <TabIndentationPlugin maxIndent={7} />
            <CollapsiblePlugin />
            <PageBreakPlugin />
            <LayoutPlugin />
            {floatingAnchorElem && (
              <>
                <FloatingLinkEditorPlugin
                  anchorElem={floatingAnchorElem}
                  isLinkEditMode={isLinkEditMode}
                  setIsLinkEditMode={setIsLinkEditMode}
                />
                <TableCellActionMenuPlugin
                  anchorElem={floatingAnchorElem}
                  cellMerge={true}
                />
              </>
            )}
            {floatingAnchorElem && !isSmallWidthViewport && (
              <>
                <DraggableBlockPlugin anchorElem={floatingAnchorElem} />
                <CodeActionMenuPlugin anchorElem={floatingAnchorElem} />
                <TableHoverActionsPlugin anchorElem={floatingAnchorElem} />
                <FloatingTextFormatToolbarPlugin
                  anchorElem={floatingAnchorElem}
                  setIsLinkEditMode={setIsLinkEditMode}
                />
              </>
            )}
          </>
        ) : (
          <>
            <PlainTextPlugin
              contentEditable={<ContentEditable placeholder={placeholder} />}
              ErrorBoundary={LexicalErrorBoundary}
            />
            <HistoryPlugin externalHistoryState={historyState} />
          </>
        )}
        {(isCharLimit || isCharLimitUtf8) && (
          <CharacterLimitPlugin
            charset={isCharLimit ? 'UTF-16' : 'UTF-8'}
            maxLength={5}
          />
        )}
        {isAutocomplete && <AutocompletePlugin />}
        <div>{showTableOfContents && <TableOfContentsPlugin />}</div>
        {shouldUseLexicalContextMenu && <ContextMenuPlugin />}
        {shouldAllowHighlightingWithBrackets && <SpecialTextPlugin />}
        {/*<ActionsPlugin*/}
        {/*  isRichText={isRichText}*/}
        {/*  shouldPreserveNewLinesInMarkdown={shouldPreserveNewLinesInMarkdown}*/}
        {/*/>*/}
      </div>
      {showTreeView && <TreeViewPlugin />}
    </>
  );
}
