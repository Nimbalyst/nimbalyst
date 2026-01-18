/**
 * Voice Control Screen
 *
 * A compact voice overlay on top of the SessionDetailScreen.
 * Shows a header bar with voice controls while the AI transcript remains visible.
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useCollabV3Sync as useSync } from '../contexts/CollabV3SyncContext';
import {
  InteractiveVoiceService,
  VoiceServiceState,
  TranscriptEntry,
  PendingPrompt,
} from '../services/InteractiveVoiceService';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Capacitor } from '@capacitor/core';
import { SessionDetailScreen } from './SessionDetailScreen';

// Countdown duration in seconds before auto-sending a pending prompt
const AUTO_SEND_DELAY_SECONDS = 5;

export function VoiceControlScreen() {
  const navigate = useNavigate();
  const { sessionId } = useParams<{ sessionId: string }>();
  const { allSessions, projects, sendIndexUpdate, isDesktopConnected, syncedOpenAIApiKey } = useSync();

  // Find the session
  const session = useMemo(() => {
    return allSessions.find((s) => s.id === sessionId) || null;
  }, [allSessions, sessionId]);

  // Voice service state
  const [voiceState, setVoiceState] = useState<VoiceServiceState>('idle');
  const [transcriptEntries, setTranscriptEntries] = useState<TranscriptEntry[]>([]);
  const [pendingPrompt, setPendingPrompt] = useState<PendingPrompt | null>(null);
  const [countdown, setCountdown] = useState<number>(AUTO_SEND_DELAY_SECONDS);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editedPrompt, setEditedPrompt] = useState('');
  const [permissionDenied, setPermissionDenied] = useState(false);

  // Refs
  const voiceServiceRef = useRef<InteractiveVoiceService | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // OpenAI API key synced from desktop
  const apiKey = syncedOpenAIApiKey;

  // Track if we've attempted auto-start
  const hasAutoStartedRef = useRef(false);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      voiceServiceRef.current?.stop('user_stopped');
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
      }
    };
  }, []);

  // Handle pending prompt from voice agent
  const handlePendingPrompt = useCallback((prompt: PendingPrompt) => {
    setPendingPrompt(prompt);
    setEditedPrompt(prompt.prompt);
    setCountdown(AUTO_SEND_DELAY_SECONDS);

    // Start countdown
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

    if (Capacitor.isNativePlatform()) {
      Haptics.notification({ type: NotificationType.Warning });
    }
  }, []);

  // Send pending prompt to desktop
  const sendPendingPrompt = useCallback(async () => {
    if (!sessionId || !pendingPrompt) return;

    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }

    const finalPrompt = isEditing ? editedPrompt : pendingPrompt.prompt;

    if (!finalPrompt.trim()) {
      setError('Cannot send empty command');
      return;
    }

    try {
      const queuedPrompt = {
        id: crypto.randomUUID(),
        prompt: finalPrompt.trim(),
        timestamp: Date.now(),
        source: 'voice' as const,
      };

      await sendIndexUpdate(sessionId, {
        queuedPrompts: [queuedPrompt],
      });

      if (Capacitor.isNativePlatform()) {
        Haptics.notification({ type: NotificationType.Success });
      }

      // Reset pending state
      setPendingPrompt(null);
      setIsEditing(false);
      setEditedPrompt('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send command');
    }
  }, [sessionId, pendingPrompt, isEditing, editedPrompt, sendIndexUpdate]);

  // Auto-send when countdown reaches 0
  useEffect(() => {
    if (countdown === 0 && pendingPrompt && !isEditing) {
      sendPendingPrompt();
    }
  }, [countdown, pendingPrompt, isEditing, sendPendingPrompt]);

  // Cancel pending prompt
  const cancelPendingPrompt = useCallback(() => {
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    setPendingPrompt(null);
    setIsEditing(false);
    setEditedPrompt('');

    if (Capacitor.isNativePlatform()) {
      Haptics.impact({ style: ImpactStyle.Light });
    }
  }, []);

  // Start voice session
  const startVoiceSession = useCallback(async () => {
    setError(null);

    if (!apiKey) {
      setError('OpenAI API key not synced from desktop');
      return;
    }

    // Check permission first
    let permission = await voiceServiceRef.current?.checkPermission();
    if (!voiceServiceRef.current) {
      const tempService = new InteractiveVoiceService(apiKey, {
        onTranscriptUpdate: () => {},
        onPendingPrompt: () => {},
        onStateChange: () => {},
        onError: () => {},
        onSessionEnd: () => {},
      });
      permission = await tempService.checkPermission();
    }

    if (permission === 'denied') {
      setPermissionDenied(true);
      setError('Microphone access denied');
      return;
    }

    if (permission === 'prompt') {
      const tempService = new InteractiveVoiceService(apiKey, {
        onTranscriptUpdate: () => {},
        onPendingPrompt: () => {},
        onStateChange: () => {},
        onError: () => {},
        onSessionEnd: () => {},
      });
      const granted = await tempService.requestPermission();
      if (!granted) {
        setPermissionDenied(true);
        setError('Microphone access required');
        return;
      }
    }

    // Build session context from the current session
    let sessionContext = 'Mobile voice session';
    if (session) {
      const project = projects.find((p) => p.id === session.workspaceId);
      sessionContext = `Session "${session.title || 'Unnamed'}" in project "${project?.name || 'Unknown'}"`;
      if (session.messageCount > 0) {
        sessionContext += `. Session has ${session.messageCount} messages.`;
      }
    }

    // Create voice service
    voiceServiceRef.current = new InteractiveVoiceService(
      apiKey,
      {
        onTranscriptUpdate: setTranscriptEntries,
        onPendingPrompt: handlePendingPrompt,
        onStateChange: setVoiceState,
        onError: (err) => {
          setError(err.message);
          if (Capacitor.isNativePlatform()) {
            Haptics.notification({ type: NotificationType.Error });
          }
        },
        onSessionEnd: (reason) => {
          console.log('[VoiceControlScreen] Session ended:', reason);
          if (reason === 'timeout') {
            setError('Session timed out due to inactivity');
          }
        },
      },
      { sessionContext }
    );

    try {
      await voiceServiceRef.current.start();
      if (Capacitor.isNativePlatform()) {
        Haptics.impact({ style: ImpactStyle.Medium });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start voice session');
    }
  }, [apiKey, session, projects, handlePendingPrompt]);

  // Stop voice session
  const stopVoiceSession = useCallback(() => {
    voiceServiceRef.current?.stop('user_stopped');
    if (Capacitor.isNativePlatform()) {
      Haptics.impact({ style: ImpactStyle.Light });
    }
  }, []);

  // Auto-start voice session when screen loads (if we have an API key)
  useEffect(() => {
    if (hasAutoStartedRef.current) return;
    if (!apiKey) return;
    if (!session) return;

    hasAutoStartedRef.current = true;
    // Small delay to ensure the screen has rendered
    const timer = setTimeout(() => {
      startVoiceSession();
    }, 100);

    return () => clearTimeout(timer);
  }, [apiKey, session, startVoiceSession]);

  // Exit voice mode
  const exitVoiceMode = useCallback(() => {
    voiceServiceRef.current?.stop('user_stopped');
    navigate(`/session/${sessionId}`);
  }, [navigate, sessionId]);

  if (!session) {
    return (
      <div
        className="flex flex-col items-center justify-center h-full bg-[var(--surface-primary)]"
        style={{ height: '100dvh' }}
      >
        <p className="text-[var(--text-secondary)]">Session not found</p>
        <button onClick={() => navigate(-1)} className="mt-4 text-[var(--primary-color)]">
          Go back
        </button>
      </div>
    );
  }

  // Get status text and color based on voice state
  const getStatusInfo = () => {
    switch (voiceState) {
      case 'idle':
        return { text: 'Tap mic to start', color: 'text-[var(--text-secondary)]', showPulse: false };
      case 'connecting':
        return { text: 'Connecting...', color: 'text-yellow-500', showPulse: false };
      case 'connected':
        return { text: 'Connected', color: 'text-green-500', showPulse: false };
      case 'listening':
        return { text: 'Listening...', color: 'text-green-500', showPulse: true };
      case 'agent_speaking':
        return { text: 'Speaking...', color: 'text-blue-500', showPulse: true };
      case 'processing':
        return { text: 'Processing...', color: 'text-blue-500', showPulse: false };
      case 'error':
        return { text: error || 'Error', color: 'text-red-500', showPulse: false };
      default:
        return { text: '', color: '', showPulse: false };
    }
  };

  const statusInfo = getStatusInfo();
  const isSessionActive = voiceState !== 'idle' && voiceState !== 'error';

  // Get latest voice transcript entry for display
  const latestVoiceEntry = transcriptEntries[transcriptEntries.length - 1];

  return (
    <div className="flex flex-col w-full bg-[var(--surface-primary)]" style={{ height: '100dvh' }}>
      {/* Voice Control Header Bar */}
      <div className="flex-shrink-0 bg-[var(--surface-secondary)] border-b border-[var(--border-primary)] safe-area-top z-10">
        <div className="flex items-center justify-between px-3 py-2">
          {/* Close button */}
          <button
            onClick={exitVoiceMode}
            className="p-1.5 rounded-lg hover:bg-[var(--surface-tertiary)] text-[var(--text-secondary)]"
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
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>

          {/* Status indicator */}
          <div className="flex items-center gap-2 flex-1 justify-center">
            {statusInfo.showPulse && <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />}
            {voiceState === 'connecting' && (
              <svg className="animate-spin h-4 w-4 text-yellow-500" viewBox="0 0 24 24">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                  fill="none"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
            )}
            <span className={`text-sm font-medium ${statusInfo.color}`}>{statusInfo.text}</span>
          </div>

          {/* Voice control button */}
          <button
            onClick={isSessionActive ? stopVoiceSession : startVoiceSession}
            disabled={permissionDenied || voiceState === 'connecting'}
            className={`p-2 rounded-full transition-all ${
              voiceState === 'connecting'
                ? 'bg-[var(--surface-tertiary)] text-[var(--text-tertiary)]'
                : isSessionActive
                  ? 'bg-red-500 text-white scale-110'
                  : 'bg-[var(--primary-color)] text-white hover:scale-105'
            } ${permissionDenied ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {isSessionActive ? (
              // Stop icon
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            ) : (
              // Mic icon
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="currentColor"
                stroke="currentColor"
                strokeWidth="1"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" x2="12" y1="19" y2="22" />
              </svg>
            )}
          </button>
        </div>

        {/* Live voice transcript - shows what user/agent is saying */}
        {latestVoiceEntry && isSessionActive && (
          <div className="px-3 pb-2">
            <div className={`px-3 py-1.5 rounded-lg text-sm ${
              latestVoiceEntry.role === 'user'
                ? 'bg-[var(--primary-color)]/10 text-[var(--primary-color)]'
                : 'bg-[var(--surface-tertiary)] text-[var(--text-primary)]'
            } ${latestVoiceEntry.isStreaming ? 'animate-pulse' : ''}`}>
              <span className="text-xs font-medium opacity-70 mr-2">
                {latestVoiceEntry.role === 'user' ? 'You:' : 'Agent:'}
              </span>
              {latestVoiceEntry.text || '...'}
            </div>
          </div>
        )}

        {/* Pending prompt preview */}
        {pendingPrompt && (
          <div className="px-3 pb-2">
            <div className="p-2 rounded-lg bg-[var(--surface-tertiary)] border border-[var(--primary-color)]/50">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs text-[var(--primary-color)] font-medium">Pending Task</span>
                {!isEditing && (
                  <span className="text-xs text-[var(--text-tertiary)]">Auto-send in {countdown}s</span>
                )}
              </div>
              {isEditing ? (
                <textarea
                  value={editedPrompt}
                  onChange={(e) => setEditedPrompt(e.target.value)}
                  className="w-full p-2 rounded border border-[var(--border-primary)] bg-[var(--surface-primary)] text-[var(--text-primary)] text-sm resize-none"
                  rows={3}
                  autoFocus
                />
              ) : (
                <p className="text-sm text-[var(--text-primary)] line-clamp-2">{pendingPrompt.prompt}</p>
              )}
              <div className="flex items-center justify-between mt-2">
                <div className="flex gap-2">
                  {isEditing ? (
                    <button
                      onClick={() => {
                        setIsEditing(false);
                        setCountdown(AUTO_SEND_DELAY_SECONDS);
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
                      }}
                      className="text-xs text-[var(--primary-color)] font-medium"
                    >
                      Done
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        if (countdownIntervalRef.current) {
                          clearInterval(countdownIntervalRef.current);
                          countdownIntervalRef.current = null;
                        }
                        setIsEditing(true);
                      }}
                      className="text-xs text-[var(--primary-color)] font-medium"
                    >
                      Edit
                    </button>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={cancelPendingPrompt}
                    className="px-2 py-1 text-xs rounded bg-[var(--surface-primary)] text-[var(--text-secondary)] border border-[var(--border-primary)]"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={sendPendingPrompt}
                    className="px-2 py-1 text-xs rounded bg-[var(--primary-color)] text-white font-medium"
                  >
                    Send
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Desktop connection warning */}
        {!isDesktopConnected && isSessionActive && (
          <div className="px-3 pb-2">
            <div className="px-2 py-1 rounded bg-yellow-500/10 border border-yellow-500/30">
              <p className="text-xs text-yellow-600 text-center">Desktop offline - commands will queue</p>
            </div>
          </div>
        )}

        {/* Error display */}
        {error && voiceState === 'error' && (
          <div className="px-3 pb-2">
            <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/30">
              <p className="text-xs text-red-500 text-center">{error}</p>
              <button
                onClick={() => {
                  setError(null);
                  setVoiceState('idle');
                }}
                className="mt-1 w-full py-1 text-xs text-red-500 font-medium"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Session Detail Screen - Takes up the rest of the space */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <SessionDetailScreen hiddenBackButton={true} voiceModeActive={true} />
      </div>
    </div>
  );
}
