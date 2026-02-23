/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import { useEffect } from 'react';
import { registerCodeHighlighting } from '@lexical/code';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getRoot, $isElementNode } from 'lexical';
import { $isCodeNode, CodeNode } from '@lexical/code';
import { useTheme } from '../../context/ThemeContext';

// Import Prism and necessary languages
// @ts-ignore - prismjs doesn't have types
import Prism from 'prismjs';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-csharp';

// Import Prism themes
import 'prismjs/themes/prism.css'; // Light theme (default)
// Import dark theme AFTER to ensure it overrides
import './prism-dark.css'; // Dark theme overrides

// Theme mapping for automatic light/dark switching
// Maps known themes to Prism themes, with fallback based on isDark
export const THEME_MAPPING: Record<string, string> = {
    light: 'github-light',
    dark: 'dark-plus',
    'crystal-dark': 'material-theme-darker',
};

/** Get the code highlighting theme for a given app theme */
export function getCodeTheme(theme: string, isDark: boolean): string {
  // If we have an explicit mapping, use it
  if (THEME_MAPPING[theme]) {
    return THEME_MAPPING[theme];
  }
  // Otherwise, fall back based on whether it's a dark theme
  return isDark ? 'dark-plus' : 'github-light';
}

export default function CodeHighlightPlugin(): null {
  const [editor] = useLexicalComposerContext();
  const { theme, isDark } = useTheme();

  useEffect(() => {
    // Register standard code highlighting
    // Code blocks without a language use 'plain' as a marker (set in MarkdownTransformers.ts)
    return registerCodeHighlighting(editor);
  }, [editor]);

  // Handle theme updates for code nodes
  useEffect(() => {
    const targetTheme = getCodeTheme(theme, isDark);

    // Update all existing code nodes
    editor.update(() => {
      const root = $getRoot();

      function updateCodeNodes(node: any): void {
        if ($isCodeNode(node)) {
          const currentTheme = node.getTheme();
          if (currentTheme !== targetTheme) {
            node.setTheme(targetTheme);
          }
        }
        if ($isElementNode(node)) {
          const children = node.getChildren();
          for (const child of children) {
            updateCodeNodes(child);
          }
        }
      }

      updateCodeNodes(root);
    });

    // Register a transform for new nodes
    const removeTransform = editor.registerNodeTransform(CodeNode, (node) => {
      const currentTheme = node.getTheme();
      if (!currentTheme || currentTheme !== targetTheme) {
        node.setTheme(targetTheme);
      }
    });

    return removeTransform;
  }, [editor, theme]);

  return null;
}
