// console.log('[RENDERER] index.tsx executing at', new Date().toISOString());

import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider as JotaiProvider } from 'jotai';
import App from './App';
import './index.css';
import './styles/components.css';
import posthog from "posthog-js";
import {PostHogProvider} from "posthog-js/react";
import {beforePostHogSendWeb} from "../main/services/analytics/analytics-utils.ts";
import { initMonacoEditor } from './utils/monacoConfig';
import { store } from '@nimbalyst/runtime/store';
import { initializeTheme } from './hooks/useTheme';
import { offscreenEditorRenderer } from './services/OffscreenEditorRenderer';
import {
  voiceModeSettingsAtom,
  initVoiceModeSettings,
  notificationSettingsAtom,
  initNotificationSettings,
  advancedSettingsAtom,
  initAdvancedSettings,
  syncConfigAtom,
  initSyncConfig,
  aiDebugSettingsAtom,
  initAIDebugSettings,
  aiProviderSettingsAtom,
  initAIProviderSettings,
  agentModeSettingsAtom,
  initAgentModeSettings,
  developerFeatureSettingsAtom,
  initDeveloperFeatureSettings,
  externalEditorSettingsAtom,
  initExternalEditorSettings,
} from './store/atoms/appSettings';
import {
  claudeUsageIndicatorEnabledAtom,
  initClaudeUsageIndicatorSetting,
} from './store/atoms/claudeUsageAtoms';
import {
  codexUsageIndicatorEnabledAtom,
  initCodexUsageIndicatorSetting,
} from './store/atoms/codexUsageAtoms';

// console.log('[RENDERER] Imports complete at', new Date().toISOString());

// Initialize Monaco Editor before rendering any components
initMonacoEditor();

// Initialize theme from main process and set up IPC listener
// This must happen before React renders to avoid flash
initializeTheme();

// Initialize offscreen editor renderer and set up IPC listeners
offscreenEditorRenderer.initialize();

// Expose offscreen renderer on window for main process access
(window as any).offscreenEditorRenderer = offscreenEditorRenderer;

// Set up IPC listeners for offscreen editor mount/unmount
window.electronAPI.onOffscreenEditorMount(async (payload: { filePath: string; workspacePath: string }) => {
  console.log('[Renderer] Received offscreen-editor:mount IPC:', payload);
  try {
    await offscreenEditorRenderer.mountEditor(payload.filePath, payload.workspacePath);
  } catch (error) {
    console.error('[Renderer] Failed to mount offscreen editor:', error);
  }
});

window.electronAPI.onOffscreenEditorUnmount((payload: { filePath: string }) => {
  offscreenEditorRenderer.unmountEditor(payload.filePath);
});

// Handle screenshot capture requests
window.electronAPI.onOffscreenEditorCaptureScreenshotRequest(async (payload: { filePath: string; selector?: string; responseChannel: string }) => {
  try {
    const imageBase64 = await offscreenEditorRenderer.captureScreenshot(payload.filePath, payload.selector);
    await window.electronAPI.invoke(payload.responseChannel, { success: true, imageBase64 });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await window.electronAPI.invoke(payload.responseChannel, { success: false, error: errorMessage });
  }
});

// Initialize app settings atoms from main process
// This loads settings and hydrates the Jotai atoms before React renders
// MUST be awaited to ensure settings are loaded before components mount
await Promise.all([
  initVoiceModeSettings().then((settings) => {
    store.set(voiceModeSettingsAtom, settings);
  }),
  initNotificationSettings().then((settings) => {
    store.set(notificationSettingsAtom, settings);
  }),
  initAdvancedSettings().then((settings) => {
    store.set(advancedSettingsAtom, settings);
  }),
  initSyncConfig().then((config) => {
    store.set(syncConfigAtom, config);
  }),
  initAIDebugSettings().then((settings) => {
    store.set(aiDebugSettingsAtom, settings);
  }),
  initAIProviderSettings().then((settings) => {
    store.set(aiProviderSettingsAtom, settings);
  }),
  initAgentModeSettings().then((settings) => {
    store.set(agentModeSettingsAtom, settings);
  }),
  initDeveloperFeatureSettings().then((settings) => {
    store.set(developerFeatureSettingsAtom, settings);
  }),
  initExternalEditorSettings().then((settings) => {
    store.set(externalEditorSettingsAtom, settings);
  }),
  initClaudeUsageIndicatorSetting().then((enabled) => {
    store.set(claudeUsageIndicatorEnabledAtom, enabled);
  }),
  initCodexUsageIndicatorSetting().then((enabled) => {
    store.set(codexUsageIndicatorEnabledAtom, enabled);
  }),
]).catch(() => {
  // Ignore errors - settings will use defaults
});


const rootElement = document.getElementById('root') as HTMLElement;
// console.log('[RENDERER] Root element:', rootElement, 'at', new Date().toISOString());

const root = ReactDOM.createRoot(rootElement);
// console.log('[RENDERER] React root created at', new Date().toISOString());

const analyticsId = await window.electronAPI.analytics?.getDistinctId() ?? '';
const analyticsAllowed = await window.electronAPI.analytics?.allowedToSendAnalytics() ?? false;
const isDevInstallation = process.env.NODE_ENV?.toLowerCase() === 'development';
const isDevMode = process.env.IS_DEV_MODE === 'true';
const isOfficialBuild = process.env.OFFICIAL_BUILD === 'true';

// Add dev mode indicator to body for styling (only for npm run dev, not packaged builds or Playwright)
if (isDevMode && !(window as any).PLAYWRIGHT) {
  document.body.setAttribute('data-dev-mode', 'true');
  const devLabel = window.DEV_MODE_LABEL ?? 'DEV MODE';
  document.body.style.setProperty('--dev-mode-label', `'${devLabel}'`);
}

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

// Set up IPC listener for queued prompt claimed events
// This forwards the IPC message to a DOM CustomEvent that SessionTranscript listens for
window.electronAPI.on('ai:promptClaimed', (data: { sessionId: string; promptId: string }) => {
  window.dispatchEvent(new CustomEvent('ai:promptClaimed', { detail: data }));
});

root.render(
  <React.StrictMode>
    <JotaiProvider store={store}>
      <PostHogProvider client={posthogClient}>
        <App />
      </PostHogProvider>
    </JotaiProvider>
  </React.StrictMode>
);

// console.log('[RENDERER] React render called at', new Date().toISOString());
