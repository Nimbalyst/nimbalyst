import React, { useCallback, useEffect, useState } from 'react';
import { CollapsibleGroup } from './CollapsibleGroup';
import { SessionListItem } from './SessionListItem';
import { groupSessionsByTime, TimeGroupKey } from '../../utils/dateFormatting';
import './SessionHistory.css';

interface SessionItem {
  id: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
  provider: string;
  model?: string;
  sessionType?: 'chat' | 'planning' | 'coding';
  messageCount: number;
  isProcessing?: boolean;
  hasUnread?: boolean;
}

interface SessionHistoryProps {
  workspacePath: string;
  activeSessionId: string | null;
  loadedSessionIds?: string[]; // IDs of sessions loaded in tabs
  processingSessions?: Set<string>; // IDs of sessions currently processing
  unreadSessions?: Set<string>; // IDs of sessions with unread messages
  renamedSession?: { id: string; title: string } | null; // Session that was just renamed
  updatedSession?: { id: string; timestamp: number } | null; // Session that was just updated
  onSessionSelect: (sessionId: string) => void;
  onSessionDelete?: (sessionId: string) => void;
  onNewSession?: () => void;
  onImportSessions?: () => void; // Callback for opening import dialog
  collapsedGroups: string[];
  onCollapsedGroupsChange: (groups: string[]) => void;
  refreshTrigger?: number; // Optional trigger to force refresh
}

// Generate a consistent color based on workspace path
function generateWorkspaceColor(path: string): string {
  let hash = 0;
  for (let i = 0; i < path.length; i++) {
    hash = ((hash << 5) - hash) + path.charCodeAt(i);
    hash = hash & hash;
  }

  // Generate a hue value (0-360)
  const hue = Math.abs(hash) % 360;
  // Use consistent saturation and lightness for pleasant colors
  return `hsl(${hue}, 65%, 55%)`;
}

export const SessionHistory: React.FC<SessionHistoryProps> = ({
  workspacePath,
  activeSessionId,
  loadedSessionIds = [],
  processingSessions = new Set(),
  unreadSessions = new Set(),
  renamedSession = null,
  updatedSession = null,
  onSessionSelect,
  onSessionDelete,
  onNewSession,
  onImportSessions,
  collapsedGroups,
  onCollapsedGroupsChange,
  refreshTrigger
}) => {
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'updated' | 'created'>('updated');
  const [sortDropdownOpen, setSortDropdownOpen] = useState(false);

  // Extract workspace name from path
  const workspaceName = workspacePath.split('/').filter(Boolean).pop() || 'Workspace';
  const workspaceColor = generateWorkspaceColor(workspacePath);

  // Load sessions from database
  const loadSessions = useCallback(async (query?: string) => {
    try {
      setLoading(true);
      setError(null);

      // Use search endpoint if query is provided, otherwise use list endpoint
      const result = query && query.trim()
        ? await window.electronAPI.invoke('sessions:search', workspacePath, query.trim())
        : await window.electronAPI.invoke('sessions:list', workspacePath);

      if (result.success && Array.isArray(result.sessions)) {
        // Map sessions with base data only. Visual indicators (isProcessing, hasUnread)
        // are applied separately by the useEffect below to avoid stale closure issues.
        const allSessions = result.sessions.map((s: any) => ({
          id: s.id,
          title: s.title || s.name || 'Untitled Session',
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
          provider: s.provider || 'claude',
          model: s.model,
          sessionType: s.sessionType || 'chat',
          messageCount: s.messageCount || 0,
          isProcessing: false,  // Will be updated by visual indicator effect
          hasUnread: false      // Will be updated by visual indicator effect
        }));
        setSessions(allSessions);
      }
    } catch (err) {
      console.error('[SessionHistory] Failed to load sessions:', err);
      setError('Failed to load sessions');
    } finally {
      setLoading(false);
    }
  }, [workspacePath]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions, refreshTrigger]);

  // Debounced search effect
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      loadSessions(searchQuery);
    }, 300); // 300ms debounce

    return () => clearTimeout(timeoutId);
  }, [searchQuery, loadSessions]);

  // Update visual indicators (processing state, unread badges) without reloading from database
  useEffect(() => {
    setSessions(prevSessions => prevSessions.map(session => ({
      ...session,
      isProcessing: processingSessions.has(session.id),
      hasUnread: unreadSessions.has(session.id)
    })));
  }, [processingSessions, unreadSessions]);

  // Update session title when renamed (efficient update without database reload)
  useEffect(() => {
    if (renamedSession) {
      setSessions(prevSessions => prevSessions.map(session => {
        if (session.id === renamedSession.id) {
          return { ...session, title: renamedSession.title };
        }
        return session;
      }));
    }
  }, [renamedSession]);

  // Update session timestamp when updated (efficient update without database reload)
  useEffect(() => {
    if (updatedSession) {
      setSessions(prevSessions => prevSessions.map(session => {
        if (session.id === updatedSession.id) {
          return { ...session, updatedAt: updatedSession.timestamp };
        }
        return session;
      }));
    }
  }, [updatedSession]);

  const handleToggleGroup = (groupName: string) => {
    if (collapsedGroups.includes(groupName)) {
      onCollapsedGroupsChange(collapsedGroups.filter(g => g !== groupName));
    } else {
      onCollapsedGroupsChange([...collapsedGroups, groupName]);
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    if (onSessionDelete) {
      onSessionDelete(sessionId);
      // Reload sessions after delete
      await loadSessions();
    }
  };

  const toggleSortDropdown = () => {
    setSortDropdownOpen(!sortDropdownOpen);
  };

  const selectSortOption = (option: 'updated' | 'created') => {
    setSortBy(option);
    setSortDropdownOpen(false);
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (sortDropdownOpen) {
        const target = e.target as HTMLElement;
        if (!target.closest('.session-history-sort-dropdown')) {
          setSortDropdownOpen(false);
        }
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [sortDropdownOpen]);

  // No client-side filtering - search is done server-side
  // Group sessions by time - ALWAYS use updatedAt for grouping
  const groupedSessions = groupSessionsByTime(sessions, 'updatedAt');
  const groupKeys = Object.keys(groupedSessions) as TimeGroupKey[];

  if (loading) {
    return (
      <div className="session-history">
        <div className="workspace-color-accent" style={{ backgroundColor: workspaceColor }} />
        <div className="session-history-header">
          <div className="session-history-header-identity">
            <h3 className="session-history-header-name">{workspaceName}</h3>
            <div className="session-history-header-path">{workspacePath}</div>
          </div>
          <div className="session-history-header-buttons">
            {onImportSessions && (
              <button
                className="session-history-import-button"
                data-testid="import-sessions-button"
                onClick={onImportSessions}
                title="Import Claude Code sessions"
                aria-label="Import sessions"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M13.5 8.5V12.5C13.5 13.0523 13.0523 13.5 12.5 13.5H3.5C2.94772 13.5 2.5 13.0523 2.5 12.5V8.5M8 2.5V10.5M8 10.5L5.5 8M8 10.5L10.5 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            )}
            {onNewSession && (
              <button
                className="session-history-new-button"
                data-testid="new-session-button"
                onClick={onNewSession}
                title="Create new session"
                aria-label="Create new session"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M8 3V13M3 8H13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </button>
            )}
          </div>
        </div>
        <div className="session-history-section-label">Agent Sessions</div>
        <div className="session-history-search">
          <input
            type="text"
            className="session-history-search-input"
            placeholder="Search sessions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search sessions"
          />
        </div>
        <div className="session-history-filters">
          <div className="session-history-sort-dropdown">
            <button
              className="session-history-sort-button"
              onClick={toggleSortDropdown}
              title={`Sorted by: ${sortBy === 'updated' ? 'Last Updated' : 'Created'}`}
              aria-label="Sort sessions"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M8 2V14M8 14L4 10M8 14L12 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            {sortDropdownOpen && (
              <div className="session-history-sort-menu">
                <button
                  className={`session-history-sort-option ${sortBy === 'updated' ? 'active' : ''}`}
                  onClick={() => selectSortOption('updated')}
                >
                  <span>Last Updated</span>
                  {sortBy === 'updated' && (
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M13 4L6 11L3 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </button>
                <button
                  className={`session-history-sort-option ${sortBy === 'created' ? 'active' : ''}`}
                  onClick={() => selectSortOption('created')}
                >
                  <span>Created</span>
                  {sortBy === 'created' && (
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M13 4L6 11L3 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="session-history-loading">
          <span>Searching sessions...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="session-history">
        <div className="workspace-color-accent" style={{ backgroundColor: workspaceColor }} />
        <div className="session-history-header">
          <div className="session-history-header-identity">
            <h3 className="session-history-header-name">{workspaceName}</h3>
            <div className="session-history-header-path">{workspacePath}</div>
          </div>
          {onNewSession && (
            <button
              className="session-history-new-button"
              onClick={(e) => {
                e.stopPropagation();
                onNewSession();
              }}
              title="Create new session"
              aria-label="Create new session"
              type="button"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M8 3V13M3 8H13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </button>
          )}
        </div>
        <div className="session-history-section-label">Agent Sessions</div>
        <div className="session-history-error">
          <span>{error}</span>
        </div>
      </div>
    );
  }

  // Check if we have an active search query
  const hasSearchQuery = searchQuery.trim().length > 0;

  if (sessions.length === 0 && !hasSearchQuery) {
    // No sessions at all - show simple empty state without search
    return (
      <div className="session-history">
        <div className="workspace-color-accent" style={{ backgroundColor: workspaceColor }} />
        <div className="session-history-header">
          <div className="session-history-header-identity">
            <h3 className="session-history-header-name">{workspaceName}</h3>
            <div className="session-history-header-path">{workspacePath}</div>
          </div>
          {onNewSession && (
            <button
              className="session-history-new-button"
              onClick={(e) => {
                e.stopPropagation();
                onNewSession();
              }}
              title="Create new session"
              aria-label="Create new session"
              type="button"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M8 3V13M3 8H13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </button>
          )}
        </div>
        <div className="session-history-section-label">Agent Sessions</div>
        <div className="session-history-empty">
          <p>No sessions yet</p>
          <p className="session-history-empty-hint">
            Create a new session to get started
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="session-history">
      <div className="workspace-color-accent" style={{ backgroundColor: workspaceColor }} />
      <div className="session-history-header">
        <div className="session-history-header-identity">
          <h3 className="session-history-header-name">{workspaceName}</h3>
          <div className="session-history-header-path">{workspacePath}</div>
        </div>
        <div className="session-history-header-buttons">
          {onImportSessions && (
            <button
              className="session-history-import-button"
              data-testid="import-sessions-button"
              onClick={onImportSessions}
              title="Import Claude Code sessions"
              aria-label="Import sessions"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M13.5 8.5V12.5C13.5 13.0523 13.0523 13.5 12.5 13.5H3.5C2.94772 13.5 2.5 13.0523 2.5 12.5V8.5M8 2.5V10.5M8 10.5L5.5 8M8 10.5L10.5 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          )}
          {onNewSession && (
            <button
              className="session-history-new-button"
              data-testid="new-session-button"
              onClick={onNewSession}
              title="Create new session"
              aria-label="Create new session"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M8 3V13M3 8H13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </button>
          )}
        </div>
      </div>
      <div className="session-history-section-label">Agent Sessions</div>
      <div className="session-history-search">
        <input
          type="text"
          className="session-history-search-input"
          placeholder="Search sessions..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label="Search sessions"
        />
      </div>
      <div className="session-history-filters">
        <div className="session-history-sort-dropdown">
          <button
            className="session-history-sort-button"
            onClick={toggleSortDropdown}
            title={`Sorted by: ${sortBy === 'updated' ? 'Last Updated' : 'Created'}`}
            aria-label="Sort sessions"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M8 2V14M8 14L4 10M8 14L12 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          {sortDropdownOpen && (
            <div className="session-history-sort-menu">
              <button
                className={`session-history-sort-option ${sortBy === 'updated' ? 'active' : ''}`}
                onClick={() => selectSortOption('updated')}
              >
                <span>Last Updated</span>
                {sortBy === 'updated' && (
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M13 4L6 11L3 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </button>
              <button
                className={`session-history-sort-option ${sortBy === 'created' ? 'active' : ''}`}
                onClick={() => selectSortOption('created')}
              >
                <span>Created</span>
                {sortBy === 'created' && (
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M13 4L6 11L3 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="session-history-list">
        {groupKeys.length === 0 && hasSearchQuery ? (
          // No search results - show message with option to clear
          <div className="session-history-empty">
            <p>No matching sessions found</p>
            <p className="session-history-empty-hint">
              Try a different search term or{' '}
              <button
                className="session-history-clear-search-link"
                onClick={() => setSearchQuery('')}
                type="button"
              >
                clear search
              </button>
            </p>
          </div>
        ) : (
          groupKeys.map(groupKey => {
            const groupSessions = groupedSessions[groupKey];
            const isExpanded = !collapsedGroups.includes(groupKey);

            return (
              <CollapsibleGroup
                key={groupKey}
                title={groupKey}
                isExpanded={isExpanded}
                onToggle={() => handleToggleGroup(groupKey)}
                count={groupSessions.length}
              >
                {groupSessions.map(session => (
                  <SessionListItem
                    key={session.id}
                    id={session.id}
                    title={session.title || 'Untitled Session'}
                    createdAt={session.createdAt}
                    updatedAt={session.updatedAt}
                    isActive={session.id === activeSessionId}
                    isLoaded={loadedSessionIds.includes(session.id)}
                    onClick={() => onSessionSelect(session.id)}
                    onDelete={onSessionDelete ? () => handleDeleteSession(session.id) : undefined}
                    provider={session.provider}
                    model={session.model}
                    messageCount={session.messageCount}
                    isProcessing={session.isProcessing}
                    hasUnread={session.hasUnread}
                  />
                ))}
              </CollapsibleGroup>
            );
          })
        )}
      </div>
    </div>
  );
};
