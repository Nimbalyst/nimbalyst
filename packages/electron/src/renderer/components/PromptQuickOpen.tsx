import React, { useState, useEffect, useRef, useMemo, memo } from 'react';
import { useAtomValue } from 'jotai';
import { ProviderIcon, MaterialSymbol } from '@nimbalyst/runtime';
import { getRelativeTimeString } from '../utils/dateFormatting';
import { sessionOrChildProcessingAtom, sessionUnreadAtom, sessionPendingPromptAtom } from '../store';

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
      <div
        className="prompt-quick-open-status processing flex items-center justify-center w-5 h-5 text-[var(--nim-primary)] opacity-80"
        title="Processing..."
      >
        <MaterialSymbol icon="progress_activity" size={14} className="animate-spin" />
      </div>
    );
  }

  if (hasPendingPrompt) {
    return (
      <div
        className="prompt-quick-open-status pending-prompt flex items-center justify-center w-5 h-5 text-[var(--nim-warning)] animate-pulse"
        title="Waiting for your response"
      >
        <MaterialSymbol icon="help" size={14} />
      </div>
    );
  }

  if (hasUnread) {
    return (
      <div
        className="prompt-quick-open-status unread flex items-center justify-center w-5 h-5 text-[var(--nim-primary)]"
        title="Unread response"
      >
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
      <div
        className="prompt-quick-open-backdrop nim-overlay z-[99998]"
        onClick={onClose}
      />
      <div className="prompt-quick-open-modal fixed top-[20%] left-1/2 -translate-x-1/2 w-[90%] max-w-[700px] max-h-[60vh] flex flex-col overflow-hidden rounded-lg z-[99999] bg-[var(--nim-bg)] border border-[var(--nim-border)] shadow-[0_20px_60px_rgba(0,0,0,0.3)]">
        <div className="prompt-quick-open-header p-3 border-b border-[var(--nim-border)] relative">
          <input
            ref={searchInputRef}
            type="text"
            className="prompt-quick-open-search nim-input w-full text-base"
            placeholder="Search your prompts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="prompt-quick-open-results flex-1 overflow-y-auto min-h-[200px]">
          {displayPrompts.length === 0 ? (
            <div className="prompt-quick-open-empty p-10 text-center text-[var(--nim-text-faint)]">
              {searchQuery ? 'No prompts found' : 'No recent prompts'}
            </div>
          ) : (
            <ul className="prompt-quick-open-list list-none m-0 p-0" ref={resultsListRef}>
              {displayPrompts.map((prompt, index) => (
                <li
                  key={prompt.id}
                  className={`prompt-quick-open-item py-3 px-4 cursor-pointer border-l-[3px] border-transparent transition-all duration-100 flex items-start gap-3 hover:bg-[var(--nim-bg-hover)] ${
                    index === selectedIndex ? 'selected bg-[rgba(0,122,255,0.1)] !border-l-[#007aff]' : ''
                  }`}
                  onClick={() => handlePromptSelect(prompt.sessionId)}
                  onMouseEnter={() => {
                    if (mouseHasMoved) {
                      setSelectedIndex(index);
                    }
                  }}
                >
                  <div className="prompt-quick-open-item-icon shrink-0 flex items-center justify-center pt-0.5 text-[var(--nim-text-muted)]">
                    <ProviderIcon provider={prompt.provider || 'claude'} size={16} />
                  </div>
                  <div className="prompt-quick-open-item-content flex-1 min-w-0">
                    <div className="prompt-quick-open-item-text text-sm text-[var(--nim-text)] leading-[1.4] mb-1 overflow-hidden text-ellipsis line-clamp-2">
                      {truncatePrompt(prompt.content)}
                    </div>
                    <div className="prompt-quick-open-item-meta text-xs text-[var(--nim-text-faint)] flex items-center gap-2">
                      <span className="prompt-quick-open-session-title flex items-center gap-1.5 overflow-hidden text-ellipsis whitespace-nowrap">
                        {prompt.sessionTitle}
                        {prompt.parentSessionId && (
                          <span className="prompt-quick-open-badge workstream-badge shrink-0 text-[10px] py-0.5 px-1.5 bg-[var(--nim-primary)] text-white rounded font-semibold">
                            In Workstream
                          </span>
                        )}
                      </span>
                      <span className="prompt-quick-open-time shrink-0 ml-auto">
                        {getRelativeTimeString(prompt.createdAt)}
                      </span>
                    </div>
                  </div>
                  <div className="prompt-quick-open-item-right shrink-0 flex items-center gap-1.5 ml-auto">
                    <PromptStatusIndicator sessionId={prompt.sessionId} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="prompt-quick-open-footer py-2 px-4 border-t border-[var(--nim-border)] flex gap-4 bg-[var(--nim-bg-secondary)]">
          <span className="prompt-quick-open-hint text-[11px] text-[var(--nim-text-faint)] flex items-center gap-1">
            <kbd className="py-0.5 px-1.5 bg-[var(--nim-bg)] border border-[var(--nim-border)] rounded font-mono text-[10px] text-[var(--nim-text)]">Up/Down</kbd> Navigate
          </span>
          <span className="prompt-quick-open-hint text-[11px] text-[var(--nim-text-faint)] flex items-center gap-1">
            <kbd className="py-0.5 px-1.5 bg-[var(--nim-bg)] border border-[var(--nim-border)] rounded font-mono text-[10px] text-[var(--nim-text)]">Enter</kbd> Open
          </span>
          <span className="prompt-quick-open-hint text-[11px] text-[var(--nim-text-faint)] flex items-center gap-1">
            <kbd className="py-0.5 px-1.5 bg-[var(--nim-bg)] border border-[var(--nim-border)] rounded font-mono text-[10px] text-[var(--nim-text)]">Esc</kbd> Close
          </span>
        </div>
      </div>
    </>
  );
};
