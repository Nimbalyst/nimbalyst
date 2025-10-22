import React, { useCallback, useEffect, useState } from 'react';
import { CollapsibleGroup } from './CollapsibleGroup';
import { SessionListItem } from './SessionListItem';
import { groupSessionsByTime, TimeGroupKey } from '../../utils/dateFormatting';
import './SessionHistory.css';

interface SessionItem {
  id: string;
  title?: string;
  createdAt: number;
  provider: string;
  model?: string;
  sessionType?: 'chat' | 'planning' | 'coding';
  messageCount: number;
}

interface SessionHistoryProps {
  workspacePath: string;
  activeSessionId: string | null;
  loadedSessionIds?: string[]; // IDs of sessions loaded in tabs
  onSessionSelect: (sessionId: string) => void;
  onSessionDelete?: (sessionId: string) => void;
  onNewSession?: () => void;
  collapsedGroups: string[];
  onCollapsedGroupsChange: (groups: string[]) => void;
  refreshTrigger?: number; // Optional trigger to force refresh
}

export const SessionHistory: React.FC<SessionHistoryProps> = ({
  workspacePath,
  activeSessionId,
  loadedSessionIds = [],
  onSessionSelect,
  onSessionDelete,
  onNewSession,
  collapsedGroups,
  onCollapsedGroupsChange,
  refreshTrigger
}) => {
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sessionTypeFilters, setSessionTypeFilters] = useState<Set<'chat' | 'planning' | 'coding'>>(
    new Set(['chat', 'planning', 'coding'])
  );

  // Load sessions from database
  const loadSessions = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await window.electronAPI.invoke('sessions:list', workspacePath);

      if (result.success && Array.isArray(result.sessions)) {
        // Map all sessions with full data
        const allSessions = result.sessions.map((s: any) => ({
          id: s.id,
          title: s.title || s.name || 'Untitled Session',
          createdAt: s.createdAt,
          provider: s.provider || 'claude',
          model: s.model,
          sessionType: s.sessionType || 'chat',
          messageCount: Array.isArray(s.messages) ? s.messages.length : 0
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

  const toggleSessionTypeFilter = (type: 'chat' | 'planning' | 'coding') => {
    const newFilters = new Set(sessionTypeFilters);
    if (newFilters.has(type)) {
      // Don't allow unchecking the last filter
      if (newFilters.size > 1) {
        newFilters.delete(type);
      }
    } else {
      newFilters.add(type);
    }
    setSessionTypeFilters(newFilters);
  };

  // Filter sessions by session type and search query
  const filteredSessions = sessions.filter(session => {
    // Apply session type filter
    const sessionType = session.sessionType || 'chat';
    if (!sessionTypeFilters.has(sessionType)) {
      return false;
    }

    // Apply search filter
    if (searchQuery) {
      return session.title?.toLowerCase().includes(searchQuery.toLowerCase());
    }

    return true;
  });

  // Group sessions by time
  const groupedSessions = groupSessionsByTime(filteredSessions);
  const groupKeys = Object.keys(groupedSessions) as TimeGroupKey[];

  if (loading) {
    return (
      <div className="session-history">
        <div className="session-history-header">
          <h3 className="session-history-title">Sessions</h3>
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
        <div className="session-history-loading">
          <span>Loading sessions...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="session-history">
        <div className="session-history-header">
          <h3 className="session-history-title">Sessions</h3>
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
        <div className="session-history-error">
          <span>{error}</span>
        </div>
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="session-history">
        <div className="session-history-header">
          <h3 className="session-history-title">Sessions</h3>
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
      <div className="session-history-header">
        <div className="session-history-header-left">
          <h3 className="session-history-title">Sessions</h3>
          <span className="session-history-count">{filteredSessions.length}</span>
        </div>
        {onNewSession && (
          <button
            className="session-history-new-button"
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
        <button
          className={`session-history-filter-button chat ${sessionTypeFilters.has('chat') ? 'active' : ''}`}
          onClick={() => toggleSessionTypeFilter('chat')}
          title="Toggle chat sessions"
        >
          Chat
        </button>
        <button
          className={`session-history-filter-button planning ${sessionTypeFilters.has('planning') ? 'active' : ''}`}
          onClick={() => toggleSessionTypeFilter('planning')}
          title="Toggle planning sessions"
        >
          Planning
        </button>
        <button
          className={`session-history-filter-button coding ${sessionTypeFilters.has('coding') ? 'active' : ''}`}
          onClick={() => toggleSessionTypeFilter('coding')}
          title="Toggle coding sessions"
        >
          Coding
        </button>
      </div>
      <div className="session-history-list">
        {groupKeys.map(groupKey => {
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
                  isActive={session.id === activeSessionId}
                  isLoaded={loadedSessionIds.includes(session.id)}
                  onClick={() => onSessionSelect(session.id)}
                  onDelete={onSessionDelete ? () => handleDeleteSession(session.id) : undefined}
                  provider={session.provider}
                  model={session.model}
                  messageCount={session.messageCount}
                />
              ))}
            </CollapsibleGroup>
          );
        })}
      </div>
    </div>
  );
};
