/**
 * UnifiedEditorHeaderBar - Consistent header bar for all editor types
 *
 * Renders above all editor content (Markdown, Monaco, CSV, custom editors).
 * Features:
 * - Breadcrumb path navigation
 * - AI Sessions button (for files edited by AI)
 * - TOC button (for Markdown files only)
 * - Actions menu (View History, Toggle Source Mode, extension items)
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { $isHeadingNode } from '@lexical/rich-text';
import { $getRoot } from 'lexical';
import './UnifiedEditorHeaderBar.css';

// Editor reference type - can be LexicalEditor or any editor with similar interface
interface EditorLike {
  getEditorState: () => { read: (fn: () => void) => void };
  registerUpdateListener: (callback: () => void) => () => void;
  getElementByKey: (key: string) => HTMLElement | null;
  update: (fn: () => void) => void;
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

interface TOCItem {
  text: string;
  level: number;
  key: string;
}

interface ExtensionMenuItem {
  label: string;
  icon?: string;
  onClick: () => void;
}

interface UnifiedEditorHeaderBarProps {
  filePath: string;
  fileName: string;
  workspaceId?: string;

  // Editor type info
  isMarkdown?: boolean;
  isCustomEditor?: boolean;
  extensionId?: string;

  // Lexical editor reference (for TOC extraction)
  lexicalEditor?: EditorLike;

  // Action callbacks
  onViewHistory?: () => void;
  onToggleSourceMode?: () => void;
  supportsSourceMode?: boolean;
  isSourceModeActive?: boolean;

  // AI session callbacks
  onSwitchToAgentMode?: (planDocumentPath?: string, sessionId?: string) => void;
  onOpenSessionInChat?: (sessionId: string) => void;

  // Extension menu items (contributed by custom editors)
  extensionMenuItems?: ExtensionMenuItem[];
  onOpenExtensionSettings?: () => void;
}

export const UnifiedEditorHeaderBar: React.FC<UnifiedEditorHeaderBarProps> = ({
  filePath,
  fileName,
  workspaceId,
  isMarkdown = false,
  isCustomEditor = false,
  extensionId,
  lexicalEditor,
  onViewHistory,
  onToggleSourceMode,
  supportsSourceMode = false,
  isSourceModeActive = false,
  onSwitchToAgentMode,
  onOpenSessionInChat,
  extensionMenuItems = [],
  onOpenExtensionSettings,
}) => {
  // Dropdown states
  const [showAISessions, setShowAISessions] = useState(false);
  const [showTOC, setShowTOC] = useState(false);
  const [showActionsMenu, setShowActionsMenu] = useState(false);

  // AI Sessions state
  const [aiSessions, setAISessions] = useState<AISession[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);

  // TOC state
  const [tocItems, setTocItems] = useState<TOCItem[]>([]);

  // Refs for click-outside handling
  const aiSessionsButtonRef = useRef<HTMLButtonElement>(null);
  const tocButtonRef = useRef<HTMLButtonElement>(null);
  const actionsButtonRef = useRef<HTMLButtonElement>(null);

  // workspaceId is actually the workspace path (naming is misleading but correct)
  const workspacePath = workspaceId;

  // Parse breadcrumb segments from file path relative to workspace root
  const breadcrumbSegments = React.useMemo(() => {
    if (!workspacePath) {
      // Fallback: just show the filename
      return [fileName];
    }

    // Get path relative to workspace root
    let relativePath = filePath;
    if (filePath.startsWith(workspacePath)) {
      relativePath = filePath.slice(workspacePath.length);
      // Remove leading slash if present
      if (relativePath.startsWith('/')) {
        relativePath = relativePath.slice(1);
      }
    }

    // Split into segments
    const parts = relativePath.split('/').filter(Boolean);
    return parts;
  }, [filePath, workspacePath, fileName]);

  // Load AI sessions
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

  // Extract TOC from Lexical editor
  const extractTOC = useCallback(() => {
    if (!lexicalEditor) return;

    lexicalEditor.getEditorState().read(() => {
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
  }, [lexicalEditor]);

  // Update TOC when editor content changes
  useEffect(() => {
    if (!lexicalEditor) return;

    extractTOC();

    const unregister = lexicalEditor.registerUpdateListener(() => {
      extractTOC();
    });

    return () => {
      unregister();
    };
  }, [lexicalEditor, extractTOC]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        aiSessionsButtonRef.current &&
        !aiSessionsButtonRef.current.contains(event.target as Node) &&
        !(event.target as Element).closest('.unified-header-ai-dropdown')
      ) {
        setShowAISessions(false);
      }

      if (
        tocButtonRef.current &&
        !tocButtonRef.current.contains(event.target as Node) &&
        !(event.target as Element).closest('.unified-header-toc-dropdown')
      ) {
        setShowTOC(false);
      }

      if (
        actionsButtonRef.current &&
        !actionsButtonRef.current.contains(event.target as Node) &&
        !(event.target as Element).closest('.unified-header-actions-dropdown')
      ) {
        setShowActionsMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Handle TOC item click
  const handleTOCItemClick = (key: string) => {
    if (!lexicalEditor) return;

    lexicalEditor.update(() => {
      const element = lexicalEditor.getElementByKey(key);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setShowTOC(false);
      }
    });
  };

  // Handle AI session actions
  const handleStartAgentSession = () => {
    if (onSwitchToAgentMode && filePath) {
      onSwitchToAgentMode(filePath);
    }
    setShowAISessions(false);
  };

  const handleLoadSessionInAgentMode = (sessionId: string) => {
    if (onSwitchToAgentMode) {
      onSwitchToAgentMode(undefined, sessionId);
    }
    setShowAISessions(false);
  };

  const handleLoadSessionInChat = (sessionId: string) => {
    if (onOpenSessionInChat) {
      onOpenSessionInChat(sessionId);
    }
    setShowAISessions(false);
  };

  // Format relative time
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

  // Determine if we should show AI button
  const showAIButton = Boolean(workspaceId && onSwitchToAgentMode);

  // Determine if we should show TOC button (Markdown only)
  const showTOCButton = isMarkdown && Boolean(lexicalEditor);

  return (
    <div className="unified-editor-header-bar">
      {/* Left: Breadcrumb Path */}
      <div className="unified-header-breadcrumb">
        {breadcrumbSegments.map((segment, index) => {
          const isLast = index === breadcrumbSegments.length - 1;
          return (
            <React.Fragment key={index}>
              <span className={`breadcrumb-segment ${isLast ? 'breadcrumb-filename' : ''}`}>
                {!isLast && (
                  <svg className="breadcrumb-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                  </svg>
                )}
                {isLast && (
                  <svg className="breadcrumb-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                  </svg>
                )}
                {segment}
              </span>
              {!isLast && <span className="breadcrumb-separator">/</span>}
            </React.Fragment>
          );
        })}
      </div>

      {/* Right: Action Buttons */}
      <div className="unified-header-actions">
        {/* AI Sessions Button */}
        {showAIButton && (
          <div className="unified-header-dropdown-container">
            <button
              ref={aiSessionsButtonRef}
              className={`unified-header-button ${showAISessions ? 'active' : ''}`}
              onClick={() => {
                setShowAISessions(!showAISessions);
                if (!showAISessions) {
                  loadAISessions();
                }
              }}
              title="AI Sessions"
            >
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2L13.5 8.5L20 10L13.5 11.5L12 18L10.5 11.5L4 10L10.5 8.5L12 2Z" opacity="0.8"/>
                <path d="M14 16L18 12L20 14L16 18M14 16L16 18L10 24H8V22L14 16Z" opacity="0.8"/>
              </svg>
            </button>

            {showAISessions && (
              <div className="unified-header-ai-dropdown">
                <button
                  className="ai-session-start-button"
                  onClick={handleStartAgentSession}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
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
                        <div key={session.id} className="ai-session-item">
                          <div className="ai-session-header">
                            <div className="ai-session-title">{session.title}</div>
                            <div className="ai-session-meta">
                              {session.provider} &bull; {formatRelativeTime(session.updatedAt)} &bull; {session.messageCount} turns
                            </div>
                          </div>
                          <div className="ai-session-actions">
                            <button
                              className="ai-session-action-button"
                              onClick={() => handleLoadSessionInAgentMode(session.id)}
                              title="Open in Agent mode"
                            >
                              Agent
                            </button>
                            <button
                              className="ai-session-action-button"
                              onClick={() => handleLoadSessionInChat(session.id)}
                              title="Open in Chat panel"
                            >
                              Chat
                            </button>
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
          </div>
        )}

        {/* TOC Button (Markdown only) */}
        {showTOCButton && (
          <div className="unified-header-dropdown-container">
            <button
              ref={tocButtonRef}
              className={`unified-header-button ${showTOC ? 'active' : ''}`}
              onClick={() => setShowTOC(!showTOC)}
              title="Table of Contents"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="8" y1="6" x2="21" y2="6"/>
                <line x1="8" y1="12" x2="21" y2="12"/>
                <line x1="8" y1="18" x2="21" y2="18"/>
                <line x1="3" y1="6" x2="3.01" y2="6"/>
                <line x1="3" y1="12" x2="3.01" y2="12"/>
                <line x1="3" y1="18" x2="3.01" y2="18"/>
              </svg>
            </button>

            {showTOC && (
              <div className="unified-header-toc-dropdown">
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
          </div>
        )}

        {/* Actions Menu Button */}
        <div className="unified-header-dropdown-container">
          <button
            ref={actionsButtonRef}
            className={`unified-header-button ${showActionsMenu ? 'active' : ''}`}
            onClick={() => setShowActionsMenu(!showActionsMenu)}
            title="More actions"
          >
            <svg viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="12" r="2"/>
              <circle cx="19" cy="12" r="2"/>
              <circle cx="5" cy="12" r="2"/>
            </svg>
          </button>

          {showActionsMenu && (
            <div className="unified-header-actions-dropdown">
              {/* Toggle Source Mode */}
              {supportsSourceMode && onToggleSourceMode && (
                <button
                  className="dropdown-item"
                  onClick={() => {
                    onToggleSourceMode();
                    setShowActionsMenu(false);
                  }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="16 18 22 12 16 6"/>
                    <polyline points="8 6 2 12 8 18"/>
                  </svg>
                  {isSourceModeActive ? 'Exit Source Mode' : 'Toggle Source Mode'}
                </button>
              )}

              {/* View History */}
              {onViewHistory && (
                <button
                  className="dropdown-item"
                  onClick={() => {
                    onViewHistory();
                    setShowActionsMenu(false);
                  }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"/>
                    <polyline points="12 6 12 12 16 14"/>
                  </svg>
                  View History
                </button>
              )}

              {/* Extension Menu Items */}
              {extensionMenuItems.length > 0 && (
                <>
                  <div className="dropdown-divider" />
                  <div className="dropdown-section-label">
                    {extensionId || 'Extension'}
                  </div>
                  {extensionMenuItems.map((item, index) => (
                    <button
                      key={index}
                      className="dropdown-item"
                      onClick={() => {
                        item.onClick();
                        setShowActionsMenu(false);
                      }}
                    >
                      {item.icon && (
                        <span className="material-symbols-outlined">{item.icon}</span>
                      )}
                      {item.label}
                    </button>
                  ))}
                </>
              )}

              {/* Extension Settings Link */}
              {onOpenExtensionSettings && (
                <>
                  <div className="dropdown-divider" />
                  <button
                    className="dropdown-item settings-link"
                    onClick={() => {
                      onOpenExtensionSettings();
                      setShowActionsMenu(false);
                    }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="3"/>
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                    </svg>
                    Extension Settings
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
