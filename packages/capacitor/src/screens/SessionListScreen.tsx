import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSync } from '../contexts/CollabV3SyncContext';
import { SyncStatusBadge } from '../components/SyncStatusBadge';
import { SessionCard } from '../components/SessionCard';
import { ProjectPicker } from '../components/ProjectPicker';

export function SessionListScreen() {
  const navigate = useNavigate();
  const { sessions, projects, selectedProject, selectProject, isConfigured, refresh } = useSync();
  const [showProjectPicker, setShowProjectPicker] = useState(false);

  return (
    <div className="flex flex-col h-screen">
      {/* Header - Fixed */}
      <header className="sticky top-0 z-10 flex items-center justify-between px-3 py-2 border-b border-[var(--border-primary)] bg-[var(--surface-secondary)]">
        <div className="flex items-center gap-1">
          {/* Project Picker Button */}
          <button
            onClick={() => setShowProjectPicker(true)}
            className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg hover:bg-[var(--surface-tertiary)] text-[var(--text-primary)]"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/>
              <path d="M14 2v4a2 2 0 0 0 2 2h4"/>
            </svg>
            <span className="font-medium text-sm">{selectedProject?.name || 'All Projects'}</span>
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m6 9 6 6 6-6"/>
            </svg>
          </button>
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
      <main className="flex-1 overflow-auto">
        {!isConfigured ? (
          <EmptyState
            icon={
              <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--text-tertiary)]">
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
                <polyline points="16 6 12 2 8 6"/>
                <line x1="12" x2="12" y1="2" y2="15"/>
              </svg>
            }
            title="Not Connected"
            description="Connect to a sync server to view your AI sessions from other devices."
            action={
              <button
                onClick={() => navigate('/settings')}
                className="px-6 py-2 rounded-lg font-medium text-white bg-[var(--primary-color)] hover:opacity-90 transition-opacity"
              >
                Configure Sync
              </button>
            }
          />
        ) : sessions.length === 0 ? (
          <EmptyState
            icon={
              <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--text-tertiary)]">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
            }
            title="No Sessions"
            description="AI sessions from your desktop will appear here when synced."
            action={
              <button
                onClick={refresh}
                className="px-6 py-2 rounded-lg font-medium text-[var(--primary-color)] border border-[var(--primary-color)] hover:bg-[var(--primary-color)] hover:text-white transition-colors"
              >
                Refresh
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
      </main>

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
