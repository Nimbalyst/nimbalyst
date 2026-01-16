import { useEffect, useRef, useCallback, useState } from 'react';
import { LocalNotifications } from '@capacitor/local-notifications';
import { useNavigate, useLocation } from 'react-router-dom';
import { useSync } from '../contexts/CollabV3SyncContext';

/**
 * Notification permission status
 */
type PermissionStatus = 'prompt' | 'granted' | 'denied' | 'unknown';

/**
 * Hook that manages agent completion notifications.
 *
 * Features:
 * - Requests notification permission on first use
 * - Tracks isExecuting state transitions per session
 * - Shows local notification when agent completes and app is backgrounded
 * - Navigates to session on notification tap
 * - Only notifies when desktop is not active (Phase 2)
 */
export function useAgentNotifications() {
  const navigate = useNavigate();
  const location = useLocation();
  const { sessions, connectedDevices } = useSync();
  const [permissionStatus, setPermissionStatus] = useState<PermissionStatus>('unknown');

  // Track previous isExecuting state per session to detect transitions
  const previousExecutingRef = useRef<Map<string, boolean>>(new Map());

  // Track if app is in background
  const isBackgroundedRef = useRef(false);

  // Get current session ID from route (if viewing a session)
  const getCurrentSessionId = useCallback((): string | null => {
    const match = location.pathname.match(/\/session\/([^/]+)/);
    return match ? match[1] : null;
  }, [location.pathname]);

  // Request notification permission
  const requestPermission = useCallback(async () => {
    try {
      const result = await LocalNotifications.requestPermissions();
      const status = result.display === 'granted' ? 'granted' :
                     result.display === 'denied' ? 'denied' : 'prompt';
      setPermissionStatus(status);
      return status;
    } catch (error) {
      console.error('[AgentNotifications] Error requesting permission:', error);
      setPermissionStatus('denied');
      return 'denied';
    }
  }, []);

  // Check current permission status
  const checkPermission = useCallback(async () => {
    try {
      const result = await LocalNotifications.checkPermissions();
      const status = result.display === 'granted' ? 'granted' :
                     result.display === 'denied' ? 'denied' : 'prompt';
      setPermissionStatus(status);
      return status;
    } catch (error) {
      console.error('[AgentNotifications] Error checking permission:', error);
      return 'unknown';
    }
  }, []);

  // Show a notification for agent completion
  const showCompletionNotification = useCallback(async (
    sessionId: string,
    sessionTitle: string | undefined
  ) => {
    if (permissionStatus !== 'granted') {
      console.log('[AgentNotifications] Permission not granted, skipping notification');
      return;
    }

    try {
      await LocalNotifications.schedule({
        notifications: [
          {
            id: Math.floor(Math.random() * 100000),
            title: 'Agent Response Ready',
            body: sessionTitle
              ? `${sessionTitle}: Your agent has completed its response`
              : 'Your agent has completed its response',
            extra: { sessionId },
            // iOS-specific settings
            sound: 'default',
            // Schedule immediately
            schedule: { at: new Date() },
          },
        ],
      });
      console.log('[AgentNotifications] Scheduled notification for session:', sessionId);
    } catch (error) {
      console.error('[AgentNotifications] Error showing notification:', error);
    }
  }, [permissionStatus]);

  // Check if any desktop device is currently active
  const isDesktopActive = useCallback(() => {
    // Find any desktop device
    const desktopDevice = connectedDevices.find(d => d.type === 'desktop');

    if (!desktopDevice) {
      // No desktop connected - user is definitely away
      return false;
    }

    // Phase 2: Check if desktop is focused and recently active
    // For now, if desktop is connected, assume user might be there
    // TODO: Add is_focused and last_active_at checks when presence is implemented
    const deviceWithStatus = desktopDevice as {
      is_focused?: boolean;
      status?: 'active' | 'idle' | 'away';
      last_active_at: number;
    };

    // If we have explicit status, use it
    if (deviceWithStatus.status) {
      return deviceWithStatus.status === 'active';
    }

    // If we have focus info, use it
    if (typeof deviceWithStatus.is_focused === 'boolean') {
      if (!deviceWithStatus.is_focused) {
        return false; // Desktop not focused = user away
      }
      // Desktop focused, check activity
      const idleTime = Date.now() - deviceWithStatus.last_active_at;
      const IDLE_THRESHOLD = 5 * 60 * 1000; // 5 minutes
      return idleTime < IDLE_THRESHOLD;
    }

    // Fallback: Desktop connected but no presence info yet
    // Be conservative - assume user is at desktop
    return true;
  }, [connectedDevices]);

  // Initialize: check permission status on mount
  useEffect(() => {
    console.log('[AgentNotifications] Hook mounted');
    checkPermission().then(status => {
      console.log('[AgentNotifications] Initial permission status:', status);
    });
  }, [checkPermission]);

  // Set up notification tap handler
  useEffect(() => {
    const setupListeners = async () => {
      // Handle notification tap
      await LocalNotifications.addListener('localNotificationActionPerformed', (event) => {
        const sessionId = event.notification.extra?.sessionId;
        if (sessionId) {
          console.log('[AgentNotifications] Notification tapped, navigating to session:', sessionId);
          navigate(`/session/${sessionId}`);
        }
      });
    };

    setupListeners();

    return () => {
      LocalNotifications.removeAllListeners();
    };
  }, [navigate]);

  // Track sessions that were executing when we backgrounded
  const executingWhenBackgroundedRef = useRef<Set<string>>(new Set());

  // Track app visibility and detect completions on return
  useEffect(() => {
    const handleVisibilityChange = () => {
      const wasBackgrounded = isBackgroundedRef.current;
      const isNowBackgrounded = document.visibilityState === 'hidden';
      isBackgroundedRef.current = isNowBackgrounded;

      if (isNowBackgrounded) {
        // Going to background - record which sessions are currently executing
        executingWhenBackgroundedRef.current = new Set(
          sessions.filter(s => s.isExecuting).map(s => s.id)
        );
        addDebugLog(`BG: tracking ${executingWhenBackgroundedRef.current.size} executing`);
      } else if (wasBackgrounded) {
        // Returning from background - check if any tracked sessions completed
        const completedWhileAway: string[] = [];
        for (const sessionId of executingWhenBackgroundedRef.current) {
          const session = sessions.find(s => s.id === sessionId);
          if (session && !session.isExecuting) {
            completedWhileAway.push(sessionId);
          }
        }

        if (completedWhileAway.length > 0) {
          addDebugLog(`FG: ${completedWhileAway.length} completed while away!`);
          // Show notification for the most recent one
          const session = sessions.find(s => s.id === completedWhileAway[0]);
          if (session && permissionStatus === 'granted') {
            addDebugLog('>>> SENDING NOTIFICATION (on return) <<<');
            showCompletionNotification(session.id, session.title);
          }
        } else {
          addDebugLog('FG: nothing completed while away');
        }

        executingWhenBackgroundedRef.current.clear();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [sessions, permissionStatus, showCompletionNotification]);

  // Track which sessions were initiated by mobile (to notify when they complete)
  const mobileInitiatedSessionsRef = useRef<Set<string>>(new Set());

  // Debug log history (persists across background/foreground)
  const debugLogRef = useRef<string[]>([]);
  const addDebugLog = (msg: string) => {
    const timestamp = new Date().toLocaleTimeString();
    debugLogRef.current.push(`${timestamp}: ${msg}`);
    // Keep last 20 entries
    if (debugLogRef.current.length > 20) {
      debugLogRef.current.shift();
    }
  };

  // Detect isExecuting transitions and show notifications
  useEffect(() => {
    addDebugLog(`Effect: perm=${permissionStatus}, sessions=${sessions.length}, bg=${isBackgroundedRef.current}`);

    if (permissionStatus !== 'granted') {
      addDebugLog('Permission not granted, skipping');
      return;
    }

    for (const session of sessions) {
      const prevExecuting = previousExecutingRef.current.get(session.id);
      const currExecuting = session.isExecuting ?? false;

      // Log when session starts executing to see pendingExecution data
      if (currExecuting && prevExecuting !== true) {
        addDebugLog(`EXEC START: ${session.id.slice(0, 8)}, sentBy=${session.pendingExecution?.sentBy || 'none'}`);
      }

      // Track if this execution was initiated by mobile
      if (currExecuting && session.pendingExecution?.sentBy === 'mobile') {
        addDebugLog(`Mobile initiated: ${session.id.slice(0, 8)}`);
        mobileInitiatedSessionsRef.current.add(session.id);
      }

      // Detect transition from executing to not executing (agent completed)
      if (prevExecuting === true && currExecuting === false) {
        const wasMobileInitiated = mobileInitiatedSessionsRef.current.has(session.id);
        const desktopActive = isDesktopActive();
        const currentSessionId = getCurrentSessionId();
        const isViewingThisSession = currentSessionId === session.id;

        addDebugLog(`COMPLETED: bg=${isBackgroundedRef.current}, mobile=${wasMobileInitiated}, desktop=${desktopActive}, viewing=${isViewingThisSession}`);

        // Clear the tracking for this session
        mobileInitiatedSessionsRef.current.delete(session.id);

        // Notify if:
        // 1. App is backgrounded (handled by APNs in future, skip for now - WebSocket suspended)
        // 2. App is in foreground but user is NOT viewing this session
        const shouldNotify = !isViewingThisSession && (wasMobileInitiated || !desktopActive);

        if (shouldNotify) {
          addDebugLog('>>> SENDING NOTIFICATION <<<');
          showCompletionNotification(session.id, session.title);
        } else {
          addDebugLog(`SKIPPED: viewing=${isViewingThisSession}, deskActive=${desktopActive}`);
        }
      }

      // Update tracking
      previousExecutingRef.current.set(session.id, currExecuting);
    }
  }, [sessions, permissionStatus, showCompletionNotification, isDesktopActive, getCurrentSessionId]);

  // Debug state for UI display
  const debugState = {
    permissionStatus,
    isBackgrounded: isBackgroundedRef.current,
    sessionCount: sessions.length,
    mobileInitiatedCount: mobileInitiatedSessionsRef.current.size,
    executingSessions: sessions.filter(s => s.isExecuting).map(s => s.id),
    desktopActive: isDesktopActive(),
    logs: debugLogRef.current,
  };

  return {
    permissionStatus,
    requestPermission,
    checkPermission,
    isDesktopActive,
    debugState,
  };
}
