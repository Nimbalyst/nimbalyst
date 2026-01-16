/**
 * Push Notification Service
 *
 * Handles APNs push notification registration and token management.
 * Uses a single listener setup at app start, stores token in Preferences.
 */

import { PushNotifications } from '@capacitor/push-notifications';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

const PUSH_TOKEN_KEY = 'push_notification_token';

export interface PushNotificationPayload {
  sessionId?: string;
  title?: string;
  body?: string;
}

// In-memory cache for the token
let cachedToken: string | null = null;
let listenersInitialized = false;

// Callbacks for when token is received (used by sync context)
type TokenCallback = (token: string) => void;
const tokenCallbacks: TokenCallback[] = [];

/**
 * Get the stored push token (from memory or storage).
 * Returns null if no token is stored.
 */
export async function getStoredPushToken(): Promise<string | null> {
  if (cachedToken) {
    return cachedToken;
  }

  const { value } = await Preferences.get({ key: PUSH_TOKEN_KEY });
  if (value) {
    cachedToken = value;
    console.log('[PushNotifications] Loaded stored token:', value.substring(0, 20) + '...');
  }
  return value;
}

/**
 * Register a callback to be notified when a push token is received.
 * If a token is already available, the callback is called immediately.
 */
export async function onPushTokenReceived(callback: TokenCallback): Promise<void> {
  const existingToken = await getStoredPushToken();
  if (existingToken) {
    callback(existingToken);
  }
  tokenCallbacks.push(callback);
}

/**
 * Initialize push notification registration.
 * Sets up listeners ONCE and triggers APNs registration.
 * Call this once at app startup.
 */
export async function initializePushNotifications(): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    console.log('[PushNotifications] Not a native platform, skipping');
    return;
  }

  if (listenersInitialized) {
    console.log('[PushNotifications] Already initialized');
    return;
  }

  listenersInitialized = true;
  console.log('[PushNotifications] Initializing push notification service...');

  // Clear any stale listeners from previous sessions
  await PushNotifications.removeAllListeners();
  console.log('[PushNotifications] Cleared old listeners');

  // Set up registration listeners FIRST and await them
  await PushNotifications.addListener('registration', async (token) => {
    console.log('[PushNotifications] Received token from APNs:', token.value.substring(0, 20) + '...');

    // Store the token
    cachedToken = token.value;
    await Preferences.set({ key: PUSH_TOKEN_KEY, value: token.value });
    console.log('[PushNotifications] Token stored');

    // Notify all callbacks
    tokenCallbacks.forEach((cb) => cb(token.value));
  });

  await PushNotifications.addListener('registrationError', (error) => {
    console.error('[PushNotifications] Registration error:', error.error);
  });

  console.log('[PushNotifications] Listeners registered');

  // Check permission and register
  try {
    const permStatus = await PushNotifications.checkPermissions();
    console.log('[PushNotifications] Permission status:', permStatus.receive);

    if (permStatus.receive === 'prompt') {
      const result = await PushNotifications.requestPermissions();
      console.log('[PushNotifications] Permission request result:', result.receive);
      if (result.receive !== 'granted') {
        return;
      }
    } else if (permStatus.receive !== 'granted') {
      console.log('[PushNotifications] Permission not granted');
      return;
    }

    // Trigger APNs registration - the 'registration' listener will receive the token
    console.log('[PushNotifications] Calling register()...');
    await PushNotifications.register();
    console.log('[PushNotifications] register() completed');
  } catch (error) {
    console.error('[PushNotifications] Init failed:', error);
  }
}

/**
 * Set up listeners for incoming push notifications.
 * Call this once on app startup.
 */
export function setupPushNotificationListeners(
  onNotificationReceived: (payload: PushNotificationPayload) => void,
  onNotificationTapped: (payload: PushNotificationPayload) => void
): () => void {
  if (!Capacitor.isNativePlatform()) {
    return () => {};
  }

  // Notification received while app is in foreground
  const receivedListener = PushNotifications.addListener(
    'pushNotificationReceived',
    (notification) => {
      console.log('[PushNotifications] Received:', notification);
      onNotificationReceived({
        sessionId: notification.data?.sessionId,
        title: notification.title,
        body: notification.body,
      });
    }
  );

  // Notification tapped (app was backgrounded or terminated)
  const actionListener = PushNotifications.addListener(
    'pushNotificationActionPerformed',
    (action) => {
      console.log('[PushNotifications] Tapped:', action);
      onNotificationTapped({
        sessionId: action.notification.data?.sessionId,
        title: action.notification.title,
        body: action.notification.body,
      });
    }
  );

  // Return cleanup function
  return () => {
    receivedListener.then((l) => l.remove());
    actionListener.then((l) => l.remove());
  };
}
