import React, { useCallback, useEffect, useState } from 'react';
import { CollapsibleGroup } from './CollapsibleGroup';
import { SessionListItem } from './SessionListItem';
import { groupSessionsByTime, TimeGroupKey } from '../../utils/dateFormatting';
import './SessionHistory.css';

interface SessionItem {
  id: string;
  title?: string;
  createdAt: number;
}

interface SessionHistoryProps {
  workspacePath: string;
  activeSessionId: string | null;
  onSessionSelect: (sessionId: string) => void;
  onSessionDelete?: (sessionId: string) => void;
  collapsedGroups: string[];
  onCollapsedGroupsChange: (groups: string[]) => void;
}

export const SessionHistory: React.FC<SessionHistoryProps> = ({
  workspacePath,
  activeSessionId,
  onSessionSelect,
  onSessionDelete,
  collapsedGroups,
  onCollapsedGroupsChange
}) => {
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Load sessions from database
  const loadSessions = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await window.electronAPI.invoke('sessions:list', workspacePath);

      if (result.success && Array.isArray(result.sessions)) {
        // Filter to only coding sessions
        const codingSessions = result.sessions
          .filter((s: any) => s.sessionType === 'coding')
          .map((s: any) => ({
            id: s.id,
            title: s.title || s.name || 'Untitled Session',
            createdAt: s.createdAt
          }));
        setSessions(codingSessions);
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
  }, [loadSessions]);

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

  // Filter sessions by search query
  const filteredSessions = searchQuery
    ? sessions.filter(session =>
        session.title?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : sessions;

  // Group sessions by time
  const groupedSessions = groupSessionsByTime(filteredSessions);
  const groupKeys = Object.keys(groupedSessions) as TimeGroupKey[];

  if (loading) {
    return (
      <div className="session-history">
        <div className="session-history-header">
          <h3 className="session-history-title">Sessions</h3>
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
        </div>
        <div className="session-history-empty">
          <p>No coding sessions yet</p>
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
        <h3 className="session-history-title">Sessions</h3>
        <span className="session-history-count">{sessions.length}</span>
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
                  onClick={() => onSessionSelect(session.id)}
                  onDelete={onSessionDelete ? () => handleDeleteSession(session.id) : undefined}
                />
              ))}
            </CollapsibleGroup>
          );
        })}
      </div>
    </div>
  );
};
