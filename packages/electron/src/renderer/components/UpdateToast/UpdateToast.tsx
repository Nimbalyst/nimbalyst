import React, { useEffect, useState, useCallback } from 'react';
import { UpdateAvailableToast } from './UpdateAvailableToast';
import { ReleaseNotesDialog } from './ReleaseNotesDialog';
import { DownloadProgressToast } from './DownloadProgressToast';
import { UpdateReadyToast } from './UpdateReadyToast';
import './UpdateToast.css';

export type UpdateState = 'idle' | 'checking' | 'up-to-date' | 'available' | 'viewing-notes' | 'downloading' | 'ready' | 'error';

export interface UpdateInfo {
  version: string;
  releaseNotes?: string;
  releaseDate?: string;
}

export interface DownloadProgress {
  bytesPerSecond: number;
  percent: number;
  transferred: number;
  total: number;
}

export function UpdateToast(): React.ReactElement | null {
  const [state, setState] = useState<UpdateState>('idle');
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [currentVersion, setCurrentVersion] = useState<string>('');
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');

  // Check for reminder suppression
  const checkReminderSuppression = useCallback(async (version: string): Promise<boolean> => {
    try {
      const result = await window.electronAPI.invoke('update:check-reminder-suppression', version);
      return result.suppressed === true;
    } catch (error) {
      console.error('[UpdateToast] Failed to check reminder suppression:', error);
      return false;
    }
  }, []);

  // Set up IPC listeners
  useEffect(() => {
    const handleUpdateAvailable = async (data: {
      currentVersion: string;
      newVersion: string;
      releaseNotes?: string;
      releaseDate?: string;
    }) => {
      console.log('[UpdateToast] Update available:', data);

      // Check if reminder is suppressed for this version
      const suppressed = await checkReminderSuppression(data.newVersion);
      if (suppressed) {
        console.log('[UpdateToast] Reminder suppressed for version:', data.newVersion);
        return;
      }

      setCurrentVersion(data.currentVersion);
      setUpdateInfo({
        version: data.newVersion,
        releaseNotes: data.releaseNotes,
        releaseDate: data.releaseDate,
      });
      setState('available');
    };

    const handleDownloadProgress = (data: DownloadProgress) => {
      console.log('[UpdateToast] Download progress:', data.percent);
      setDownloadProgress(data);
      if (state !== 'downloading') {
        setState('downloading');
      }
    };

    const handleUpdateReady = (data: { version: string }) => {
      console.log('[UpdateToast] Update ready:', data);
      setUpdateInfo(prev => prev ? { ...prev, version: data.version } : { version: data.version });
      setState('ready');
    };

    const handleUpdateError = (data: { message: string }) => {
      console.log('[UpdateToast] Update error:', data);
      setErrorMessage(data.message);
      setState('error');
    };

    const handleCheckingForUpdate = () => {
      console.log('[UpdateToast] Checking for updates...');
      setState('checking');
    };

    const handleUpToDate = () => {
      console.log('[UpdateToast] Already up to date');
      setState('up-to-date');
      // Auto-dismiss after 3 seconds
      setTimeout(() => {
        setState((currentState) => currentState === 'up-to-date' ? 'idle' : currentState);
      }, 3000);
    };

    // Register listeners
    window.electronAPI.on('update-toast:show-available', handleUpdateAvailable);
    window.electronAPI.on('update-toast:progress', handleDownloadProgress);
    window.electronAPI.on('update-toast:show-ready', handleUpdateReady);
    window.electronAPI.on('update-toast:error', handleUpdateError);
    window.electronAPI.on('update-toast:checking', handleCheckingForUpdate);
    window.electronAPI.on('update-toast:up-to-date', handleUpToDate);

    // Get current version
    window.electronAPI.invoke('get-current-version').then((version: string) => {
      setCurrentVersion(version);
    }).catch((error: Error) => {
      console.error('[UpdateToast] Failed to get current version:', error);
    });

    return () => {
      window.electronAPI.off?.('update-toast:show-available', handleUpdateAvailable);
      window.electronAPI.off?.('update-toast:progress', handleDownloadProgress);
      window.electronAPI.off?.('update-toast:show-ready', handleUpdateReady);
      window.electronAPI.off?.('update-toast:error', handleUpdateError);
      window.electronAPI.off?.('update-toast:checking', handleCheckingForUpdate);
      window.electronAPI.off?.('update-toast:up-to-date', handleUpToDate);
    };
  }, [state, checkReminderSuppression]);

  // Action handlers
  const handleUpdateNow = useCallback(() => {
    console.log('[UpdateToast] Update now clicked');
    setState('downloading');
    window.electronAPI.send('update-toast:download');
  }, []);

  const handleViewReleaseNotes = useCallback(() => {
    console.log('[UpdateToast] View release notes clicked');
    setState('viewing-notes');
  }, []);

  const handleRemindLater = useCallback(async () => {
    console.log('[UpdateToast] Remind later clicked');
    if (updateInfo) {
      try {
        await window.electronAPI.invoke('update:set-reminder-suppression', updateInfo.version);
      } catch (error) {
        console.error('[UpdateToast] Failed to set reminder suppression:', error);
      }
    }
    setState('idle');
    setUpdateInfo(null);
  }, [updateInfo]);

  const handleDismiss = useCallback(() => {
    console.log('[UpdateToast] Dismiss clicked');
    setState('idle');
    setUpdateInfo(null);
  }, []);

  const handleCloseReleaseNotes = useCallback(() => {
    console.log('[UpdateToast] Close release notes clicked');
    setState('available');
  }, []);

  const handleUpdateFromNotes = useCallback(() => {
    console.log('[UpdateToast] Update from release notes clicked');
    setState('downloading');
    window.electronAPI.send('update-toast:download');
  }, []);

  const handleCancelDownload = useCallback(() => {
    console.log('[UpdateToast] Cancel download clicked');
    // Note: electron-updater doesn't support canceling downloads directly
    // We'll just hide the toast and let the download continue in the background
    setState('idle');
    setUpdateInfo(null);
    setDownloadProgress(null);
  }, []);

  const handleRelaunch = useCallback(() => {
    console.log('[UpdateToast] Relaunch clicked');
    window.electronAPI.send('update-toast:install');
  }, []);

  const handleDoItLater = useCallback(() => {
    console.log('[UpdateToast] Do it later clicked');
    setState('idle');
    setUpdateInfo(null);
    setDownloadProgress(null);
  }, []);

  // Don't render anything if idle
  if (state === 'idle') {
    return null;
  }

  return (
    <>
      {/* Toast container for all toast states */}
      {(state === 'checking' || state === 'up-to-date' || state === 'available' || state === 'downloading' || state === 'ready' || state === 'error') && (
        <div className="update-toast-container" data-testid="update-toast-container" data-state={state}>
          {state === 'checking' && (
            <div className="update-toast update-toast-checking" data-testid="update-checking-toast">
              <div className="update-toast-spinner" />
              <div className="update-toast-title">Checking for updates...</div>
            </div>
          )}

          {state === 'up-to-date' && (
            <div className="update-toast update-toast-up-to-date" data-testid="update-up-to-date-toast">
              <button className="update-toast-dismiss" onClick={handleDismiss} title="Dismiss" aria-label="Dismiss" data-testid="update-toast-dismiss">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
              <div className="update-toast-check-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              </div>
              <div className="update-toast-title">You're up to date!</div>
              <div className="update-toast-subtitle">Nimbalyst {currentVersion} is the latest version.</div>
            </div>
          )}

          {state === 'available' && updateInfo && (
            <UpdateAvailableToast
              version={updateInfo.version}
              onUpdateNow={handleUpdateNow}
              onViewReleaseNotes={handleViewReleaseNotes}
              onRemindLater={handleRemindLater}
              onDismiss={handleDismiss}
            />
          )}

          {state === 'downloading' && updateInfo && downloadProgress && (
            <DownloadProgressToast
              version={updateInfo.version}
              progress={downloadProgress}
              onCancel={handleCancelDownload}
            />
          )}

          {state === 'ready' && updateInfo && (
            <UpdateReadyToast
              version={updateInfo.version}
              onRelaunch={handleRelaunch}
              onDoItLater={handleDoItLater}
              onDismiss={handleDismiss}
            />
          )}

          {state === 'error' && (
            <div className="update-toast update-toast-error" data-testid="update-error-toast">
              <button className="update-toast-dismiss" onClick={handleDismiss} title="Dismiss" aria-label="Dismiss" data-testid="update-toast-dismiss">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
              <div className="update-toast-title">Update Error</div>
              <div className="update-toast-subtitle" data-testid="error-message">{errorMessage}</div>
              <div className="update-toast-actions">
                <button className="update-toast-btn update-toast-btn-secondary" onClick={handleDismiss} data-testid="error-dismiss-btn">
                  Dismiss
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Release notes dialog (modal) */}
      {state === 'viewing-notes' && updateInfo && (
        <ReleaseNotesDialog
          currentVersion={currentVersion}
          newVersion={updateInfo.version}
          releaseNotes={updateInfo.releaseNotes || ''}
          onClose={handleCloseReleaseNotes}
          onUpdate={handleUpdateFromNotes}
        />
      )}
    </>
  );
}

export default UpdateToast;
