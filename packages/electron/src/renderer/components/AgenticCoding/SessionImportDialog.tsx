import React, { useCallback, useEffect, useState } from 'react';
import './SessionImportDialog.css';
import { getRelativeTimeString } from '../../utils/dateFormatting';

interface SessionToImport {
  sessionId: string;
  workspacePath: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  syncStatus: 'new' | 'up-to-date' | 'needs-update';
  dbMessageCount: number;
  selected: boolean;
}

interface SessionsByWorkspace {
  [workspacePath: string]: SessionToImport[];
}

interface SessionImportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (sessionIds: string[]) => Promise<void>;
  currentWorkspacePath: string;
  filterByWorkspace?: boolean; // If true, only show sessions for current workspace
}

export const SessionImportDialog: React.FC<SessionImportDialogProps> = ({
  isOpen,
  onClose,
  onImport,
  currentWorkspacePath,
  filterByWorkspace = true  // Default to filtering by current workspace
}) => {
  const [sessions, setSessions] = useState<SessionToImport[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<Set<string>>(new Set());

  // Load sessions when dialog opens
  useEffect(() => {
    if (isOpen) {
      loadSessions();
    }
  }, [isOpen]);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Pass workspacePath to only scan sessions for current workspace when filtering
      const result = await window.electronAPI.invoke('claude-code:scan-sessions', {
        workspacePath: filterByWorkspace ? currentWorkspacePath : undefined
      });

      if (result.success && Array.isArray(result.sessions)) {
        // Auto-select new and needs-update sessions
        const sessionsWithSelection = result.sessions.map((s: any) => ({
          ...s,
          selected: s.syncStatus === 'new' || s.syncStatus === 'needs-update',
        }));
        setSessions(sessionsWithSelection);

        // Auto-expand current workspace
        setExpandedWorkspaces(new Set([currentWorkspacePath]));
      } else {
        setError(result.error || 'Failed to load sessions');
      }
    } catch (err) {
      console.error('[SessionImportDialog] Failed to load sessions:', err);
      setError('Failed to load sessions');
    } finally {
      setLoading(false);
    }
  }, [currentWorkspacePath, filterByWorkspace]);

  const handleImport = async () => {
    const selectedSessionIds = sessions
      .filter(s => s.selected)
      .map(s => s.sessionId);

    if (selectedSessionIds.length === 0) {
      return;
    }

    setImporting(true);
    setError(null);

    try {
      await onImport(selectedSessionIds);
      onClose();
    } catch (err) {
      console.error('[SessionImportDialog] Failed to import sessions:', err);
      setError('Failed to import sessions');
    } finally {
      setImporting(false);
    }
  };

  const toggleSession = (sessionId: string) => {
    setSessions(prev =>
      prev.map(s => (s.sessionId === sessionId ? { ...s, selected: !s.selected } : s))
    );
  };

  const toggleWorkspace = (workspacePath: string) => {
    const workspaceSessions = sessions.filter(s => s.workspacePath === workspacePath);
    const allSelected = workspaceSessions.every(s => s.selected);

    setSessions(prev =>
      prev.map(s =>
        s.workspacePath === workspacePath ? { ...s, selected: !allSelected } : s
      )
    );
  };

  const toggleExpandWorkspace = (workspacePath: string) => {
    setExpandedWorkspaces(prev => {
      const next = new Set(prev);
      if (next.has(workspacePath)) {
        next.delete(workspacePath);
      } else {
        next.add(workspacePath);
      }
      return next;
    });
  };

  const selectAll = () => {
    setSessions(prev => prev.map(s => ({ ...s, selected: true })));
  };

  const deselectAll = () => {
    setSessions(prev => prev.map(s => ({ ...s, selected: false })));
  };

  // Group sessions by workspace and sort by updatedAt (most recent first)
  const sessionsByWorkspace: SessionsByWorkspace = sessions.reduce((acc, session) => {
    if (!acc[session.workspacePath]) {
      acc[session.workspacePath] = [];
    }
    acc[session.workspacePath].push(session);
    return acc;
  }, {} as SessionsByWorkspace);

  // Sort sessions within each workspace by updatedAt (most recent first)
  Object.keys(sessionsByWorkspace).forEach(workspace => {
    sessionsByWorkspace[workspace].sort((a, b) => b.updatedAt - a.updatedAt);
  });

  const workspacePaths = Object.keys(sessionsByWorkspace).sort();

  // Count stats
  const totalSessions = sessions.length;
  const newSessions = sessions.filter(s => s.syncStatus === 'new').length;
  const needsUpdate = sessions.filter(s => s.syncStatus === 'needs-update').length;
  const inSync = sessions.filter(s => s.syncStatus === 'up-to-date').length;
  const selectedCount = sessions.filter(s => s.selected).length;

  if (!isOpen) {
    return null;
  }

  return (
    <div className="session-import-dialog-overlay" onClick={onClose}>
      <div className="session-import-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="session-import-dialog-header">
          <h2>Import Claude Code Sessions</h2>
          <button
            className="session-import-dialog-close"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {loading ? (
          <div className="session-import-dialog-loading">
            <p>Scanning ~/.claude/projects/...</p>
          </div>
        ) : error ? (
          <div className="session-import-dialog-error">
            <p>{error}</p>
            <button onClick={loadSessions}>Retry</button>
          </div>
        ) : (
          <>
            <div className="session-import-dialog-stats">
              <div className="session-import-stat">
                <span className="session-import-stat-value">{totalSessions}</span>
                <span className="session-import-stat-label">Total</span>
              </div>
              <div className="session-import-stat">
                <span className="session-import-stat-value">{newSessions}</span>
                <span className="session-import-stat-label">New</span>
              </div>
              <div className="session-import-stat">
                <span className="session-import-stat-value">{needsUpdate}</span>
                <span className="session-import-stat-label">Updates</span>
              </div>
              <div className="session-import-stat">
                <span className="session-import-stat-value">{inSync}</span>
                <span className="session-import-stat-label">In Sync</span>
              </div>
            </div>

            <div className="session-import-dialog-actions">
              <button onClick={selectAll} className="session-import-action-button">
                Select All
              </button>
              <button onClick={deselectAll} className="session-import-action-button">
                Deselect All
              </button>
            </div>

            <div className="session-import-dialog-content">
              {workspacePaths.length === 0 ? (
                <div className="session-import-empty">
                  <p>No Claude Code sessions found</p>
                  <p className="session-import-empty-hint">
                    Sessions from the CLI will appear here
                  </p>
                </div>
              ) : (
                workspacePaths.map(workspacePath => {
                  const workspaceSessions = sessionsByWorkspace[workspacePath];
                  const isExpanded = expandedWorkspaces.has(workspacePath);
                  const workspaceName = workspacePath.split('/').filter(Boolean).pop() || workspacePath;
                  const allSelected = workspaceSessions.every(s => s.selected);
                  const someSelected = workspaceSessions.some(s => s.selected);

                  return (
                    <div key={workspacePath} className="session-import-workspace-group">
                      <div className="session-import-workspace-header">
                        <button
                          className="session-import-workspace-toggle"
                          onClick={() => toggleExpandWorkspace(workspacePath)}
                        >
                          <svg
                            width="12"
                            height="12"
                            viewBox="0 0 16 16"
                            fill="none"
                            style={{ transform: isExpanded ? 'rotate(90deg)' : 'none' }}
                          >
                            <path d="M6 12L10 8L6 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </button>
                        <input
                          type="checkbox"
                          checked={allSelected}
                          ref={input => {
                            if (input) {
                              input.indeterminate = someSelected && !allSelected;
                            }
                          }}
                          onChange={() => toggleWorkspace(workspacePath)}
                          aria-label={`Select all sessions in ${workspaceName}`}
                        />
                        <span className="session-import-workspace-name">{workspaceName}</span>
                        <span className="session-import-workspace-count">
                          ({workspaceSessions.length})
                        </span>
                      </div>

                      {isExpanded && (
                        <div className="session-import-session-list">
                          {workspaceSessions.map(session => (
                            <div
                              key={session.sessionId}
                              data-id={session.sessionId}
                              className="session-import-session-item"
                            >
                              <input
                                type="checkbox"
                                checked={session.selected}
                                onChange={() => toggleSession(session.sessionId)}
                                aria-label={`Select ${session.title}`}
                              />
                              <div className="session-import-session-info">
                                <div className="session-import-session-title">{session.title}</div>
                                <div className="session-import-session-meta">
                                  <span>{getRelativeTimeString(session.updatedAt)}</span>
                                  <span>•</span>
                                  <span>{session.messageCount} messages</span>
                                  <span>•</span>
                                  <span>{session.tokenUsage.totalTokens.toLocaleString()} tokens</span>
                                  <span>•</span>
                                  <span className={`session-import-status-badge ${session.syncStatus}`}>
                                    {session.syncStatus === 'new' && 'New'}
                                    {session.syncStatus === 'up-to-date' && 'In Sync'}
                                    {session.syncStatus === 'needs-update' && `${session.messageCount - session.dbMessageCount} new messages`}
                                  </span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            <div className="session-import-dialog-footer">
              <button
                className="session-import-button-secondary"
                onClick={onClose}
                disabled={importing}
              >
                Cancel
              </button>
              <button
                className="session-import-button-primary"
                onClick={handleImport}
                disabled={importing || selectedCount === 0}
              >
                {importing ? 'Importing...' : `Import ${selectedCount} Session${selectedCount !== 1 ? 's' : ''}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
