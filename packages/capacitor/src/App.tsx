import React, { useEffect, useCallback, useState } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { CollabV3SyncProvider, useSync, reportMobileActivity } from './contexts/CollabV3SyncContext';
import { ProjectListScreen } from './screens/ProjectListScreen';
import { SessionListScreen } from './screens/SessionListScreen';
import { SessionDetailScreen } from './screens/SessionDetailScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { VoiceControlScreen } from './screens/VoiceControlScreen';
import { SplitView, useIsSplitView } from './components/SplitView';
import { SwipeNavigation } from './components/SwipeNavigation';
import { setupDeepLinkListener, type StytchSession } from './services/StytchAuthService';
import { useAgentNotifications } from './hooks/useAgentNotifications';
import { setupPushNotificationListeners, initializePushNotifications, type PushNotificationPayload } from './services/PushNotificationService';
import { LocalNotifications } from '@capacitor/local-notifications';

// Minimized debug button
function NotificationDebugButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        position: 'fixed',
        top: 50,
        right: 10,
        background: '#333',
        color: '#0f0',
        padding: '4px 8px',
        borderRadius: 4,
        fontSize: 10,
        fontFamily: 'monospace',
        zIndex: 9999,
        border: 'none',
      }}
    >
      DBG
    </button>
  );
}

// Debug overlay for notification testing - shows log history from background
function NotificationDebugOverlay({ debugState, onClose, onCopy }: { debugState: any; onClose: () => void; onCopy: () => void }) {
  // Force re-render every second to update logs display
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => forceUpdate(n => n + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 60,
        left: 10,
        right: 10,
        background: 'rgba(0,0,0,0.95)',
        color: '#0f0',
        padding: 12,
        borderRadius: 8,
        fontSize: 10,
        fontFamily: 'monospace',
        zIndex: 9999,
        maxHeight: '50vh',
        overflow: 'auto',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <strong>Notification Debug</strong>
        <div>
          <button onClick={onCopy} style={{ color: '#0ff', background: 'none', border: 'none', fontSize: 12, marginRight: 8 }}>COPY</button>
          <button onClick={onClose} style={{ color: '#f00', background: 'none', border: 'none', fontSize: 14 }}>X</button>
        </div>
      </div>
      <div style={{ marginBottom: 8 }}>
        <span style={{ color: debugState.permissionStatus === 'granted' ? '#0f0' : '#f00' }}>Perm:{debugState.permissionStatus}</span>
        {' | '}
        <span style={{ color: debugState.desktopActive ? '#f00' : '#0f0' }}>Desk:{debugState.desktopActive ? 'ON' : 'OFF'}</span>
        {' | '}
        Exec:{debugState.executingSessions?.length || 0}
      </div>
      <div style={{ borderTop: '1px solid #333', paddingTop: 8 }}>
        <strong>Log:</strong>
        {debugState.logs?.slice(-10).map((log: string, i: number) => (
          <div key={i} style={{ color: log.includes('SENDING') ? '#0ff' : log.includes('SKIPPED') ? '#f80' : '#0f0' }}>
            {log}
          </div>
        ))}
        {(!debugState.logs || debugState.logs.length === 0) && <div style={{ color: '#666' }}>No events yet</div>}
      </div>
    </div>
  );
}

function AppContent() {
  const isSplitView = useIsSplitView();
  const navigate = useNavigate();
  const { reconnect } = useSync();
  const [showDebug, setShowDebug] = useState(false); // Start minimized

  // Initialize agent notifications (tracks isExecuting transitions, shows local notifications)
  const { debugState } = useAgentNotifications();

  // Copy logs to clipboard
  const copyLogs = useCallback(() => {
    const logText = [
      `Perm: ${debugState.permissionStatus}`,
      `Desktop: ${debugState.desktopActive}`,
      `Sessions: ${debugState.sessionCount}`,
      `Executing: ${debugState.executingSessions?.join(', ') || 'none'}`,
      '---',
      ...(debugState.logs || []),
    ].join('\n');
    navigator.clipboard.writeText(logText);
  }, [debugState]);

  // Track user activity for presence awareness
  useEffect(() => {
    const handleActivity = () => reportMobileActivity();

    // Touch events for mobile interaction
    document.addEventListener('touchstart', handleActivity);
    document.addEventListener('touchmove', handleActivity);
    // Scroll events
    document.addEventListener('scroll', handleActivity, true);

    return () => {
      document.removeEventListener('touchstart', handleActivity);
      document.removeEventListener('touchmove', handleActivity);
      document.removeEventListener('scroll', handleActivity, true);
    };
  }, []);

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
      // Show error to user
      alert(error);
    };

    const cleanup = setupDeepLinkListener(handleAuthSuccess, handleAuthError);
    return cleanup;
  }, [reconnect, navigate]);

  // Initialize push notifications once at app startup
  // This sets up the APNs registration listener and triggers registration
  useEffect(() => {
    initializePushNotifications();
  }, []);

  // Get current session ID from route
  const getCurrentSessionId = useCallback((): string | null => {
    const match = location.pathname.match(/\/session\/([^/]+)/);
    return match ? match[1] : null;
  }, [location.pathname]);

  // Set up push notification listeners for navigation on tap
  useEffect(() => {
    const handleNotificationReceived = async (payload: PushNotificationPayload) => {
      console.log('[App] Push notification received in foreground:', payload.sessionId);

      // If viewing a different session (or no session), show a local notification
      const currentSessionId = getCurrentSessionId();
      if (payload.sessionId && payload.sessionId !== currentSessionId) {
        console.log('[App] Different session, showing local notification');
        try {
          await LocalNotifications.schedule({
            notifications: [{
              id: Date.now(), // Unique ID
              title: payload.title || 'Agent completed',
              body: payload.body || 'Tap to view',
              schedule: { at: new Date(Date.now() + 100) }, // Near-immediate
              extra: { sessionId: payload.sessionId },
            }],
          });
        } catch (err) {
          console.error('[App] Failed to show local notification:', err);
        }
      }
    };

    const handleNotificationTapped = (payload: PushNotificationPayload) => {
      console.log('[App] Push notification tapped:', payload.sessionId);
      if (payload.sessionId) {
        // Navigate to the session that completed
        navigate(`/session/${payload.sessionId}`);
      }
    };

    const cleanup = setupPushNotificationListeners(
      handleNotificationReceived,
      handleNotificationTapped
    );
    return cleanup;
  }, [navigate, getCurrentSessionId]);

  // On iPad, the session list is in the sidebar
  // So the main area shows either session detail, settings, or an empty state
  if (isSplitView) {
    return (
      <>
        <SplitView>
          <Routes>
            <Route path="/" element={<SplitViewPlaceholder />} />
            <Route path="/session/:sessionId" element={<SessionDetailScreen hiddenBackButton />} />
            <Route path="/settings" element={<SettingsScreen />} />
            <Route path="/voice/:sessionId" element={<VoiceControlScreen />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </SplitView>
        {/* Debug button hidden for now - needs better UX for access */}
        {false && (showDebug ? (
          <NotificationDebugOverlay debugState={debugState} onClose={() => setShowDebug(false)} onCopy={copyLogs} />
        ) : (
          <NotificationDebugButton onClick={() => setShowDebug(true)} />
        ))}
      </>
    );
  }

  // On iPhone, use standard stack navigation with swipe-to-go-back
  // Navigation flow: Projects -> Sessions (by project) -> Session Detail
  return (
    <>
      <SwipeNavigation>
        <Routes>
          <Route path="/" element={<ProjectListScreen />} />
          <Route path="/project/:projectId/sessions" element={<SessionListScreen />} />
          <Route path="/session/:sessionId" element={<SessionDetailScreen />} />
          <Route path="/settings" element={<SettingsScreen />} />
          <Route path="/voice/:sessionId" element={<VoiceControlScreen />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </SwipeNavigation>
      {/* Debug button hidden for now - needs better UX for access */}
      {false && (showDebug ? (
        <NotificationDebugOverlay debugState={debugState} onClose={() => setShowDebug(false)} onCopy={copyLogs} />
      ) : (
        <NotificationDebugButton onClick={() => setShowDebug(true)} />
      ))}
    </>
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
          className="mx-auto mb-4 text-[var(--nim-text-faint)]"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
        <h2 className="text-lg font-medium text-[var(--nim-text-muted)] mb-2">
          Select a Session
        </h2>
        <p className="text-sm text-[var(--nim-text-faint)]">
          Choose a session from the sidebar to view the conversation
        </p>
      </div>
    </div>
  );
}

export function App() {
  return (
    <CollabV3SyncProvider>
      <div className="min-h-screen bg-nim">
        <AppContent />
      </div>
    </CollabV3SyncProvider>
  );
}
