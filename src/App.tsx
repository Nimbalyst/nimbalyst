/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import type { JSX } from 'react';
import React from 'react';

import { LexicalComposer } from '@lexical/react/LexicalComposer';
import {
    $createParagraphNode,
    $createTextNode,
    $getRoot,
    $isTextNode,
    DOMConversionMap,
    TextNode,
} from 'lexical';

import { DEFAULT_EDITOR_CONFIG, type EditorConfig } from './EditorConfig';
import { FlashMessageContext } from './context/FlashMessageContext';
import { SharedHistoryContext } from './context/SharedHistoryContext';
import { TableContext } from './plugins/TablePlugin';
import { ToolbarContext } from './context/ToolbarContext';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import Editor from './Editor';
import PlaygroundEditorTheme from './themes/PlaygroundEditorTheme';
import EditorNodes from "./nodes/EditorNodes";

const EMPTY_CONTENT = '';

export interface StravuEditorProps {
    config?: EditorConfig;
}

function StravuEditorInner({config}: {config: EditorConfig}): JSX.Element {
    const { theme } = useTheme();
    
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

    return (
        <div className="stravu-editor" data-theme={theme}>
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
        conversion: (element: Node): null => {
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

// Simple wrapper component
function DevModeEditor(): JSX.Element {
    const config: EditorConfig = {
        ...DEFAULT_EDITOR_CONFIG,
    };

    // Reset body margin for dev mode
    React.useEffect(() => {
        document.body.style.margin = '0';
        document.body.style.padding = '0';
    }, []);

    return (
        <div style={{height: '100vh', display: 'flex', flexDirection: 'column'}}>
            <StravuEditor config={config}/>
        </div>
    );
}

// For development builds - fullscreen editor with file operations
export default function App(): JSX.Element {
    return (
        <FlashMessageContext>
            <DevModeEditor/>
        </FlashMessageContext>
    );
}

// Export the main component for use in other projects
export { StravuEditor };
