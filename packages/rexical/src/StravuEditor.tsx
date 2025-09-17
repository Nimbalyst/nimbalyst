/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import type { JSX } from 'react';
import { useMemo, useRef } from 'react';

import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { $convertFromMarkdownString } from '@lexical/markdown';
import {
    $createParagraphNode,
    $createTextNode,
    $getRoot,
    DOMConversionMap,
} from 'lexical';

import { DEFAULT_EDITOR_CONFIG, type EditorConfig } from './EditorConfig';
import { SharedHistoryContext } from './context/SharedHistoryContext';
import { TableContext } from './plugins/TablePlugin';
import { ToolbarContext } from './context/ToolbarContext';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import { RuntimeSettingsProvider } from './context/RuntimeSettingsContext';
import { useResponsiveWidth } from './hooks/useResponsiveWidth';
import Editor from './Editor';
import PlaygroundEditorTheme from './themes/PlaygroundEditorTheme';
import EditorNodes from "./nodes/EditorNodes";
import { pluginRegistry } from './plugins/PluginRegistry';
import { getEditorTransformers } from './markdown';

export interface StravuEditorProps {
    config?: EditorConfig;
}

function StravuEditorInner({config}: {config: EditorConfig}): JSX.Element {

    const { theme } = useTheme();
    const containerRef = useRef<HTMLDivElement>(null);
    const widthClass = useResponsiveWidth(containerRef);
    const markdownTransformers = useMemo(
        () => config.markdownTransformers ?? getEditorTransformers(),
        [config.markdownTransformers]
    );

    const initialConfig = {
        // Set initial editor state based on whether we have initial content
        editorState: (() => {
            if (config.initialContent) {
                // Load markdown content properly through the initialConfig
                return () => {
                    const root = $getRoot();
                    root.clear();
                    $convertFromMarkdownString(config.initialContent!, markdownTransformers, undefined, true);
                    root.selectStart();
                };
            } else if (!config.emptyEditor) {
                // Create an empty editor with a paragraph
                return $createEmptyEditor;
            }
            // Return undefined for truly empty editor
            return undefined;
        })(),
        namespace: 'StravuEditor',
        nodes: [...EditorNodes,  ...pluginRegistry.getAllNodes()],
        onError: (error: Error) => {
            throw error;
        },
        theme: PlaygroundEditorTheme,
    };

    const isDarkTheme = theme === 'dark' || theme === 'crystal-dark';

    return (
        <div
            ref={containerRef}
            className={`stravu-editor ${widthClass} ${isDarkTheme ? 'dark-theme' : ''}`}
            data-theme={theme}
        >
            <RuntimeSettingsProvider>
                    <LexicalComposer initialConfig={initialConfig}>
                        <SharedHistoryContext>
                            <TableContext>
                                <ToolbarContext>
                                    <div className="editor-shell">
                                        <Editor config={config}/>
                                    </div>
                                </ToolbarContext>
                            </TableContext>
                        </SharedHistoryContext>
                    </LexicalComposer>
            </RuntimeSettingsProvider>
        </div>
    );
}

function StravuEditor({config}: StravuEditorProps): JSX.Element {
    // Merge provided config with defaults
    const mergedConfig = {
        ...DEFAULT_EDITOR_CONFIG,
        ...config
    };

    return (
        <ThemeProvider initialTheme={mergedConfig.theme}>
            <StravuEditorInner config={mergedConfig} />
        </ThemeProvider>
    );
}

function $createEmptyEditor() {
    const root = $getRoot();
    if (root.getFirstChild() === null) {
        const paragraph = $createParagraphNode();
        root.append(paragraph);
    }
}

// Map for HTML paste import
function buildImportMap(): DOMConversionMap {
    const importMap: DOMConversionMap = {};

    // Import text nodes
    importMap['#text'] = () => ({
        conversion: (element: Node) => {
            const textContent = element.textContent;
            if (typeof textContent === 'string' && textContent.trim() !== '') {
                return {node: $createTextNode(textContent)};
            }
            return null;
        },
        priority: 0,
    });

    return importMap;
}

// Export the main component
export { StravuEditor };
