/**
 * UnifiedEditorHeaderBar - Consistent header bar for all editor types
 *
 * Renders above all editor content (Markdown, Monaco, CSV, custom editors).
 * Features:
 * - Breadcrumb path navigation
 * - AI Sessions button (for files edited by AI)
 * - TOC button (for Markdown files only)
 * - Actions menu (View History, Toggle Source Mode, Set Document Type, etc.)
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { $isHeadingNode } from '@lexical/rich-text';
import { $getRoot } from 'lexical';
import {
  $convertToEnhancedMarkdownString,
  $convertFromEnhancedMarkdownString,
  getEditorTransformers,
} from 'rexical';
import './UnifiedEditorHeaderBar.css';

// Tracker type info
interface TrackerTypeInfo {
  type: string;
  displayName: string;
  icon: string;
  color: string;
}

// Built-in tracker types that support full-document mode
const TRACKER_TYPES: TrackerTypeInfo[] = [
  { type: 'plan', displayName: 'Plan', icon: 'flag', color: '#3b82f6' },
  { type: 'decision', displayName: 'Decision', icon: 'gavel', color: '#8b5cf6' },
];

// Editor reference type - can be LexicalEditor or any editor with similar interface
interface EditorLike {
  getEditorState: () => { read: (fn: () => void) => void };
  registerUpdateListener: (callback: () => void) => () => void;
  getElementByKey: (key: string) => HTMLElement | null;
  update: (fn: () => void) => void;
}

// Helper functions for document type detection and manipulation
function getCurrentTrackerTypeFromMarkdown(markdown: string): string | null {
  const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
  const match = markdown.match(frontmatterRegex);
  if (!match) return null;

  const yamlContent = match[1];
  if (yamlContent.includes('planStatus:')) return 'plan';
  if (yamlContent.includes('decisionStatus:')) return 'decision';
  return null;
}

function getDefaultFrontmatterForType(trackerType: string): Record<string, unknown> {
  const now = new Date().toISOString();
  const today = now.split('T')[0];
  const generateId = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).substring(7)}`;

  if (trackerType === 'plan') {
    return {
      planId: generateId('plan'),
      title: '',
      status: 'draft',
      planType: 'feature',
      priority: 'medium',
      progress: 0,
      owner: '',
      stakeholders: [],
      tags: [],
      created: today,
      updated: now,
    };
  } else if (trackerType === 'decision') {
    return {
      decisionId: generateId('dec'),
      title: '',
      status: 'to-do',
      chosen: '',
      priority: 'medium',
      owner: '',
      stakeholders: [],
      tags: [],
      created: today,
      updated: now,
    };
  }
  return {};
}

function applyTrackerTypeToMarkdown(markdown: string, trackerType: string): string {
  const defaultData = getDefaultFrontmatterForType(trackerType);
  let frontmatterKey = 'trackerStatus';
  if (trackerType === 'plan') frontmatterKey = 'planStatus';
  else if (trackerType === 'decision') frontmatterKey = 'decisionStatus';

  const yamlLines = [`${frontmatterKey}:`];
  for (const [key, value] of Object.entries(defaultData)) {
    if (Array.isArray(value)) {
      yamlLines.push(`  ${key}: []`);
    } else if (typeof value === 'string') {
      yamlLines.push(`  ${key}: "${value}"`);
    } else {
      yamlLines.push(`  ${key}: ${value}`);
    }
  }

  const yamlContent = yamlLines.join('\n');
  const frontmatterRegex = /^---\n[\s\S]*?\n---\n?/;
  const hasFrontmatter = frontmatterRegex.test(markdown);

  if (hasFrontmatter) {
    return markdown.replace(frontmatterRegex, `---\n${yamlContent}\n---\n`);
  } else {
    return `---\n${yamlContent}\n---\n${markdown}`;
  }
}

function removeTrackerTypeFromMarkdown(markdown: string): string {
  const frontmatterRegex = /^---\n[\s\S]*?\n---\n?/;
  return markdown.replace(frontmatterRegex, '');
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

  // Lexical editor reference (for TOC extraction and markdown operations)
  lexicalEditor?: EditorLike;

  // Action callbacks
  onViewHistory?: () => void;
  onToggleSourceMode?: () => void;
  supportsSourceMode?: boolean;
  isSourceModeActive?: boolean;

  // Markdown-specific callbacks
  onToggleMarkdownMode?: () => void;  // Switch to Monaco for raw editing
  onDirtyChange?: (isDirty: boolean) => void;  // Mark document as dirty after changes

  // AI session callbacks
  onSwitchToAgentMode?: (planDocumentPath?: string, sessionId?: string) => void;
  onOpenSessionInChat?: (sessionId: string) => void;

  // Extension menu items (contributed by custom editors)
  extensionMenuItems?: ExtensionMenuItem[];
  onOpenExtensionSettings?: () => void;

  // Debug tree toggle (dev mode only)
  onToggleDebugTree?: () => void;
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
  onToggleMarkdownMode,
  onDirtyChange,
  onSwitchToAgentMode,
  onOpenSessionInChat,
  extensionMenuItems = [],
  onOpenExtensionSettings,
  onToggleDebugTree,
}) => {
  // Dropdown states
  const [showAISessions, setShowAISessions] = useState(false);
  const [showTOC, setShowTOC] = useState(false);
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const [showDocTypeSubmenu, setShowDocTypeSubmenu] = useState(false);

  // Dev mode check
  const isDevMode = import.meta.env.DEV;

  // AI Sessions state
  const [aiSessions, setAISessions] = useState<AISession[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);

  // TOC state
  const [tocItems, setTocItems] = useState<TOCItem[]>([]);

  // Document type state (for markdown files)
  const [currentDocumentType, setCurrentDocumentType] = useState<string | null>(null);

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
    if (typeof lexicalEditor.getEditorState !== 'function') return;

    try {
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
    } catch (error) {
      console.error('[UnifiedHeaderBar] Failed to extract TOC:', error);
    }
  }, [lexicalEditor]);

  // Update TOC when editor content changes
  useEffect(() => {
    if (!lexicalEditor) return;
    if (typeof lexicalEditor.registerUpdateListener !== 'function') return;

    extractTOC();

    const unregister = lexicalEditor.registerUpdateListener(() => {
      extractTOC();
    });

    return () => {
      unregister();
    };
  }, [lexicalEditor, extractTOC]);

  // Detect current document type from editor content (markdown only)
  useEffect(() => {
    // Validate that lexicalEditor is actually a Lexical editor with the expected methods
    if (!lexicalEditor || !isMarkdown) return;
    if (typeof lexicalEditor.getEditorState !== 'function' ||
        typeof lexicalEditor.registerUpdateListener !== 'function') {
      // Not a valid Lexical editor (might be switching modes)
      return;
    }

    const detectDocumentType = () => {
      try {
        lexicalEditor.getEditorState().read(() => {
          const transformers = getEditorTransformers();
          const markdown = $convertToEnhancedMarkdownString(transformers);
          const detectedType = getCurrentTrackerTypeFromMarkdown(markdown);
          setCurrentDocumentType(detectedType);
        });
      } catch (error) {
        console.error('[UnifiedHeaderBar] Failed to detect document type:', error);
      }
    };

    detectDocumentType();

    const unregister = lexicalEditor.registerUpdateListener(() => {
      detectDocumentType();
    });

    return () => {
      unregister();
    };
  }, [lexicalEditor, isMarkdown]);

  // Handle copy as markdown
  const handleCopyAsMarkdown = useCallback(() => {
    if (!lexicalEditor || typeof lexicalEditor.getEditorState !== 'function') return;

    try {
      lexicalEditor.getEditorState().read(() => {
        const transformers = getEditorTransformers();
        const markdown = $convertToEnhancedMarkdownString(transformers);

        if (navigator.clipboard) {
          navigator.clipboard.writeText(markdown).then(() => {
            console.log('[UnifiedHeaderBar] Markdown copied to clipboard');
          }).catch((err) => {
            console.error('[UnifiedHeaderBar] Failed to copy markdown:', err);
          });
        }
      });
    } catch (error) {
      console.error('[UnifiedHeaderBar] Failed to convert to markdown:', error);
    }
    setShowActionsMenu(false);
  }, [lexicalEditor]);

  // Handle set document type
  const handleSetDocumentType = useCallback((trackerType: string) => {
    if (!lexicalEditor || typeof lexicalEditor.update !== 'function') return;

    try {
      lexicalEditor.update(() => {
        const transformers = getEditorTransformers();
        const markdown = $convertToEnhancedMarkdownString(transformers);
        const updatedMarkdown = applyTrackerTypeToMarkdown(markdown, trackerType);
        $convertFromEnhancedMarkdownString(updatedMarkdown, transformers);

        // Mark as dirty - autosave will handle saving
        if (onDirtyChange) {
          onDirtyChange(true);
        }
      });
    } catch (error) {
      console.error('[UnifiedHeaderBar] Failed to apply document type:', error);
    }

    setShowDocTypeSubmenu(false);
    setShowActionsMenu(false);
  }, [lexicalEditor, onDirtyChange]);

  // Handle remove document type
  const handleRemoveDocumentType = useCallback(() => {
    if (!lexicalEditor || typeof lexicalEditor.update !== 'function') return;

    try {
      lexicalEditor.update(() => {
        const transformers = getEditorTransformers();
        const markdown = $convertToEnhancedMarkdownString(transformers);
        const updatedMarkdown = removeTrackerTypeFromMarkdown(markdown);
        $convertFromEnhancedMarkdownString(updatedMarkdown, transformers);

        // Mark as dirty - autosave will handle saving
        if (onDirtyChange) {
          onDirtyChange(true);
        }
      });
    } catch (error) {
      console.error('[UnifiedHeaderBar] Failed to remove document type:', error);
    }

    setShowDocTypeSubmenu(false);
    setShowActionsMenu(false);
  }, [lexicalEditor, onDirtyChange]);

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

              {/* Markdown-specific actions */}
              {isMarkdown && (
                <>
                  {/* Toggle Markdown Mode - switch to Monaco */}
                  {onToggleMarkdownMode && (
                    <button
                      className="dropdown-item"
                      onClick={() => {
                        onToggleMarkdownMode();
                        setShowActionsMenu(false);
                      }}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="16 18 22 12 16 6"/>
                        <polyline points="8 6 2 12 8 18"/>
                      </svg>
                      Toggle Markdown Mode
                    </button>
                  )}

                  {/* Copy as Markdown */}
                  {lexicalEditor && (
                    <button
                      className="dropdown-item"
                      onClick={handleCopyAsMarkdown}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                      </svg>
                      Copy as Markdown
                    </button>
                  )}

                  {/* Set Document Type with submenu */}
                  {lexicalEditor && (
                    <div
                      className="dropdown-item dropdown-item-with-submenu"
                      onMouseEnter={() => setShowDocTypeSubmenu(true)}
                      onMouseLeave={() => setShowDocTypeSubmenu(false)}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                        <line x1="16" y1="13" x2="8" y2="13"/>
                        <line x1="16" y1="17" x2="8" y2="17"/>
                      </svg>
                      <span className="dropdown-item-label">Set Document Type</span>
                      <span className="dropdown-item-chevron">&#8250;</span>

                      {showDocTypeSubmenu && (
                        <div className="dropdown-submenu">
                          {TRACKER_TYPES.map((type) => (
                            <button
                              key={type.type}
                              className="dropdown-item"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSetDocumentType(type.type);
                              }}
                            >
                              <span
                                className="material-symbols-outlined"
                                style={{ color: type.color, fontSize: '18px' }}
                              >
                                {type.icon}
                              </span>
                              <span>{type.displayName}</span>
                              {currentDocumentType === type.type && (
                                <span className="dropdown-checkmark">&#10003;</span>
                              )}
                            </button>
                          ))}
                          {currentDocumentType && (
                            <>
                              <div className="dropdown-divider" />
                              <button
                                className="dropdown-item"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRemoveDocumentType();
                                }}
                              >
                                <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
                                  close
                                </span>
                                <span>Remove Type</span>
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}

              {/* Debug Tree (dev mode only) */}
              {isDevMode && isMarkdown && onToggleDebugTree && (
                <button
                  className="dropdown-item"
                  onClick={() => {
                    onToggleDebugTree();
                    setShowActionsMenu(false);
                  }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M12 16v-4"/>
                    <path d="M12 8h.01"/>
                  </svg>
                  Toggle Debug Tree
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
