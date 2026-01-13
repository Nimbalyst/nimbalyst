import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App as CapacitorApp } from '@capacitor/app';
import { App } from './App';
import { analyticsService } from './services/AnalyticsService';
import './styles/global.css';

// Get version from Capacitor app info (falls back to package version in dev)
const APP_VERSION = '0.1.0';

// Initialize analytics and track app open
async function initAnalytics() {
  await analyticsService.init();
  analyticsService.capture('mobile_app_opened', {
    platform: 'ios',
    $set: { nimbalyst_mobile_version: APP_VERSION },
  });
}

// Track app returning to foreground
CapacitorApp.addListener('appStateChange', ({ isActive }) => {
  if (isActive) {
    analyticsService.capture('mobile_app_opened', {
      platform: 'ios',
      $set: { nimbalyst_mobile_version: APP_VERSION },
    });
  }
});

// Start analytics init (don't block render)
initAnalytics().catch(console.error);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
