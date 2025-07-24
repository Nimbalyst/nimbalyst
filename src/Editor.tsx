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

  // Load file content if initialContent is provided or if fileService supports auto-loading (but not both)
  useEffect(() => {
    const hasInitialContent = config.initialContent !== undefined;
    const shouldAutoLoad = config.fileService?.canAutoLoad && !hasInitialContent;

    if (!shouldAutoLoad && !hasInitialContent) return;

    const loadFile = async () => {
      try {
        setIsLoading(true);

        let content = '';
        if (hasInitialContent) {
          content = config.initialContent!;
        } else if (shouldAutoLoad && config.fileService) {
          content = await config.fileService.loadFile();
        }

        editor.update(() => {
          const root = $getRoot();
          root.clear();
          if (content.trim()) {
            $convertFromMarkdownString(content, PLAYGROUND_TRANSFORMERS, undefined, true);
          }
        });

        // Only update file name if we're auto-loading (not when initialContent is provided)
        if (shouldAutoLoad && config.onFileNameChange && config.fileService) {
          config.onFileNameChange(config.fileService.getCurrentFileName());
        }
      } catch (error) {
        console.error('Failed to load file:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadFile();
  }, [config.fileService, config.initialContent, editor, config.onFileNameChange]);

  // Auto-save functionality
  const saveContent = useCallback(async (content: string, forceManualSave = false) => {
    if (!config.fileService) return;

    // Only check canAutoSave for automatic saves, not manual saves
    if (!forceManualSave && !config.fileService.canAutoSave) return;

    try {
      await config.fileService.saveFile(content);
      setLastSaved(new Date());
    } catch (error) {
      console.error('Failed to save file:', error);
    }
  }, [config.fileService]);

  // Handle content changes and trigger auto-save
  useEffect(() => {
    if (!config.fileService) return;

    const removeUpdateListener = editor.registerUpdateListener(({dirtyElements, dirtyLeaves}) => {
      // Only trigger save if there are actual changes
      if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return;

      const content = getMarkdownContent();

      // Call onChange callback if provided
      if (config.onContentChange) {
        config.onContentChange(content);
      }

      // Schedule auto-save for services that support it
      if (config.fileService.canAutoSave && config.autoSaveInterval) {
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
  }, [editor, config.fileService, config.onContentChange, config.autoSaveInterval, saveContent, getMarkdownContent]);

  // Handle Cmd+S / Ctrl+S for manual save
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 's') {
        event.preventDefault();

        if (config.fileService) {
          const content = getMarkdownContent();
          saveContent(content, true); // forceManualSave = true
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [config.fileService, saveContent, getMarkdownContent]);

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
