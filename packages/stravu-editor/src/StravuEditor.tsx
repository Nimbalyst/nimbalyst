/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import type { JSX } from 'react';
import React, { useRef } from 'react';

import { LexicalComposer } from '@lexical/react/LexicalComposer';
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

export interface StravuEditorProps {
    config?: EditorConfig;
}

function StravuEditorInner({config}: {config: EditorConfig}): JSX.Element {
    const { theme } = useTheme();
    const containerRef = useRef<HTMLDivElement>(null);
    const widthClass = useResponsiveWidth(containerRef);

    const initialConfig = {
        editorState: config.emptyEditor ? undefined : $createEmptyEditor,
        html: {import: buildImportMap()},
        namespace: 'StravuEditor',
        nodes: [...EditorNodes],
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

function StravuEditor({config = DEFAULT_EDITOR_CONFIG}: StravuEditorProps): JSX.Element {
    return (
        <ThemeProvider initialTheme={config.theme}>
            <StravuEditorInner config={config} />
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
