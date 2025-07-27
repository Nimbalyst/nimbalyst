/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import {useLexicalComposerContext} from '@lexical/react/LexicalComposerContext';
import {
  $createRangeSelection,
  $getRoot,
  $setSelection,
  $getNodeByKey,
  type LexicalCommand,
  type LexicalEditor,
  type NodeKey,
  COMMAND_PRIORITY_EDITOR,
  COMMAND_PRIORITY_LOW,
  createCommand,
  KEY_ESCAPE_COMMAND,
  BLUR_COMMAND,
  FOCUS_COMMAND,
} from 'lexical';
import * as React from 'react';
import {useCallback, useEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';

import './SearchReplace.css';
import {SearchReplaceDialog} from './SearchReplaceDialog';
import {mergeRegister} from '@lexical/utils';
import {$isTextNode, $isElementNode, type LexicalNode} from 'lexical';

export interface SearchMatch {
  key: NodeKey;
  offset: number;
  length: number;
  text: string;
  range?: Range;
}

export interface SearchReplaceState {
  searchString: string;
  replaceString: string;
  caseInsensitive: boolean;
  useRegex: boolean;
  matches: SearchMatch[];
  currentMatchIndex: number;
  isVisible: boolean;
}

export const TOGGLE_SEARCH_COMMAND: LexicalCommand<undefined> = createCommand();
export const CLOSE_SEARCH_COMMAND: LexicalCommand<undefined> = createCommand();
export const SEARCH_COMMAND: LexicalCommand<string> = createCommand();
export const REPLACE_COMMAND: LexicalCommand<undefined> = createCommand();
export const REPLACE_ALL_COMMAND: LexicalCommand<undefined> = createCommand();
export const NEXT_MATCH_COMMAND: LexicalCommand<undefined> = createCommand();
export const PREVIOUS_MATCH_COMMAND: LexicalCommand<undefined> = createCommand();

// Custom function to traverse all text nodes
function $findTextNodes(node: LexicalNode, callback: (textNode: any) => void): void {
  if ($isTextNode(node)) {
    callback(node);
  } else if ($isElementNode(node)) {
    const children = node.getChildren();
    for (const child of children) {
      $findTextNodes(child, callback);
    }
  }
}

function SearchReplacePlugin(): React.ReactElement | null {
  const [editor] = useLexicalComposerContext();
  const [searchState, setSearchState] = useState<SearchReplaceState>({
    searchString: '',
    replaceString: '',
    caseInsensitive: true,
    useRegex: false,
    matches: [],
    currentMatchIndex: -1,
    isVisible: false,
  });
  const highlightManagerRef = useRef<HighlightManager | null>(null);
  const [, setIsEditorFocused] = useState(false);

  useEffect(() => {
    // Defer highlight manager creation to avoid blocking initial render
    const timeoutId = setTimeout(() => {
      highlightManagerRef.current = new HighlightManager(editor);
    }, 0);

    return () => {
      clearTimeout(timeoutId);
      highlightManagerRef.current?.destroy();
    };
  }, [editor]);

  const performSearch = useCallback(
    (searchString: string, caseInsensitive: boolean, useRegex: boolean) => {
      if (!searchString) {
        setSearchState((prev) => ({
          ...prev,
          matches: [],
          currentMatchIndex: -1,
        }));
        highlightManagerRef.current?.clearHighlights();
        return;
      }

      editor.getEditorState().read(() => {
        const matches: SearchMatch[] = [];
        let searchPattern: RegExp;

        try {
          if (useRegex) {
            searchPattern = new RegExp(searchString, caseInsensitive ? 'gi' : 'g');
          } else {
            const escapedSearchString = searchString.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            searchPattern = new RegExp(escapedSearchString, caseInsensitive ? 'gi' : 'g');
          }
        } catch (e) {
          return;
        }

        const root = $getRoot();
        $findTextNodes(root, (textNode) => {
          const text = textNode.getTextContent();
          const key = textNode.getKey();
          let match;

          searchPattern.lastIndex = 0; // Reset regex state
          while ((match = searchPattern.exec(text)) !== null) {
            matches.push({
              key,
              offset: match.index,
              length: match[0].length,
              text: match[0],
            });
          }
        });

        setSearchState((prev) => ({
          ...prev,
          matches,
          currentMatchIndex: matches.length > 0 ? 0 : -1,
        }));

        highlightManagerRef.current?.updateHighlights(matches, 0);
      });
    },
    [editor],
  );

  const navigateToMatch = useCallback(
    (index: number) => {
      const {matches} = searchState;
      if (matches.length === 0 || index < 0 || index >= matches.length) {
        return;
      }

      const match = matches[index];
      editor.update(() => {
        const node = $getNodeByKey(match.key);
        if ($isTextNode(node)) {
          const selection = $createRangeSelection();
          selection.anchor.set(match.key, match.offset, 'text');
          selection.focus.set(match.key, match.offset + match.length, 'text');
          $setSelection(selection);

          const domNode = editor.getElementByKey(match.key);
          if (domNode) {
            domNode.scrollIntoView({
              behavior: 'smooth',
              block: 'center',
            });
          }
        }
      });

      setSearchState((prev) => ({
        ...prev,
        currentMatchIndex: index,
      }));

      highlightManagerRef.current?.updateHighlights(matches, index);

      // Keep focus on search input after navigation
      setTimeout(() => {
        const searchInput = document.querySelector('.search-replace-input') as HTMLInputElement;
        if (searchInput) {
          searchInput.focus();
        }
      }, 0);
    },
    [editor, searchState],
  );

  const replaceMatch = useCallback(() => {
    const {matches, currentMatchIndex, replaceString} = searchState;
    if (matches.length === 0 || currentMatchIndex < 0) {
      return;
    }

    editor.update(() => {
      const match = matches[currentMatchIndex];
      const node = $getNodeByKey(match.key);
      if ($isTextNode(node)) {
        const text = node.getTextContent();
        const newText = text.slice(0, match.offset) + replaceString + text.slice(match.offset + match.length);
        node.setTextContent(newText);
      }
    });

    setTimeout(() => {
      performSearch(searchState.searchString, searchState.caseInsensitive, searchState.useRegex);
    }, 0);
  }, [editor, searchState, performSearch]);

  const replaceAll = useCallback(() => {
    const {matches, replaceString} = searchState;
    if (matches.length === 0) {
      return;
    }

    editor.update(() => {
      const processedNodes = new Set<NodeKey>();

      for (let i = matches.length - 1; i >= 0; i--) {
        const match = matches[i];
        if (processedNodes.has(match.key)) {
          continue;
        }

        const node = $getNodeByKey(match.key);
        if ($isTextNode(node)) {
          const text = node.getTextContent();
          const nodeMatches = matches.filter(m => m.key === match.key).sort((a, b) => b.offset - a.offset);

          let newText = text;
          for (const nodeMatch of nodeMatches) {
            newText = newText.slice(0, nodeMatch.offset) + replaceString + newText.slice(nodeMatch.offset + nodeMatch.length);
          }

          node.setTextContent(newText);
          processedNodes.add(match.key);
        }
      }
    });

    setTimeout(() => {
      performSearch(searchState.searchString, searchState.caseInsensitive, searchState.useRegex);
    }, 0);
  }, [editor, searchState, performSearch]);

  useEffect(() => {
    return mergeRegister(
      editor.registerCommand(
        TOGGLE_SEARCH_COMMAND,
        () => {
          setSearchState((prev) => ({
            ...prev,
            isVisible: true, // Always open, never toggle
          }));
          return true;
        },
        COMMAND_PRIORITY_EDITOR,
      ),
      editor.registerCommand(
        CLOSE_SEARCH_COMMAND,
        () => {
          setSearchState((prev) => ({
            ...prev,
            isVisible: false,
          }));
          highlightManagerRef.current?.clearHighlights();
          return true;
        },
        COMMAND_PRIORITY_EDITOR,
      ),
      editor.registerCommand(
        SEARCH_COMMAND,
        (searchString: string) => {
          setSearchState((prev) => ({
            ...prev,
            searchString,
          }));
          performSearch(searchString, searchState.caseInsensitive, searchState.useRegex);
          return true;
        },
        COMMAND_PRIORITY_EDITOR,
      ),
      editor.registerCommand(
        NEXT_MATCH_COMMAND,
        () => {
          const {matches, currentMatchIndex} = searchState;
          if (matches.length > 0) {
            navigateToMatch((currentMatchIndex + 1) % matches.length);
          }
          return true;
        },
        COMMAND_PRIORITY_EDITOR,
      ),
      editor.registerCommand(
        PREVIOUS_MATCH_COMMAND,
        () => {
          const {matches, currentMatchIndex} = searchState;
          if (matches.length > 0) {
            navigateToMatch((currentMatchIndex - 1 + matches.length) % matches.length);
          }
          return true;
        },
        COMMAND_PRIORITY_EDITOR,
      ),
      editor.registerCommand(
        REPLACE_COMMAND,
        () => {
          replaceMatch();
          return true;
        },
        COMMAND_PRIORITY_EDITOR,
      ),
      editor.registerCommand(
        REPLACE_ALL_COMMAND,
        () => {
          replaceAll();
          return true;
        },
        COMMAND_PRIORITY_EDITOR,
      ),
      editor.registerCommand(
        KEY_ESCAPE_COMMAND,
        () => {
          if (searchState.isVisible) {
            editor.dispatchCommand(CLOSE_SEARCH_COMMAND, undefined);
            return true;
          }
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        FOCUS_COMMAND,
        () => {
          setIsEditorFocused(true);
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        BLUR_COMMAND,
        () => {
          setIsEditorFocused(false);
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
    );
  }, [editor, searchState, performSearch, navigateToMatch, replaceMatch, replaceAll]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        if (!searchState.isVisible) {
          editor.dispatchCommand(TOGGLE_SEARCH_COMMAND, undefined);
        }
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'h') {
        e.preventDefault();
        if (!searchState.isVisible) {
          editor.dispatchCommand(TOGGLE_SEARCH_COMMAND, undefined);
        }
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'g') {
        if (searchState.isVisible && searchState.matches.length > 0) {
          e.preventDefault();
          if (e.shiftKey) {
            editor.dispatchCommand(PREVIOUS_MATCH_COMMAND, undefined);
          } else {
            editor.dispatchCommand(NEXT_MATCH_COMMAND, undefined);
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [editor, searchState]);

  // Don't render anything if not visible to improve performance
  if (!searchState.isVisible) {
    return null;
  }

  const rootElement = editor.getRootElement();
  const parentElement = rootElement?.parentElement;

  if (!parentElement) {
    return null;
  }

  return createPortal(
    <SearchReplaceDialog
      searchString={searchState.searchString}
      replaceString={searchState.replaceString}
      caseInsensitive={searchState.caseInsensitive}
      useRegex={searchState.useRegex}
      matches={searchState.matches}
      currentMatchIndex={searchState.currentMatchIndex}
      onSearchChange={(value) => {
        setSearchState((prev) => ({ ...prev, searchString: value }));
        performSearch(value, searchState.caseInsensitive, searchState.useRegex);
      }}
      onReplaceChange={(value) => {
        setSearchState((prev) => ({ ...prev, replaceString: value }));
      }}
      onCaseInsensitiveChange={(value) => {
        setSearchState((prev) => ({ ...prev, caseInsensitive: value }));
        performSearch(searchState.searchString, value, searchState.useRegex);
      }}
      onUseRegexChange={(value) => {
        setSearchState((prev) => ({ ...prev, useRegex: value }));
        performSearch(searchState.searchString, searchState.caseInsensitive, value);
      }}
      onNext={() => editor.dispatchCommand(NEXT_MATCH_COMMAND, undefined)}
      onPrevious={() => editor.dispatchCommand(PREVIOUS_MATCH_COMMAND, undefined)}
      onReplace={() => editor.dispatchCommand(REPLACE_COMMAND, undefined)}
      onReplaceAll={() => editor.dispatchCommand(REPLACE_ALL_COMMAND, undefined)}
      onClose={() => editor.dispatchCommand(CLOSE_SEARCH_COMMAND, undefined)}
    />,
    parentElement,
  );
}

class HighlightManager {
  private editor: LexicalEditor;
  private highlightElements: HTMLElement[] = [];
  private wrapperElement: HTMLElement;
  private observer: MutationObserver | null = null;
  private rootElement: HTMLElement | null = null;
  private parentElement: HTMLElement | null = null;

  constructor(editor: LexicalEditor) {
    this.editor = editor;
    this.wrapperElement = document.createElement('div');
    this.wrapperElement.className = 'search-highlights-wrapper';
    this.wrapperElement.style.position = 'relative';
    this.wrapperElement.style.pointerEvents = 'none';
  }

  updateHighlights(matches: SearchMatch[], currentIndex: number) {
    const rootElement = this.editor.getRootElement();
    if (!rootElement) {
      return;
    }

    const parentElement = rootElement.parentElement;
    if (!parentElement) {
      return;
    }

    if (this.rootElement !== rootElement || this.parentElement !== parentElement) {
      this.setupObserver(rootElement, parentElement);
    }

    this.clearHighlights();

    if (!this.wrapperElement.isConnected) {
      parentElement.insertBefore(this.wrapperElement, parentElement.firstChild);
    }

    const {left: parentLeft, top: parentTop} = parentElement.getBoundingClientRect();

    matches.forEach((match, index) => {
      this.editor.getEditorState().read(() => {
        const node = $getNodeByKey(match.key);
        if (!$isTextNode(node)) {
          return;
        }

        const domElement = this.editor.getElementByKey(match.key);
        if (!domElement) {
          return;
        }

        const textNode = domElement.firstChild as Text;
        if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
          return;
        }

        const range = document.createRange();
        try {
          range.setStart(textNode, match.offset);
          range.setEnd(textNode, match.offset + match.length);
        } catch (e) {
          return;
        }

        const rects = Array.from(range.getClientRects());

        rects.forEach((rect) => {
          const highlightElement = document.createElement('div');
          highlightElement.className = index === currentIndex ? 'search-highlight-current' : 'search-highlight';
          highlightElement.style.position = 'absolute';
          highlightElement.style.left = `${rect.left - parentLeft}px`;
          highlightElement.style.top = `${rect.top - parentTop}px`;
          highlightElement.style.width = `${rect.width}px`;
          highlightElement.style.height = `${rect.height}px`;
          highlightElement.style.pointerEvents = 'none';

          this.wrapperElement.appendChild(highlightElement);
          this.highlightElements.push(highlightElement);
        });
      });
    });
  }

  clearHighlights() {
    this.highlightElements.forEach((element) => element.remove());
    this.highlightElements = [];
  }

  destroy() {
    this.clearHighlights();
    this.wrapperElement.remove();
    if (this.observer) {
      this.observer.disconnect();
    }
  }

  private setupObserver(rootElement: HTMLElement, parentElement: HTMLElement) {
    if (this.observer) {
      this.observer.disconnect();
    }

    this.rootElement = rootElement;
    this.parentElement = parentElement;

    this.observer = new MutationObserver(() => {
      const currentRoot = this.editor.getRootElement();
      const currentParent = currentRoot?.parentElement;

      if (currentRoot !== this.rootElement || currentParent !== this.parentElement) {
        this.clearHighlights();
      }
    });

    this.observer.observe(parentElement, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
  }
}

export default SearchReplacePlugin;
