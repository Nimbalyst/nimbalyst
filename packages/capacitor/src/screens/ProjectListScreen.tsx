import React, { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSync } from '../contexts/CollabV3SyncContext';
import { SyncStatusBadge } from '../components/SyncStatusBadge';

export function ProjectListScreen() {
  const navigate = useNavigate();
  const {
    projects,
    isConfigured,
    refresh,
    status,
    hasReceivedInitialData,
  } = useSync();
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Pull-to-refresh state
  const [pullDistance, setPullDistance] = useState(0);
  const [isPulling, setIsPulling] = useState(false);
  const touchStartY = useRef<number>(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const pullThreshold = 80;

  const handleRefresh = async () => {
    setIsRefreshing(true);
    refresh();
    setTimeout(() => setIsRefreshing(false), 1000);
  };

  // Pull-to-refresh handlers
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer || isRefreshing) return;

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

    if (deltaY > 0 && scrollContainer.scrollTop === 0) {
      e.preventDefault();
      const resistance = 0.5;
      const distance = Math.min(deltaY * resistance, pullThreshold * 1.5);
      setPullDistance(distance);
    }
  }, [isPulling, isRefreshing, pullThreshold]);

  const handleTouchEnd = useCallback(() => {
    if (!isPulling) return;

    setIsPulling(false);

    if (pullDistance >= pullThreshold) {
      handleRefresh();
    }

    setPullDistance(0);
    touchStartY.current = 0;
  }, [isPulling, pullDistance, pullThreshold]);

  const handleProjectClick = (projectId: string) => {
    // URL-encode the project ID since it may contain slashes (file paths)
    navigate(`/project/${encodeURIComponent(projectId)}/sessions`);
  };

  const isLoading = isConfigured && !hasReceivedInitialData;

  return (
    <div className="flex flex-col w-full overflow-x-hidden bg-[var(--surface-primary)]" style={{ height: '100dvh' }}>
      {/* Header */}
      <header className="flex-shrink-0 flex items-center justify-between px-3 py-2 border-b border-[var(--border-primary)] bg-[var(--surface-secondary)] safe-area-top">
        <div className="flex items-center gap-1">
          <span className="font-semibold text-[17px] text-[var(--text-primary)] px-2">Projects</span>
        </div>
        <div className="flex items-center gap-1">
          <SyncStatusBadge />
          <button
            onClick={() => navigate('/settings')}
            className="p-1.5 rounded-lg hover:bg-[var(--surface-tertiary)] text-[var(--text-secondary)]"
            title="Settings"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
          </button>
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
              description="Sign in and scan the QR code from Nimbalyst desktop to sync your AI sessions."
              steps={[
                "Sign in with Google or Email",
                "Open Nimbalyst on your desktop",
                "Scan the pairing QR code"
              ]}
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
          ) : projects.length === 0 ? (
            <EmptyState
              icon={
                <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--text-tertiary)]">
                  <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/>
                  <path d="M14 2v4a2 2 0 0 0 2 2h4"/>
                </svg>
              }
              title="No Projects Yet"
              description="Start an AI session in Nimbalyst desktop and it will appear here automatically."
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
            <div className="py-2">
              {projects.map((project) => (
                <button
                  key={project.id}
                  onClick={() => handleProjectClick(project.id)}
                  className="w-full flex items-center justify-between px-4 py-3.5 border-b border-[var(--border-primary)] hover:bg-[var(--surface-secondary)] active:bg-[var(--surface-tertiary)] transition-colors text-left"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-[16px] text-[var(--text-primary)] truncate">
                      {project.name.includes('/') ? project.name.split('/').pop() : project.name}
                    </div>
                    <div className="text-[13px] text-[var(--text-secondary)] mt-0.5">
                      {project.sessionCount} {project.sessionCount === 1 ? 'session' : 'sessions'}
                    </div>
                  </div>
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
                    className="text-[var(--text-tertiary)] flex-shrink-0 ml-3"
                  >
                    <path d="m9 18 6-6-6-6"/>
                  </svg>
                </button>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  steps?: string[];
  action?: React.ReactNode;
}

function EmptyState({ icon, title, description, steps, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[300px] px-8 text-center">
      <div className="mb-4">{icon}</div>
      <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-2">{title}</h2>
      <p className="text-sm text-[var(--text-secondary)] mb-4 max-w-xs">{description}</p>
      {steps && steps.length > 0 && (
        <div className="mb-6 text-left">
          {steps.map((step, index) => (
            <div key={index} className="flex items-start gap-3 mb-2">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[var(--primary-color)] text-white text-xs font-semibold flex items-center justify-center">
                {index + 1}
              </span>
              <span className="text-sm text-[var(--text-secondary)] pt-0.5">{step}</span>
            </div>
          ))}
        </div>
      )}
      {!steps && <div className="mb-2" />}
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
      <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-2">Loading Projects</h2>
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
