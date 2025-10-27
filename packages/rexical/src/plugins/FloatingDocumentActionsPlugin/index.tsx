import { useState, useCallback, useRef, useEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $createTextNode, $getRoot } from 'lexical';
import { $isHeadingNode } from '@lexical/rich-text';
import { $isCodeNode, CodeNode } from '@lexical/code';
import { $convertFromEnhancedMarkdownString, $convertToEnhancedMarkdownString, getEditorTransformers } from '../../markdown';
import { EditorConfig } from '../../EditorConfig';
import { useRuntimeSettings } from '../../context/RuntimeSettingsContext';
import './styles.css';

interface TOCItem {
  text: string;
  level: number;
  key: string;
}

interface FloatingDocumentActionsPluginProps {
  config?: EditorConfig;
}

export default function FloatingDocumentActionsPlugin({ config }: FloatingDocumentActionsPluginProps): JSX.Element {
  const [editor] = useLexicalComposerContext();
  const runtimeSettings = useRuntimeSettings();
  const [showTOC, setShowTOC] = useState(false);
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const [tocItems, setTocItems] = useState<TOCItem[]>([]);
  const tocButtonRef = useRef<HTMLButtonElement>(null);
  const actionsButtonRef = useRef<HTMLButtonElement>(null);

  // Check if we're in dev mode
  const isDevMode = import.meta.env.DEV;

  // Extract TOC from editor content
  const extractTOC = useCallback(() => {
    editor.getEditorState().read(() => {
      const root = $getRoot();
      const items: TOCItem[] = [];

      root.getChildren().forEach((node) => {
        if ($isHeadingNode(node)) {
          const level = parseInt(node.getTag().substring(1)); // h1 -> 1, h2 -> 2, etc.
          items.push({
            text: node.getTextContent(),
            level,
            key: node.getKey(),
          });
        }
      });

      setTocItems(items);
    });
  }, [editor]);

  // Update TOC when editor content changes
  useEffect(() => {
    extractTOC();

    const unregister = editor.registerUpdateListener(() => {
      extractTOC();
    });

    return () => {
      unregister();
    };
  }, [editor, extractTOC]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        tocButtonRef.current &&
        !tocButtonRef.current.contains(event.target as Node) &&
        !(event.target as Element).closest('.floating-doc-toc-dropdown')
      ) {
        setShowTOC(false);
      }

      if (
        actionsButtonRef.current &&
        !actionsButtonRef.current.contains(event.target as Node) &&
        !(event.target as Element).closest('.floating-doc-actions-dropdown')
      ) {
        setShowActionsMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleTOCItemClick = (key: string) => {
    editor.update(() => {
      const node = editor.getEditorState()._nodeMap.get(key);
      if (node) {
        const element = editor.getElementByKey(key);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setShowTOC(false);
        }
      }
    });
  };

  const handleMarkdownMode = useCallback(() => {
    editor.update(() => {
      const transformers = getEditorTransformers();
      const root = $getRoot();
      const firstChild = root.getFirstChild();

      if ($isCodeNode(firstChild) && firstChild.getLanguage() === 'markdown') {
        // Convert from markdown to rich text
        $convertFromEnhancedMarkdownString(
          firstChild.getTextContent(),
          transformers
        );
      } else {
        // Convert from rich text to markdown
        const markdown = $convertToEnhancedMarkdownString(transformers);
        const codeNode = new CodeNode('markdown');
        codeNode.append($createTextNode(markdown));
        root.clear().append(codeNode);
        if (markdown.length === 0) {
          codeNode.select();
        }
      }
    });
    setShowActionsMenu(false);
  }, [editor]);

  const handleViewHistory = useCallback(() => {
    if (config?.onViewHistory) {
      config.onViewHistory();
    }
    setShowActionsMenu(false);
  }, [config]);

  const handleRenameDocument = useCallback(() => {
    if (config?.onRenameDocument) {
      config.onRenameDocument();
    }
    setShowActionsMenu(false);
  }, [config]);

  const handleCopyAsMarkdown = useCallback(() => {
    editor.getEditorState().read(() => {
      const transformers = getEditorTransformers();
      const markdown = $convertToEnhancedMarkdownString(transformers);

      // Copy to clipboard
      if (navigator.clipboard) {
        navigator.clipboard.writeText(markdown).then(() => {
          console.log('Markdown copied to clipboard');
        }).catch((err) => {
          console.error('Failed to copy markdown:', err);
        });
      }
    });
    setShowActionsMenu(false);
  }, [editor]);

  const handleToggleDebugTree = useCallback(() => {
    runtimeSettings.toggleSetting('showTreeView');
    setShowActionsMenu(false);
  }, [runtimeSettings]);

  return (
    <div className="floating-document-actions">
      {/* Table of Contents Button */}
      <button
        ref={tocButtonRef}
        className="floating-doc-button"
        onClick={() => setShowTOC(!showTOC)}
        aria-label="Table of Contents"
      >
        <i className="icon table-of-contents" />
      </button>

      {showTOC && (
        <div className="floating-doc-toc-dropdown">
          {tocItems.length > 0 ? (
            <ul className="toc-list">
              {tocItems.map((item) => (
                <li
                  key={item.key}
                  className={`toc-item toc-level-${item.level}`}
                  onClick={() => handleTOCItemClick(item.key)}
                >
                  {item.text}
                </li>
              ))}
            </ul>
          ) : (
            <div className="toc-empty">No headings in document</div>
          )}
        </div>
      )}

      {/* Document Actions Menu Button */}
      <button
        ref={actionsButtonRef}
        className="floating-doc-button floating-doc-menu-button"
        onClick={() => setShowActionsMenu(!showActionsMenu)}
        aria-label="Document Actions"
      >
        ⋯
      </button>

      {showActionsMenu && (
        <div className="floating-doc-actions-dropdown">
          <button className="action-menu-item" onClick={handleMarkdownMode}>
            Toggle Markdown Mode
          </button>
          <button className="action-menu-item" onClick={handleViewHistory}>
            View History
          </button>
          {/*<button className="action-menu-item" onClick={handleRenameDocument}>*/}
          {/*  Rename Document*/}
          {/*</button>*/}
          <button className="action-menu-item" onClick={handleCopyAsMarkdown}>
            Copy as Markdown
          </button>
          {isDevMode && (
            <button className="action-menu-item" onClick={handleToggleDebugTree}>
              Toggle Debug Tree
            </button>
          )}
        </div>
      )}
    </div>
  );
}
