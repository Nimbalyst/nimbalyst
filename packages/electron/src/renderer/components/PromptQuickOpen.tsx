import React, { useState, useEffect, useRef, useMemo, memo } from 'react';
import { useAtomValue } from 'jotai';
import { ProviderIcon, MaterialSymbol } from '@nimbalyst/runtime';
import { getRelativeTimeString } from '../utils/dateFormatting';
import { sessionOrChildProcessingAtom, sessionUnreadAtom, sessionPendingPromptAtom } from '../store';
import './PromptQuickOpen.css';

interface PromptItem {
  id: string;
  sessionId: string;
  content: string;
  createdAt: number;
  sessionTitle: string;
  provider: string;
  parentSessionId?: string | null;
}

/**
 * Status indicator that shows processing, pending prompt, or unread status.
 * Only re-renders when this session's state changes.
 */
const PromptStatusIndicator = memo<{ sessionId: string }>(({ sessionId }) => {
  const isProcessing = useAtomValue(sessionOrChildProcessingAtom(sessionId));
  const hasPendingPrompt = useAtomValue(sessionPendingPromptAtom(sessionId));
  const hasUnread = useAtomValue(sessionUnreadAtom(sessionId));

  // Priority: processing > pending prompt > unread
  if (isProcessing) {
    return (
      <div className="prompt-quick-open-status processing" title="Processing...">
        <MaterialSymbol icon="progress_activity" size={14} />
      </div>
    );
  }

  if (hasPendingPrompt) {
    return (
      <div className="prompt-quick-open-status pending-prompt" title="Waiting for your response">
        <MaterialSymbol icon="help" size={14} />
      </div>
    );
  }

  if (hasUnread) {
    return (
      <div className="prompt-quick-open-status unread" title="Unread response">
        <MaterialSymbol icon="circle" size={8} fill />
      </div>
    );
  }

  return null;
});

interface PromptQuickOpenProps {
  isOpen: boolean;
  onClose: () => void;
  workspacePath: string;
  onSessionSelect: (sessionId: string) => void;
}

export const PromptQuickOpen: React.FC<PromptQuickOpenProps> = ({
  isOpen,
  onClose,
  workspacePath,
  onSessionSelect,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [allPrompts, setAllPrompts] = useState<PromptItem[]>([]);
  const [mouseHasMoved, setMouseHasMoved] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const resultsListRef = useRef<HTMLUListElement>(null);

  // Filter prompts in-memory by content (fast, no database query)
  const displayPrompts = useMemo(() => {
    const extractPromptText = (content: string): string => {
      // Try to parse as JSON first (some prompts are stored as {"prompt": "..."})
      try {
        const parsed = JSON.parse(content);
        if (parsed.prompt) {
          return parsed.prompt;
        }
      } catch {
        // Not JSON, return as-is
      }
      return content;
    };

    if (!searchQuery.trim()) {
      return allPrompts;
    }
    const query = searchQuery.toLowerCase();
    return allPrompts.filter(prompt => {
      const promptText = extractPromptText(prompt.content);
      return promptText.toLowerCase().includes(query);
    });
  }, [searchQuery, allPrompts]);

  // Load all prompts when modal opens
  useEffect(() => {
    if (isOpen && workspacePath) {
      console.log('[PromptQuickOpen] Requesting prompts for workspace:', workspacePath);
      window.electronAPI.invoke('messages:list-user-prompts', workspacePath, 2000)
        .then((result: { success: boolean; prompts: PromptItem[]; error?: string }) => {
          console.log('[PromptQuickOpen] Result:', result);
          if (result.success && Array.isArray(result.prompts)) {
            console.log('[PromptQuickOpen] Setting', result.prompts.length, 'prompts');
            setAllPrompts(result.prompts);
          } else {
            console.warn('[PromptQuickOpen] No prompts or error:', result.error);
            setAllPrompts([]);
          }
        })
        .catch((error: Error) => {
          console.error('[PromptQuickOpen] Failed to load prompts:', error);
          setAllPrompts([]);
        });
    }
  }, [isOpen, workspacePath]);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setSearchQuery('');
      setSelectedIndex(0);
      setMouseHasMoved(false);
      setTimeout(() => searchInputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Track mouse movement to distinguish between mouse hover and mouse at rest
  useEffect(() => {
    if (!isOpen) return;

    const handleMouseMove = () => {
      setMouseHasMoved(true);
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [isOpen]);

  // Scroll selected item into view
  useEffect(() => {
    if (!resultsListRef.current) return;

    const items = resultsListRef.current.querySelectorAll('.prompt-quick-open-item');
    const selectedItem = items[selectedIndex] as HTMLElement;

    if (selectedItem) {
      selectedItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [selectedIndex]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex(prev =>
            prev < displayPrompts.length - 1 ? prev + 1 : prev
          );
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex(prev => prev > 0 ? prev - 1 : prev);
          break;
        case 'Enter':
          e.preventDefault();
          if (displayPrompts[selectedIndex]) {
            handlePromptSelect(displayPrompts[selectedIndex].sessionId);
          }
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, selectedIndex, displayPrompts, onClose]);

  const handlePromptSelect = (sessionId: string) => {
    // Pass the session ID to the parent handler
    // The AgentMode component will handle loading the session
    onSessionSelect(sessionId);
    onClose();
  };

  const extractPromptText = (content: string): string => {
    // Try to parse as JSON first (some prompts are stored as {"prompt": "..."})
    try {
      const parsed = JSON.parse(content);
      if (parsed.prompt) {
        return parsed.prompt;
      }
    } catch {
      // Not JSON, return as-is
    }
    return content;
  };

  const truncatePrompt = (text: string, maxLength: number = 120): string => {
    const extracted = extractPromptText(text);
    if (extracted.length <= maxLength) return extracted;
    return extracted.substring(0, maxLength) + '...';
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="prompt-quick-open-backdrop" onClick={onClose} />
      <div className="prompt-quick-open-modal">
        <div className="prompt-quick-open-header">
          <input
            ref={searchInputRef}
            type="text"
            className="prompt-quick-open-search"
            placeholder="Search your prompts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="prompt-quick-open-results">
          {displayPrompts.length === 0 ? (
            <div className="prompt-quick-open-empty">
              {searchQuery ? 'No prompts found' : 'No recent prompts'}
            </div>
          ) : (
            <ul className="prompt-quick-open-list" ref={resultsListRef}>
              {displayPrompts.map((prompt, index) => (
                <li
                  key={prompt.id}
                  className={`prompt-quick-open-item ${
                    index === selectedIndex ? 'selected' : ''
                  }`}
                  onClick={() => handlePromptSelect(prompt.sessionId)}
                  onMouseEnter={() => {
                    if (mouseHasMoved) {
                      setSelectedIndex(index);
                    }
                  }}
                >
                  <div className="prompt-quick-open-item-icon">
                    <ProviderIcon provider={prompt.provider || 'claude'} size={16} />
                  </div>
                  <div className="prompt-quick-open-item-content">
                    <div className="prompt-quick-open-item-text">
                      {truncatePrompt(prompt.content)}
                    </div>
                    <div className="prompt-quick-open-item-meta">
                      <span className="prompt-quick-open-session-title">
                        {prompt.sessionTitle}
                        {prompt.parentSessionId && (
                          <span className="prompt-quick-open-badge workstream-badge">
                            In Workstream
                          </span>
                        )}
                      </span>
                      <span className="prompt-quick-open-time">
                        {getRelativeTimeString(prompt.createdAt)}
                      </span>
                    </div>
                  </div>
                  <div className="prompt-quick-open-item-right">
                    <PromptStatusIndicator sessionId={prompt.sessionId} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="prompt-quick-open-footer">
          <span className="prompt-quick-open-hint">
            <kbd>Up/Down</kbd> Navigate
          </span>
          <span className="prompt-quick-open-hint">
            <kbd>Enter</kbd> Open
          </span>
          <span className="prompt-quick-open-hint">
            <kbd>Esc</kbd> Close
          </span>
        </div>
      </div>
    </>
  );
};
