import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSync } from '../contexts/CollabV3SyncContext';
import { SyncStatusBadge } from './SyncStatusBadge';
import { SessionCard } from './SessionCard';
import { ProjectPicker } from './ProjectPicker';

/**
 * SplitView Layout for iPad
 *
 * Shows session list in left sidebar and session detail on the right.
 * Falls back to stack navigation on smaller screens (iPhone).
 */

const SPLIT_VIEW_BREAKPOINT = 768; // px

interface SplitViewProps {
  children: React.ReactNode;
}

export function SplitView({ children }: SplitViewProps) {
  const [isWideScreen, setIsWideScreen] = useState(
    typeof window !== 'undefined' && window.innerWidth >= SPLIT_VIEW_BREAKPOINT
  );

  useEffect(() => {
    const handleResize = () => {
      setIsWideScreen(window.innerWidth >= SPLIT_VIEW_BREAKPOINT);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // On narrow screens, just render children (standard stack navigation)
  if (!isWideScreen) {
    return <>{children}</>;
  }

  // On wide screens, render split view
  return (
    <div className="flex h-screen">
      <SessionSidebar />
      <div className="flex-1 border-l border-[var(--nim-border)]">
        {children}
      </div>
    </div>
  );
}

/**
 * Hook to determine if we're in split view mode
 */
export function useIsSplitView(): boolean {
  const [isWideScreen, setIsWideScreen] = useState(
    typeof window !== 'undefined' && window.innerWidth >= SPLIT_VIEW_BREAKPOINT
  );

  useEffect(() => {
    const handleResize = () => {
      setIsWideScreen(window.innerWidth >= SPLIT_VIEW_BREAKPOINT);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return isWideScreen;
}

/**
 * Session Sidebar component for iPad split view
 */
function SessionSidebar() {
  const navigate = useNavigate();
  const params = useParams();
  const { sessions, projects, selectedProject, selectProject, isConfigured, refresh, status } = useSync();
  const [showProjectPicker, setShowProjectPicker] = useState(false);

  const selectedSessionId = params.sessionId;

  const handleSessionClick = useCallback((sessionId: string) => {
    navigate(`/session/${sessionId}`);
  }, [navigate]);

  return (
    <div className="w-80 flex flex-col h-full bg-[var(--nim-bg-secondary)]">
      {/* Header */}
      <header className="flex items-center justify-between px-3 py-2 border-b border-[var(--nim-border)] safe-area-top">
        <div className="flex items-center gap-1">
          {/* Project Picker Button */}
          <button
            onClick={() => setShowProjectPicker(true)}
            className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg hover:bg-[var(--nim-bg-tertiary)] text-[var(--nim-text)]"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/>
              <path d="M14 2v4a2 2 0 0 0 2 2h4"/>
            </svg>
            <span className="font-medium text-sm truncate max-w-[140px]">{selectedProject?.name || 'All Projects'}</span>
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m6 9 6 6 6-6"/>
            </svg>
          </button>
        </div>
        <div className="flex items-center gap-1">
          <SyncStatusBadge />
          <button
            onClick={() => navigate('/settings')}
            className="p-1.5 rounded-lg hover:bg-[var(--nim-bg-tertiary)] text-[var(--nim-text-muted)]"
            title="Settings"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
          </button>
        </div>
      </header>

      {/* Session List */}
      <div className="flex-1 overflow-auto">
        {!isConfigured ? (
          <SidebarEmptyState
            title="Not Connected"
            description="Configure sync in settings"
            actionLabel="Settings"
            onAction={() => navigate('/settings')}
          />
        ) : sessions.length === 0 ? (
          <SidebarEmptyState
            title="No Sessions"
            description="Sessions will appear here"
            actionLabel="Refresh"
            onAction={refresh}
          />
        ) : (
          <div className="p-2 space-y-1">
            {sessions.map((session) => (
              <button
                key={session.id}
                onClick={() => handleSessionClick(session.id)}
                className={`w-full text-left rounded-lg transition-colors ${
                  selectedSessionId === session.id
                    ? 'bg-[var(--nim-primary)] bg-opacity-10'
                    : 'hover:bg-[var(--nim-bg-tertiary)]'
                }`}
              >
                <SessionCard
                  session={session}
                  compact
                  isSelected={selectedSessionId === session.id}
                />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Project Picker Dialog */}
      {showProjectPicker && (
        <ProjectPicker
          projects={projects}
          selectedProject={selectedProject}
          onSelectProject={selectProject}
          onClose={() => setShowProjectPicker(false)}
        />
      )}
    </div>
  );
}

interface SidebarEmptyStateProps {
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
}

function SidebarEmptyState({ title, description, actionLabel, onAction }: SidebarEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full p-6 text-center">
      <h3 className="text-sm font-medium text-[var(--nim-text)] mb-1">{title}</h3>
      <p className="text-xs text-[var(--nim-text-faint)] mb-3">{description}</p>
      <button
        onClick={onAction}
        className="px-4 py-1.5 text-xs font-medium rounded-lg text-[var(--nim-primary)] border border-[var(--nim-primary)] hover:bg-[var(--nim-primary)] hover:text-white transition-colors"
      >
        {actionLabel}
      </button>
    </div>
  );
}
