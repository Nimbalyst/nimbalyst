import React, { useEffect, useCallback } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { CollabV3SyncProvider, useSync } from './contexts/CollabV3SyncContext';
import { SessionListScreen } from './screens/SessionListScreen';
import { SessionDetailScreen } from './screens/SessionDetailScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { SplitView, useIsSplitView } from './components/SplitView';
import { setupDeepLinkListener, type StytchSession } from './services/StytchAuthService';

function AppContent() {
  const isSplitView = useIsSplitView();
  const navigate = useNavigate();
  const { reconnect } = useSync();

  // Set up deep link listener for auth callbacks
  useEffect(() => {
    const handleAuthSuccess = async (session: StytchSession) => {
      console.log('[App] Auth success, reconnecting sync...');
      await reconnect();
      // Navigate to home after successful auth
      navigate('/');
    };

    const handleAuthError = (error: string) => {
      console.error('[App] Auth error:', error);
      // Stay on current page, error will be shown
    };

    const cleanup = setupDeepLinkListener(handleAuthSuccess, handleAuthError);
    return cleanup;
  }, [reconnect, navigate]);

  // On iPad, the session list is in the sidebar
  // So the main area shows either session detail, settings, or an empty state
  if (isSplitView) {
    return (
      <SplitView>
        <Routes>
          <Route path="/" element={<SplitViewPlaceholder />} />
          <Route path="/session/:sessionId" element={<SessionDetailScreen hiddenBackButton />} />
          <Route path="/settings" element={<SettingsScreen />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </SplitView>
    );
  }

  // On iPhone, use standard stack navigation
  return (
    <Routes>
      <Route path="/" element={<SessionListScreen />} />
      <Route path="/session/:sessionId" element={<SessionDetailScreen />} />
      <Route path="/settings" element={<SettingsScreen />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

// Placeholder shown in main area on iPad when no session is selected
function SplitViewPlaceholder() {
  return (
    <div className="flex items-center justify-center h-full text-center p-8">
      <div>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="64"
          height="64"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="mx-auto mb-4 text-[var(--text-tertiary)]"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
        <h2 className="text-lg font-medium text-[var(--text-secondary)] mb-2">
          Select a Session
        </h2>
        <p className="text-sm text-[var(--text-tertiary)]">
          Choose a session from the sidebar to view the conversation
        </p>
      </div>
    </div>
  );
}

export function App() {
  return (
    <CollabV3SyncProvider>
      <div className="min-h-screen bg-[var(--surface-primary)] safe-area-top safe-area-bottom">
        <AppContent />
      </div>
    </CollabV3SyncProvider>
  );
}
