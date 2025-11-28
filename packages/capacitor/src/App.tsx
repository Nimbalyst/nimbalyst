import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { SyncProvider } from './contexts/SyncContext';
import { SessionListScreen } from './screens/SessionListScreen';
import { SessionDetailScreen } from './screens/SessionDetailScreen';
import { SettingsScreen } from './screens/SettingsScreen';

export function App() {
  return (
    <SyncProvider>
      <div className="min-h-screen bg-[var(--surface-primary)] safe-area-top safe-area-bottom">
        <Routes>
          <Route path="/" element={<SessionListScreen />} />
          <Route path="/session/:sessionId" element={<SessionDetailScreen />} />
          <Route path="/settings" element={<SettingsScreen />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </SyncProvider>
  );
}
