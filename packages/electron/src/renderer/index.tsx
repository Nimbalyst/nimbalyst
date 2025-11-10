// console.log('[RENDERER] index.tsx executing at', new Date().toISOString());

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import posthog from "posthog-js";
import {PostHogProvider} from "posthog-js/react";
import {beforePostHogSendWeb} from "../main/services/analytics/analytics-utils.ts";

// console.log('[RENDERER] Imports complete at', new Date().toISOString());

const rootElement = document.getElementById('root') as HTMLElement;
// console.log('[RENDERER] Root element:', rootElement, 'at', new Date().toISOString());

const root = ReactDOM.createRoot(rootElement);
// console.log('[RENDERER] React root created at', new Date().toISOString());

const analyticsId = await window.electronAPI.analytics?.getDistinctId() ?? '';
const analyticsAllowed = await window.electronAPI.analytics?.allowedToSendAnalytics() ?? false;
const isDevInstallation = process.env.NODE_ENV?.toLowerCase() === 'development';
const isOfficialBuild = process.env.OFFICIAL_BUILD === 'true';

const posthogClient = posthog.init(
  'phc_s3lQIILexwlGHvxrMBqti355xUgkRocjMXW4LjV0ATw',
  {
    bootstrap: {
      distinctID: analyticsId,
    },
    autocapture: false,
    capture_heatmaps: false,
    disable_session_recording: true,
    capture_exceptions: false,
    session_idle_timeout_seconds: 30 * 60, // 30 minutes
    loaded: (posthog) => {
      console.log(`[RENDERER] PostHog loaded (analytics ID: ${posthog.get_distinct_id()}, session: ${posthog.get_session_id()}, official build: ${isOfficialBuild})`);

      // Mark users as dev users if they've ever used a non-official build
      // This property persists across all future events for this user
      if (!isOfficialBuild) {
        posthog.people.set_once({ is_dev_user: true });
      }
    },
    before_send: beforePostHogSendWeb,
    debug: isDevInstallation
  }
)

// syncs the session ID from posthog-js to the electron-side analytics service
posthog.onSessionId(async (sessionId: string, windowId, changeReason) => {
  window.electronAPI.analytics?.setSessionId(sessionId);
})

root.render(
  <React.StrictMode>
    <PostHogProvider client={posthogClient}>
      <App />
    </PostHogProvider>
  </React.StrictMode>
);

// console.log('[RENDERER] React render called at', new Date().toISOString());
