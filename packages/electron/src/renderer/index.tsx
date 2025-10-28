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
const posthogClient = posthog.init(
  'phc_s3lQIILexwlGHvxrMBqti355xUgkRocjMXW4LjV0ATw',
  {
    opt_out_capturing_by_default: !analyticsAllowed,
    bootstrap: {
      distinctID: analyticsId,
    },
    autocapture: false,
    capture_heatmaps: false,
    disable_session_recording: true,
    capture_exceptions: false,
    session_idle_timeout_seconds: 30 * 60, // 30 minutes
    loaded: (posthog) => {
      console.log(`[RENDERER] PostHog loaded (analytics ID: ${posthog.get_distinct_id()}, session: ${posthog.get_session_id()})`);
      if (!analyticsAllowed) {
        console.log('[RENDERER] Opting out of granular analytics as the user has not consented');
      }
    },
    before_send: beforePostHogSendWeb
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
