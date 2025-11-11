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

interface AISession {
  id: string;
  title: string;
  provider: string;
  model?: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

interface FloatingDocumentActionsPluginProps {
  config?: EditorConfig;
  filePath?: string;
  workspaceId?: string;
  onSwitchToAgentMode?: (planDocumentPath?: string, sessionId?: string) => void;
}

export default function FloatingDocumentActionsPlugin({
  config,
  filePath,
  workspaceId,
  onSwitchToAgentMode
}: FloatingDocumentActionsPluginProps): JSX.Element {
  const [editor] = useLexicalComposerContext();
  const runtimeSettings = useRuntimeSettings();
  const [showTOC, setShowTOC] = useState(false);
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const [showAISessions, setShowAISessions] = useState(false);
  const [aiSessions, setAISessions] = useState<AISession[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [tocItems, setTocItems] = useState<TOCItem[]>([]);
  const tocButtonRef = useRef<HTMLButtonElement>(null);
  const actionsButtonRef = useRef<HTMLButtonElement>(null);
  const aiSessionsButtonRef = useRef<HTMLButtonElement>(null);

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

  // Load AI sessions when button is clicked
  const loadAISessions = useCallback(async () => {
    if (!filePath || !workspaceId || !(window as any).electronAPI) return;

    setLoadingSessions(true);
    try {
      const sessions = await (window as any).electronAPI.invoke('sessions:get-by-file', workspaceId, filePath);
      setAISessions(sessions || []);
    } catch (error) {
      console.error('Failed to load AI sessions:', error);
      setAISessions([]);
    } finally {
      setLoadingSessions(false);
    }
  }, [filePath, workspaceId]);

  // Load sessions when dropdown opens
  useEffect(() => {
    if (showAISessions && aiSessions.length === 0) {
      loadAISessions();
    }
  }, [showAISessions, aiSessions.length, loadAISessions]);

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

      if (
        aiSessionsButtonRef.current &&
        !aiSessionsButtonRef.current.contains(event.target as Node) &&
        !(event.target as Element).closest('.floating-doc-ai-sessions-dropdown')
      ) {
        setShowAISessions(false);
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

  const handleStartAgentSession = useCallback(() => {
    if (onSwitchToAgentMode && filePath) {
      onSwitchToAgentMode(filePath);
    }
    setShowAISessions(false);
  }, [onSwitchToAgentMode, filePath]);

  const handleLoadSession = useCallback((sessionId: string) => {
    if (onSwitchToAgentMode) {
      onSwitchToAgentMode(undefined, sessionId);
    }
    setShowAISessions(false);
  }, [onSwitchToAgentMode]);

  const formatRelativeTime = (timestamp: number): string => {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return new Date(timestamp).toLocaleDateString();
  };

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

      {/* AI Sessions Button */}
      {filePath && workspaceId && onSwitchToAgentMode && (
        <>
          <button
            ref={aiSessionsButtonRef}
            className="floating-doc-button floating-doc-ai-button"
            onClick={() => {
              setShowAISessions(!showAISessions);
              if (!showAISessions) {
                loadAISessions();
              }
            }}
            aria-label="AI Sessions"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              {/* AI Sparkle */}
              <path d="M12 2L13.5 8.5L20 10L13.5 11.5L12 18L10.5 11.5L4 10L10.5 8.5L12 2Z" fill="currentColor" opacity="0.8"/>
              {/* Pencil */}
              <path d="M14 16L18 12L20 14L16 18M14 16L16 18L10 24H8V22L14 16Z" fill="currentColor" opacity="0.8"/>
            </svg>
            {aiSessions.length > 0 && (
              <span className="ai-sessions-badge">{aiSessions.length}</span>
            )}
          </button>

          {showAISessions && (
            <div className="floating-doc-ai-sessions-dropdown">
              <button
                className="ai-session-start-button"
                onClick={handleStartAgentSession}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM17 13H13V17H11V13H7V11H11V7H13V11H17V13Z" fill="currentColor"/>
                </svg>
                Start Agent Session
              </button>

              {loadingSessions ? (
                <div className="ai-sessions-loading">Loading sessions...</div>
              ) : aiSessions.length > 0 ? (
                <>
                  <div className="ai-sessions-divider" />
                  <div className="ai-sessions-list">
                    {aiSessions.map((session) => (
                      <div
                        key={session.id}
                        className="ai-session-item"
                        onClick={() => handleLoadSession(session.id)}
                      >
                        <div className="ai-session-title">{session.title}</div>
                        <div className="ai-session-meta">
                          {session.provider} • {formatRelativeTime(session.updatedAt)} • {session.messageCount} turns
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <div className="ai-sessions-divider" />
                  <div className="ai-sessions-empty">No AI sessions yet</div>
                </>
              )}
            </div>
          )}
        </>
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
