import React, { useState, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSync } from '../contexts/CollabV3SyncContext';
import { SessionCard } from '../components/SessionCard';

export function SessionListScreen() {
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId: string }>();
  const {
    allSessions,
    projects,
    isConfigured,
    refresh,
    status,
    hasReceivedInitialData,
    createSession,
    isCreatingSession,
  } = useSync();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Find the current project from the route param
  const currentProject = useMemo(() => {
    return projects.find(p => p.id === projectId) || null;
  }, [projects, projectId]);

  // Filter sessions for this project
  const sessions = useMemo(() => {
    if (!projectId) return allSessions;
    return allSessions.filter(session => {
      const sessionWorkspace = session.workspaceId || 'default';
      return sessionWorkspace === projectId;
    });
  }, [allSessions, projectId]);

  // Pull-to-refresh state
  const [pullDistance, setPullDistance] = useState(0);
  const [isPulling, setIsPulling] = useState(false);
  const touchStartY = useRef<number>(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const pullThreshold = 80; // Distance in pixels to trigger refresh

  const handleRefresh = async () => {
    setIsRefreshing(true);
    refresh();
    // Give the sync a moment to complete
    setTimeout(() => setIsRefreshing(false), 1000);
  };

  // Pull-to-refresh handlers
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer || isRefreshing) return;

    // Only start tracking if we're at the top of the scroll
    if (scrollContainer.scrollTop === 0) {
      touchStartY.current = e.touches[0].clientY;
      setIsPulling(true);
    }
  }, [isRefreshing]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isPulling || isRefreshing) return;

    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;

    const touchY = e.touches[0].clientY;
    const deltaY = touchY - touchStartY.current;

    // Only track downward pulls when at the top
    if (deltaY > 0 && scrollContainer.scrollTop === 0) {
      e.preventDefault();
      // Apply resistance to the pull (diminishing returns)
      const resistance = 0.5;
      const distance = Math.min(deltaY * resistance, pullThreshold * 1.5);
      setPullDistance(distance);
    }
  }, [isPulling, isRefreshing, pullThreshold]);

  const handleTouchEnd = useCallback(() => {
    if (!isPulling) return;

    setIsPulling(false);

    // Trigger refresh if pulled beyond threshold
    if (pullDistance >= pullThreshold) {
      handleRefresh();
    }

    // Reset pull distance with animation
    setPullDistance(0);
    touchStartY.current = 0;
  }, [isPulling, pullDistance, pullThreshold]);

  const handleCreateSession = async () => {
    setCreateError(null);

    // Use the current project ID from the route
    const targetProjectId = projectId || 'default';

    const result = await createSession(targetProjectId);

    if (result.success && result.sessionId) {
      navigate(`/session/${result.sessionId}`);
    } else {
      setCreateError(result.error || 'Failed to create session');
      setTimeout(() => setCreateError(null), 3000);
    }
  };

  // Show loading state until we've received initial data from the server
  const isLoading = isConfigured && !hasReceivedInitialData;

  // Determine if we can create a session (need to have received data and current project)
  const canCreateSession = hasReceivedInitialData && currentProject !== null;

  return (
    <div className="flex flex-col w-full overflow-x-hidden bg-[var(--surface-primary)]" style={{ height: '100dvh' }}>
      {/* Header - Fixed with safe area */}
      <header className="flex-shrink-0 flex items-center justify-between px-3 py-2 border-b border-[var(--border-primary)] bg-[var(--surface-secondary)] safe-area-top">
        <div className="flex items-center gap-1 min-w-0 flex-1">
          {/* Back button */}
          <button
            onClick={() => navigate('/')}
            className="p-1.5 rounded-lg hover:bg-[var(--surface-tertiary)] text-[var(--primary-color)] flex-shrink-0"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 18-6-6 6-6"/>
            </svg>
          </button>
          {/* Project name and session count */}
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-[17px] text-[var(--text-primary)] truncate">
              {currentProject?.name
                ? (currentProject.name.includes('/') ? currentProject.name.split('/').pop() : currentProject.name)
                : 'Sessions'}
            </div>
            {currentProject && (
              <div className="text-[12px] text-[var(--text-secondary)]">
                {sessions.length} {sessions.length === 1 ? 'session' : 'sessions'}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {/* New Session Button */}
          {canCreateSession && (
            <button
              onClick={handleCreateSession}
              disabled={isCreatingSession}
              className="p-1.5 rounded-lg hover:bg-[var(--surface-tertiary)] text-[var(--primary-color)] disabled:opacity-50"
              title="New Session"
            >
              {isCreatingSession ? (
                <svg className="animate-spin h-[18px] w-[18px]" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" x2="12" y1="5" y2="19"/>
                  <line x1="5" x2="19" y1="12" y2="12"/>
                </svg>
              )}
            </button>
          )}
        </div>
      </header>

      {/* Content */}
      <main
        ref={scrollContainerRef}
        className="flex-1 overflow-auto min-h-0"
        style={{ touchAction: 'pan-y' }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        {/* Pull-to-refresh content wrapper */}
        <div
          style={{
            transform: `translateY(${pullDistance}px)`,
            transition: isPulling ? 'none' : 'transform 0.2s ease-out',
            minHeight: '100%',
          }}
        >
        {/* Pull-to-refresh indicator */}
        {(isPulling || isRefreshing) && pullDistance > 0 && (
          <div
            className="flex items-center justify-center"
            style={{
              height: `${pullDistance}px`,
              marginTop: `-${pullDistance}px`,
            }}
          >
            <div className="flex flex-col items-center gap-1">
              {isRefreshing || pullDistance >= pullThreshold ? (
                <svg
                  className="animate-spin h-5 w-5 text-[var(--primary-color)]"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                    fill="none"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
              ) : (
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
                  className="text-[var(--text-tertiary)]"
                  style={{
                    transform: `rotate(${(pullDistance / pullThreshold) * 180}deg)`,
                    transition: 'transform 0.1s ease-out',
                  }}
                >
                  <path d="M12 5v14M19 12l-7 7-7-7" />
                </svg>
              )}
            </div>
          </div>
        )}
        {!isConfigured ? (
          <EmptyState
            icon={
              <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--text-tertiary)]">
                <rect x="3" y="3" width="7" height="7"/>
                <rect x="14" y="3" width="7" height="7"/>
                <rect x="14" y="14" width="7" height="7"/>
                <rect x="3" y="14" width="7" height="7"/>
              </svg>
            }
            title="Connect to Desktop"
            description="Sign in and scan the QR code from Nimbalyst desktop to sync your sessions."
            action={
              <button
                onClick={() => navigate('/settings')}
                className="px-6 py-2 rounded-lg font-medium text-white bg-[var(--primary-color)] hover:opacity-90 transition-opacity"
              >
                Get Started
              </button>
            }
          />
        ) : isLoading ? (
          <LoadingState />
        ) : status.error ? (
          <ErrorState error={status.error} onRetry={handleRefresh} />
        ) : sessions.length === 0 ? (
          <EmptyState
            icon={
              <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--text-tertiary)]">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
            }
            title="No Sessions Yet"
            description="Start an AI session in this project on Nimbalyst desktop and it will appear here."
            action={
              <button
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="px-6 py-2 rounded-lg font-medium text-[var(--primary-color)] border border-[var(--primary-color)] hover:bg-[var(--primary-color)] hover:text-white transition-colors disabled:opacity-50"
              >
                {isRefreshing ? 'Refreshing...' : 'Refresh'}
              </button>
            }
          />
        ) : (
          <div className="p-4">
            <div className="space-y-3">
              {sessions.map((session) => (
                <SessionCard key={session.id} session={session} />
              ))}
            </div>
          </div>
        )}
        </div>
      </main>

      {/* Error Toast */}
      {createError && (
        <div className="fixed bottom-24 left-4 right-4 bg-[var(--error-color)] text-white px-4 py-3 rounded-lg shadow-lg text-sm text-center safe-area-bottom">
          {createError}
        </div>
      )}
    </div>
  );
}

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}

function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[300px] px-8 text-center">
      <div className="mb-4">{icon}</div>
      <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-2">{title}</h2>
      <p className="text-sm text-[var(--text-secondary)] mb-6 max-w-xs">{description}</p>
      {action}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[300px] px-8 text-center">
      <div className="mb-4">
        <svg className="animate-spin h-10 w-10 text-[var(--primary-color)]" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
      </div>
      <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-2">Loading Sessions</h2>
      <p className="text-sm text-[var(--text-secondary)]">Syncing with server...</p>
    </div>
  );
}

interface ErrorStateProps {
  error: string;
  onRetry: () => void;
}

function ErrorState({ error, onRetry }: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[300px] px-8 text-center">
      <div className="mb-4">
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--error-color)]">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" x2="12" y1="8" y2="12"/>
          <line x1="12" x2="12.01" y1="16" y2="16"/>
        </svg>
      </div>
      <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-2">Connection Error</h2>
      <p className="text-sm text-[var(--text-secondary)] mb-6 max-w-xs">{error}</p>
      <button
        onClick={onRetry}
        className="px-6 py-2 rounded-lg font-medium text-white bg-[var(--primary-color)] hover:opacity-90 transition-opacity"
      >
        Retry
      </button>
    </div>
  );
}
