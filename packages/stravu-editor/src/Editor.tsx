/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import type { JSX } from 'react';
import React, { Suspense, useEffect, useState } from 'react';

import { AutoFocusPlugin } from '@lexical/react/LexicalAutoFocusPlugin';
import { CheckListPlugin } from '@lexical/react/LexicalCheckListPlugin';
import { ClearEditorPlugin } from '@lexical/react/LexicalClearEditorPlugin';
import { ClickableLinkPlugin } from '@lexical/react/LexicalClickableLinkPlugin';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { HashtagPlugin } from '@lexical/react/LexicalHashtagPlugin';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { HorizontalRulePlugin } from '@lexical/react/LexicalHorizontalRulePlugin';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { SelectionAlwaysOnDisplay } from '@lexical/react/LexicalSelectionAlwaysOnDisplay';
import { TabIndentationPlugin } from '@lexical/react/LexicalTabIndentationPlugin';
import { TablePlugin } from '@lexical/react/LexicalTablePlugin';
import { useLexicalEditable } from '@lexical/react/useLexicalEditable';
import { CAN_USE_DOM } from '@lexical/utils';

import { $convertFromMarkdownString, $convertToMarkdownString } from '@lexical/markdown';
import { $getRoot } from 'lexical';

import { DEFAULT_EDITOR_CONFIG, type EditorConfig } from './EditorConfig';
import { useSharedHistoryContext } from './context/SharedHistoryContext';
import { PLAYGROUND_TRANSFORMERS } from './plugins/MarkdownTransformers';
import AutoEmbedPlugin from './plugins/AutoEmbedPlugin';
import CodeActionMenuPlugin from './plugins/CodeActionMenuPlugin';
import CollapsiblePlugin from './plugins/CollapsiblePlugin';
import ComponentPickerPlugin from './plugins/ComponentPickerPlugin';
import DragDropPaste from './plugins/DragDropPastePlugin';
import DraggableBlockPlugin from './plugins/DraggableBlockPlugin';

// TODO: Should we keep emojis?
import EmojiPickerPlugin from './plugins/EmojiPickerPlugin';
import EmojisPlugin from './plugins/EmojisPlugin';

import FloatingLinkEditorPlugin from './plugins/FloatingLinkEditorPlugin';
import FloatingTextFormatToolbarPlugin from './plugins/FloatingTextFormatToolbarPlugin';
import ImagesPlugin from './plugins/ImagesPlugin';
import InlineImagePlugin from './plugins/InlineImagePlugin';
import { LayoutPlugin } from './plugins/LayoutPlugin/LayoutPlugin';
import LinkPlugin from './plugins/LinkPlugin';
import MarkdownShortcutPlugin from './plugins/MarkdownShortcutPlugin';
import PageBreakPlugin from './plugins/PageBreakPlugin';
import ShortcutsPlugin from './plugins/ShortcutsPlugin';
import SpeechToTextPlugin from './plugins/SpeechToTextPlugin';
import TabFocusPlugin from './plugins/TabFocusPlugin';
import TableCellActionMenuPlugin from './plugins/TableActionMenuPlugin';
import TableCellResizer from './plugins/TableCellResizer';
import TableHoverActionsPlugin from './plugins/TableHoverActionsPlugin';
import ToolbarPlugin from './plugins/ToolbarPlugin';
import TreeViewPlugin from './plugins/TreeViewPlugin';
import SearchReplacePlugin from './plugins/SearchReplacePlugin';
import ContentEditable from './ui/ContentEditable';
import { useRuntimeSettings } from './context/RuntimeSettingsContext';
import { PluginManager } from './plugins/PluginManager';
// Lazy load CodeHighlightShikiPlugin to improve initial load time
const CodeHighlightShikiPlugin = React.lazy(() => import('./plugins/CodeHighlightShikiPlugin'));
// Lazy load ExcalidrawPlugin to improve initial load time
const ExcalidrawPlugin = React.lazy(() => import('./plugins/ExcalidrawPlugin'));


interface EditorProps {
  config?: EditorConfig;
}


/**
 * Most plugins from the Lexical Playground are included here. Incomplete or plugins that don't make sense for an
 * editor focused on Markdown compatibility are omitted.
 *
 * List of omitted plugins:
 *
 * - AutocompletePlugin: Not relevant for this editor, nor configurable
 * - CommentPlugin: Not relevant for this editor (left in code for now)
 * - ContextPlugin: Not complete
 * - CollaborationPlugin: Not implemented yet (left in code for now)
 * - DocsPlugin: Not relevant for this editor
 * - FigmaPlugin: Not included as it is not relevant for a markdown editor
 * - KeywordsPlugin: Not useful
 * - MentionsPlugin: Not implemented as pluggable
 * - PollPlugin: Not relevant for this editor
 * - TwitterPlugin: Not relevant for this editor
 * - YouTubePlugin: Not relevant for this editor
 *
 *
 *
 */
export default function Editor({config = DEFAULT_EDITOR_CONFIG}: EditorProps): JSX.Element {
  const runtimeSettings = useRuntimeSettings();
  const {historyState} = useSharedHistoryContext();
  const {
    isCodeHighlighted,
    hasLinkAttributes,
    isRichText,
    shouldPreserveNewLinesInMarkdown,
    selectionAlwaysOnDisplay,
    listStrictIndent,
    markdownOnly,
  } = config;


  const isEditable = useLexicalEditable();
  const placeholder = isRichText
    ? 'Enter some rich text...'
    : 'Enter some plain text...';

  const [floatingAnchorElem, setFloatingAnchorElem] =
    useState<HTMLDivElement | null>(null);
  const [isSmallWidthViewport, setIsSmallWidthViewport] =
    useState<boolean>(false);
  const [editor] = useLexicalComposerContext();
  const [activeEditor, setActiveEditor] = useState(editor);
  const [isLinkEditMode, setIsLinkEditMode] = useState<boolean>(false);

  // Get all transformers including from plugins
  // const allTransformers = [...PLAYGROUND_TRANSFORMERS]; //, ...pluginRegistry.getAllTransformers()];

  // Expose markdown content getter
  useEffect(() => {
    if (config.onGetContent) {
      const getContent = () => {
        return editor.read(() => {
          const markdown = $convertToMarkdownString(PLAYGROUND_TRANSFORMERS, undefined, true);
          // remove frontmatter
          const frontmatterRegex = /^---\s*\n(?:.*\n)*?---\s*\n/;
          const markdownWithoutFrontmatter = markdown.replace(frontmatterRegex, '');
          return markdownWithoutFrontmatter;
        });
      };
      config.onGetContent(getContent);
    }
  }, [editor, config.onGetContent]);

  // Expose editor instance
  useEffect(() => {
    if (config.onEditorReady) {
      config.onEditorReady(editor);
    }
  }, [editor, config]);

  // Handle content changes
  useEffect(() => {
    const removeUpdateListener = editor.registerUpdateListener(({dirtyElements, dirtyLeaves}) => {
      // Only trigger if there are actual changes
      if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return;

      if (config.onContentChange) {
        const content = editor.read(() => {
          const markdown = $convertToMarkdownString(PLAYGROUND_TRANSFORMERS, undefined, true);
          const frontmatterRegex = /^---\s*\n(?:.*\n)*?---\s*\n/;
          const markdownWithoutFrontmatter = markdown.replace(frontmatterRegex, '');
          return markdownWithoutFrontmatter;
        });
        config.onContentChange(content);
      }
    });

    return () => {
      removeUpdateListener();
    };
  }, [editor, config.onContentChange]);

  const onRef = (_floatingAnchorElem: HTMLDivElement) => {
    if (_floatingAnchorElem !== null) {
      setFloatingAnchorElem(_floatingAnchorElem);
    }
  };

  // Load initial content if provided
  useEffect(() => {
    if (!config.initialContent) return;

    editor.update(() => {
      const root = $getRoot();
      root.clear();
      if (config.initialContent?.trim()) {
        $convertFromMarkdownString(config.initialContent, PLAYGROUND_TRANSFORMERS, undefined, true);
      }
    });
  }, [config.initialContent, editor]);


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
          markdownOnly={markdownOnly}
          shouldPreserveNewLinesInMarkdown={shouldPreserveNewLinesInMarkdown}
          isCodeHighlighted={isCodeHighlighted}
        />
      )}
      {isRichText && (
        <ShortcutsPlugin
          editor={activeEditor}
          setIsLinkEditMode={setIsLinkEditMode}
        />
      )}
      {isRichText && <SearchReplacePlugin />}
      <div
        className={`editor-container ${(runtimeSettings.settings.showTreeView || config.showTreeView) ? 'tree-view' : ''} ${
          !isRichText ? 'plain-text' : ''
        }`}>
        <DragDropPaste />
        <AutoFocusPlugin />
        {selectionAlwaysOnDisplay && <SelectionAlwaysOnDisplay />}
        <ClearEditorPlugin />
        <ComponentPickerPlugin />
        <EmojiPickerPlugin />
        <AutoEmbedPlugin />
        <EmojisPlugin />
        <HashtagPlugin />
        <SpeechToTextPlugin />

        {/*  This doesn't play well with images embedded as base64 urls (spins forever) */}
        {/*<AutoLinkPlugin />*/}

        {/*<CommentPlugin*/}
        {/*  providerFactory={isCollab ? createWebsocketProvider : undefined}*/}
        {/*/>*/}
        {isRichText ? (
          <>
            {/* Collaboration disabled for now */}
            {/* {isCollab ? (
              <CollaborationPlugin
                id="main"
                providerFactory={createWebsocketProvider}
                shouldBootstrap={!skipCollaborationInit}
              />
            ) : ( */}
              <HistoryPlugin externalHistoryState={historyState} />
            {/* )} */}
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
            {isCodeHighlighted && (
              <Suspense fallback={null}>
                <CodeHighlightShikiPlugin />
              </Suspense>
            )}
            <ListPlugin hasStrictIndent={listStrictIndent} />
            <CheckListPlugin />
            <TablePlugin
              hasCellMerge={false}
              hasCellBackgroundColor={false}
              hasHorizontalScroll={false}
            />
            <TableCellResizer />
            <ImagesPlugin />
            <InlineImagePlugin />
            <LinkPlugin hasLinkAttributes={hasLinkAttributes} />
            <ClickableLinkPlugin disabled={isEditable} />
            <HorizontalRulePlugin />
            <Suspense fallback={null}>
              <ExcalidrawPlugin />
            </Suspense>
            <TabFocusPlugin />
            <TabIndentationPlugin maxIndent={7} />
            <CollapsiblePlugin />
            <PageBreakPlugin />
            <LayoutPlugin />

            {/* Render any custom plugins */}
            <PluginManager />

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

      </div>
      {(runtimeSettings.settings.showTreeView || config.showTreeView) && <TreeViewPlugin />}
    </>
  );
}
