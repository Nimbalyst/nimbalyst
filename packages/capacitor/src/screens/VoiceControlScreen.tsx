/**
 * Voice Control Screen
 *
 * The main voice control interface for a selected session.
 * Handles recording, transcription, and command validation before sending to desktop.
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useCollabV3Sync as useSync, type SessionIndexEntry } from '../contexts/CollabV3SyncContext';
import { VoiceCaptureService } from '../services/VoiceCaptureService';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Capacitor } from '@capacitor/core';

// Countdown duration in seconds before auto-sending
const AUTO_SEND_DELAY_SECONDS = 3;

type VoiceState = 'idle' | 'recording' | 'processing' | 'pending';

interface PendingCommand {
  transcript: string;
  originalTranscript: string;
  recordingDuration: number;
}

export function VoiceControlScreen() {
  const navigate = useNavigate();
  const { sessionId } = useParams<{ sessionId: string }>();
  const { allSessions, projects, sendIndexUpdate, isDesktopConnected, syncedOpenAIApiKey } = useSync();

  // Find the session
  const session = useMemo(() => {
    return allSessions.find((s) => s.id === sessionId) || null;
  }, [allSessions, sessionId]);

  // Find project name
  const projectName = useMemo(() => {
    if (!session) return null;
    const project = projects.find((p) => p.id === session.workspaceId);
    if (!project) return null;
    return project.name.includes('/') ? project.name.split('/').pop() : project.name;
  }, [session, projects]);

  // Voice capture state
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [pendingCommand, setPendingCommand] = useState<PendingCommand | null>(null);
  const [countdown, setCountdown] = useState<number>(AUTO_SEND_DELAY_SECONDS);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editedTranscript, setEditedTranscript] = useState('');
  const [permissionDenied, setPermissionDenied] = useState(false);

  // Refs for services and timers
  const voiceCaptureRef = useRef<VoiceCaptureService | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingStartTimeRef = useRef<number>(0);

  // OpenAI API key synced from desktop via encrypted settings sync
  const apiKey = syncedOpenAIApiKey;

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (voiceCaptureRef.current?.isRecording()) {
        voiceCaptureRef.current.stopCapture();
      }
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
      }
    };
  }, []);

  // Handle transcription complete
  const handleTranscriptComplete = useCallback((transcript: string) => {
    const duration = (Date.now() - recordingStartTimeRef.current) / 1000;

    setPendingCommand({
      transcript,
      originalTranscript: transcript,
      recordingDuration: duration,
    });
    setEditedTranscript(transcript);
    setVoiceState('pending');
    setCountdown(AUTO_SEND_DELAY_SECONDS);

    // Start countdown
    countdownIntervalRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          // Auto-send when countdown reaches 0
          if (countdownIntervalRef.current) {
            clearInterval(countdownIntervalRef.current);
            countdownIntervalRef.current = null;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    // Haptic feedback
    if (Capacitor.isNativePlatform()) {
      Haptics.impact({ style: ImpactStyle.Medium });
    }
  }, []);

  // Handle error
  const handleError = useCallback((err: Error) => {
    console.error('[VoiceControlScreen] Error:', err);
    setError(err.message);
    setVoiceState('idle');

    if (Capacitor.isNativePlatform()) {
      Haptics.notification({ type: NotificationType.Error });
    }
  }, []);

  // Start recording
  const startRecording = async () => {
    setError(null);

    if (!apiKey) {
      setError('OpenAI API key not synced from desktop. Please configure voice mode in desktop settings.');
      return;
    }

    // Initialize voice capture service if needed
    if (!voiceCaptureRef.current) {
      voiceCaptureRef.current = new VoiceCaptureService(apiKey, {
        onTranscriptComplete: handleTranscriptComplete,
        onError: handleError,
        onRecordingStateChange: (isRecording) => {
          if (!isRecording && voiceState === 'recording') {
            setVoiceState('processing');
          }
        },
      });
    }

    // Check permission first
    const permission = await voiceCaptureRef.current.checkPermission();
    if (permission === 'denied') {
      setPermissionDenied(true);
      setError('Microphone access denied. Please enable it in Settings.');
      return;
    }

    if (permission === 'prompt') {
      const granted = await voiceCaptureRef.current.requestPermission();
      if (!granted) {
        setPermissionDenied(true);
        setError('Microphone access is required for voice control.');
        return;
      }
    }

    try {
      recordingStartTimeRef.current = Date.now();
      await voiceCaptureRef.current.startCapture();
      setVoiceState('recording');

      if (Capacitor.isNativePlatform()) {
        Haptics.impact({ style: ImpactStyle.Light });
      }
    } catch (err) {
      handleError(err instanceof Error ? err : new Error(String(err)));
    }
  };

  // Stop recording
  const stopRecording = () => {
    if (voiceCaptureRef.current?.isRecording()) {
      voiceCaptureRef.current.stopCapture();
      setVoiceState('processing');
    }
  };

  // Send command to desktop
  const sendCommand = useCallback(async () => {
    if (!sessionId || !pendingCommand) return;

    // Stop countdown if running
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }

    const finalTranscript = isEditing ? editedTranscript : pendingCommand.transcript;

    if (!finalTranscript.trim()) {
      setError('Cannot send empty command');
      return;
    }

    try {
      // Create queued prompt with voice metadata
      const queuedPrompt = {
        id: crypto.randomUUID(),
        prompt: finalTranscript.trim(),
        timestamp: Date.now(),
        source: 'voice' as const,
        voiceMetadata: {
          duration: pendingCommand.recordingDuration,
          originalTranscript: pendingCommand.originalTranscript,
        },
      };

      // Send via sync infrastructure
      await sendIndexUpdate(sessionId, {
        queuedPrompts: [queuedPrompt],
      });

      // Success feedback
      if (Capacitor.isNativePlatform()) {
        Haptics.notification({ type: NotificationType.Success });
      }

      // Reset state
      setPendingCommand(null);
      setVoiceState('idle');
      setIsEditing(false);
      setEditedTranscript('');
    } catch (err) {
      handleError(err instanceof Error ? err : new Error('Failed to send command'));
    }
  }, [sessionId, pendingCommand, isEditing, editedTranscript, sendIndexUpdate, handleError]);

  // Auto-send when countdown reaches 0
  useEffect(() => {
    if (countdown === 0 && pendingCommand && !isEditing) {
      sendCommand();
    }
  }, [countdown, pendingCommand, isEditing, sendCommand]);

  // Cancel pending command
  const cancelCommand = () => {
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    setPendingCommand(null);
    setVoiceState('idle');
    setIsEditing(false);
    setEditedTranscript('');
  };

  // Start editing
  const startEditing = () => {
    // Pause countdown while editing
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    setIsEditing(true);
  };

  // Save edit and restart countdown
  const saveEdit = () => {
    if (pendingCommand) {
      setPendingCommand({
        ...pendingCommand,
        transcript: editedTranscript,
      });
    }
    setIsEditing(false);
    setCountdown(AUTO_SEND_DELAY_SECONDS);

    // Restart countdown
    countdownIntervalRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (countdownIntervalRef.current) {
            clearInterval(countdownIntervalRef.current);
            countdownIntervalRef.current = null;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  if (!session) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-[var(--surface-primary)]" style={{ height: '100dvh' }}>
        <p className="text-[var(--text-secondary)]">Session not found</p>
        <button onClick={() => navigate(-1)} className="mt-4 text-[var(--primary-color)]">
          Go back
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full bg-[var(--surface-primary)]" style={{ height: '100dvh' }}>
      {/* Header */}
      <header className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-[var(--border-primary)] bg-[var(--surface-secondary)] safe-area-top">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <button
            onClick={() => navigate(-1)}
            className="p-1.5 rounded-lg hover:bg-[var(--surface-tertiary)] text-[var(--primary-color)] flex-shrink-0"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="font-semibold text-[17px] text-[var(--text-primary)] truncate">
              {session.title || 'Untitled Session'}
            </h1>
            <p className="text-[12px] text-[var(--text-secondary)] truncate">{projectName}</p>
          </div>
        </div>

        {/* Session status */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {session.isExecuting ? (
            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-blue-500 text-white animate-pulse">
              Executing
            </span>
          ) : (
            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-green-500/20 text-green-600">Ready</span>
          )}
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        {/* Desktop connection warning */}
        {!isDesktopConnected && (
          <div className="w-full max-w-sm mb-6 p-3 rounded-lg bg-red-500/10 border border-red-500/30">
            <p className="text-sm text-red-500 text-center">Desktop not connected. Commands will queue until connected.</p>
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="w-full max-w-sm mb-6 p-3 rounded-lg bg-red-500/10 border border-red-500/30">
            <p className="text-sm text-red-500 text-center">{error}</p>
          </div>
        )}

        {/* Recording button - shown when idle or recording */}
        {(voiceState === 'idle' || voiceState === 'recording') && (
          <button
            onClick={voiceState === 'recording' ? stopRecording : startRecording}
            disabled={permissionDenied}
            className={`w-32 h-32 rounded-full flex items-center justify-center transition-all ${
              voiceState === 'recording'
                ? 'bg-red-500 scale-110 shadow-lg shadow-red-500/30'
                : 'bg-[var(--primary-color)] hover:scale-105'
            } ${permissionDenied ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="white"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" x2="12" y1="19" y2="22" />
            </svg>
          </button>
        )}

        {/* Recording state label */}
        {voiceState === 'recording' && (
          <p className="mt-6 text-lg font-medium text-[var(--text-primary)] animate-pulse">Recording...</p>
        )}

        {voiceState === 'idle' && !error && (
          <p className="mt-6 text-[var(--text-secondary)]">Tap to start recording</p>
        )}

        {/* Processing indicator */}
        {voiceState === 'processing' && (
          <div className="flex flex-col items-center">
            <div className="w-16 h-16 border-4 border-[var(--primary-color)] border-t-transparent rounded-full animate-spin" />
            <p className="mt-4 text-[var(--text-secondary)]">Processing...</p>
          </div>
        )}

        {/* Pending command validation */}
        {voiceState === 'pending' && pendingCommand && (
          <div className="w-full max-w-sm">
            <p className="text-sm text-[var(--text-secondary)] mb-2">Your command:</p>

            {isEditing ? (
              <textarea
                value={editedTranscript}
                onChange={(e) => setEditedTranscript(e.target.value)}
                className="w-full p-4 rounded-xl border border-[var(--border-primary)] bg-[var(--surface-secondary)] text-[var(--text-primary)] resize-none"
                rows={4}
                autoFocus
              />
            ) : (
              <div className="p-4 rounded-xl border border-[var(--border-primary)] bg-[var(--surface-secondary)]">
                <p className="text-[var(--text-primary)]">{pendingCommand.transcript}</p>
              </div>
            )}

            {/* Edit button */}
            <div className="flex justify-center mt-2">
              {isEditing ? (
                <button onClick={saveEdit} className="text-sm text-[var(--primary-color)] font-medium">
                  Done Editing
                </button>
              ) : (
                <button onClick={startEditing} className="text-sm text-[var(--primary-color)] font-medium">
                  Edit
                </button>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex gap-3 mt-6">
              <button
                onClick={cancelCommand}
                className="flex-1 py-3 rounded-xl border border-[var(--border-primary)] text-[var(--text-primary)] font-medium"
              >
                Cancel
              </button>
              <button
                onClick={sendCommand}
                className="flex-1 py-3 rounded-xl bg-[var(--primary-color)] text-white font-medium"
              >
                Send Now
              </button>
            </div>

            {/* Countdown */}
            {!isEditing && countdown > 0 && (
              <p className="mt-4 text-center text-sm text-[var(--text-secondary)]">Auto-sending in {countdown}s...</p>
            )}
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="flex-shrink-0 px-4 py-3 border-t border-[var(--border-primary)] bg-[var(--surface-secondary)] safe-area-bottom">
        <div className="flex items-center justify-center gap-2">
          <div className={`w-2 h-2 rounded-full ${isDesktopConnected ? 'bg-green-500' : 'bg-red-500'}`} />
          <span className="text-xs text-[var(--text-secondary)]">
            {isDesktopConnected ? 'Desktop connected' : 'Desktop offline'}
          </span>
        </div>
      </div>
    </div>
  );
}
