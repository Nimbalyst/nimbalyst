/**
 * Voice Session Selector Screen
 *
 * Allows users to select which AI session to control via voice.
 * Shows all agent-mode sessions across all projects with their current status.
 */

import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSync, type SessionIndexEntry } from '../contexts/CollabV3SyncContext';

interface VoiceSessionCardProps {
  session: SessionIndexEntry;
  projectName?: string;
  onSelect: () => void;
}

function VoiceSessionCard({ session, projectName, onSelect }: VoiceSessionCardProps) {
  const formattedTime = formatRelativeTime(session.lastMessageAt);

  // Determine session status
  const getStatusBadge = () => {
    if (session.isExecuting) {
      return (
        <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-blue-500 text-white animate-pulse">
          Executing
        </span>
      );
    }
    if (session.hasPendingPrompt) {
      return (
        <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-purple-500 text-white">
          Waiting
        </span>
      );
    }
    if (session.pendingExecution) {
      return (
        <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-[var(--nim-warning)] text-white">
          Pending
        </span>
      );
    }
    return (
      <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-green-500/20 text-green-600">
        Ready
      </span>
    );
  };

  return (
    <button
      onClick={onSelect}
      className="w-full p-4 rounded-xl border border-[var(--nim-border)] bg-[var(--nim-bg-secondary)] hover:bg-[var(--nim-bg-tertiary)] hover:border-[var(--nim-primary)] transition-all text-left"
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {/* Agent icon */}
          <div className="w-8 h-8 rounded-lg bg-[var(--nim-primary)]/10 flex items-center justify-center flex-shrink-0">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--nim-primary)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 8V4H8" />
              <rect width="16" height="12" x="4" y="8" rx="2" />
              <path d="M2 14h2" />
              <path d="M20 14h2" />
              <path d="M15 13v2" />
              <path d="M9 13v2" />
            </svg>
          </div>
          <span className="font-semibold text-[var(--nim-text)] truncate">
            {session.title || 'Untitled Session'}
          </span>
        </div>
        {getStatusBadge()}
      </div>

      {/* Project name */}
      <div className="text-sm text-[var(--nim-text-muted)] mb-2 pl-10">
        {projectName || 'Unknown Project'}
      </div>

      {/* Last activity */}
      {session.lastMessagePreview && (
        <p className="text-sm text-[var(--nim-text-faint)] line-clamp-1 mb-2 pl-10">
          {session.lastMessagePreview}
        </p>
      )}

      <div className="flex items-center justify-between text-xs text-[var(--nim-text-faint)] pl-10">
        <span>{formattedTime}</span>
        <span>{session.messageCount || 0} messages</span>
      </div>
    </button>
  );
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;

  return new Date(timestamp).toLocaleDateString();
}

export function VoiceSessionSelector() {
  const navigate = useNavigate();
  const { allSessions, projects, isDesktopConnected, hasReceivedInitialData } = useSync();

  // Filter to agent-mode sessions only and sort by recent activity
  const agentSessions = useMemo(() => {
    return allSessions
      .filter((session) => session.mode === 'agent')
      .sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  }, [allSessions]);

  // Create a map of project IDs to names
  const projectMap = useMemo(() => {
    const map = new Map<string, string>();
    projects.forEach((p) => {
      // Use the last part of the path as the display name
      const displayName = p.name.includes('/') ? p.name.split('/').pop() || p.name : p.name;
      map.set(p.id, displayName);
    });
    return map;
  }, [projects]);

  const handleSelectSession = (sessionId: string) => {
    navigate(`/voice/${sessionId}`);
  };

  const isLoading = !hasReceivedInitialData;

  return (
    <div className="flex flex-col w-full overflow-x-hidden bg-nim h-[100dvh]">
      {/* Header */}
      <header className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-[var(--nim-border)] bg-[var(--nim-bg-secondary)] safe-area-top">
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate(-1)}
            className="p-1.5 rounded-lg hover:bg-[var(--nim-bg-tertiary)] text-[var(--nim-primary)]"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <div>
            <h1 className="font-semibold text-[17px] text-[var(--nim-text)]">Voice Control</h1>
            <p className="text-[12px] text-[var(--nim-text-muted)]">Select a session to control</p>
          </div>
        </div>

        {/* Desktop connection status */}
        <div className="flex items-center gap-1.5">
          <div
            className={`w-2 h-2 rounded-full ${
              isDesktopConnected ? 'bg-green-500' : 'bg-red-500'
            }`}
          />
          <span className="text-xs text-[var(--nim-text-muted)]">
            {isDesktopConnected ? 'Desktop connected' : 'Desktop offline'}
          </span>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 safe-area-bottom">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-full text-[var(--nim-text-muted)]">
            <div className="w-8 h-8 border-2 border-[var(--nim-primary)] border-t-transparent rounded-full animate-spin mb-3" />
            <p>Loading sessions...</p>
          </div>
        ) : !isDesktopConnected ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-8">
            <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mb-4">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="rgb(239 68 68)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect width="20" height="14" x="2" y="3" rx="2" />
                <line x1="8" x2="16" y1="21" y2="21" />
                <line x1="12" x2="12" y1="17" y2="21" />
                <line x1="2" x2="22" y1="2" y2="22" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-[var(--nim-text)] mb-2">Desktop Not Connected</h2>
            <p className="text-sm text-[var(--nim-text-muted)]">
              Open Nimbalyst on your desktop to use voice control. Your voice commands will be sent to the desktop for
              execution.
            </p>
          </div>
        ) : agentSessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-8">
            <div className="w-16 h-16 rounded-full bg-[var(--nim-primary)]/10 flex items-center justify-center mb-4">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--nim-primary)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 8V4H8" />
                <rect width="16" height="12" x="4" y="8" rx="2" />
                <path d="M2 14h2" />
                <path d="M20 14h2" />
                <path d="M15 13v2" />
                <path d="M9 13v2" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-[var(--nim-text)] mb-2">No Agent Sessions</h2>
            <p className="text-sm text-[var(--nim-text-muted)]">
              Start an agent session on your desktop to control it with voice commands.
            </p>
          </div>
        ) : (
          <>
            <p className="text-sm text-[var(--nim-text-muted)] mb-2">
              {agentSessions.length} agent {agentSessions.length === 1 ? 'session' : 'sessions'} available
            </p>
            {agentSessions.map((session) => (
              <VoiceSessionCard
                key={session.id}
                session={session}
                projectName={projectMap.get(session.workspaceId || '')}
                onSelect={() => handleSelectSession(session.id)}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
