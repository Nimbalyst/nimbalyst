/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import { JSX, useEffect } from 'react';

import { $isCodeNode, CodeNode, DEFAULT_CODE_LANGUAGE } from '@lexical/code';
import { registerCodeHighlighting, Tokenizer } from '@lexical/code-shiki';
import {useLexicalComposerContext} from '@lexical/react/LexicalComposerContext';
import { $getRoot, $isElementNode, LexicalNode, NodeMutation } from 'lexical';

import {useTheme} from '../../context/ThemeContext';
import { ShikiTokenizer } from "@lexical/code-shiki";

// Theme mapping for automatic light/dark switching
const THEME_MAPPING = {
  light: 'github-light',
  dark: 'dark-plus',
  'crystal-dark': 'material-theme-darker',
} as const;



export default function CodeHighlightShikiPlugin(): JSX.Element | null {
  const [editor] = useLexicalComposerContext();
  const {theme} = useTheme();

  useEffect(() => {
      const targetTheme = THEME_MAPPING[theme];

      const ShikiThemelssTokenizer: Tokenizer = {
          ...ShikiTokenizer,
          defaultTheme: targetTheme,
      };

    return registerCodeHighlighting(editor, ShikiThemelssTokenizer);
  }, [editor, theme]);

    // useEffect(() => {
    //
    //     const targetTheme = THEME_MAPPING[theme];
    //
    //     return editor.registerNodeTransform(CodeNode, (codeNode: CodeNode) => {
    //
    //
    //
    //         if (codeNode.getTheme() !== targetTheme) {
    //             codeNode.setTheme(targetTheme);
    //         }
    //     });
    //
    // }, [editor, theme]);

  // Update all code block themes when global theme changes
  useEffect(() => {
    const targetTheme = THEME_MAPPING[theme];
    console.log('Theme changed to:', theme, 'Setting code theme to:', targetTheme);

    editor.update(() => {
      const root = $getRoot();
      const codeNodes: any[] = [];

      // Find all code nodes
      function findCodeNodes(node: any): void {
        if ($isCodeNode(node)) {
          codeNodes.push(node);
        }
        if ($isElementNode(node)) {
          const children = node.getChildren();
          for (const child of children) {
            findCodeNodes(child);
          }
        }
      }

      findCodeNodes(root);

      console.log('Found', codeNodes.length, 'code nodes');

      // Update theme for code nodes that don't have a manually set theme
      // or update all code nodes (you can adjust this logic as needed)
      codeNodes.forEach((codeNode) => {
        const currentTheme = codeNode.getTheme();
        console.log('Code node current theme:', currentTheme, 'Will update:', !currentTheme || currentTheme === THEME_MAPPING.light || currentTheme === THEME_MAPPING.dark);
        // Only update if no theme is set or if it's one of our mapped themes
        // if (!currentTheme || currentTheme === THEME_MAPPING.light || currentTheme === THEME_MAPPING.dark) {
          codeNode.setTheme(targetTheme);
          codeNode.setStyle('');
          console.log('Updated code node theme to:', targetTheme);
        // }
      });
    });
  }, [editor, theme]);

  return null;
}
