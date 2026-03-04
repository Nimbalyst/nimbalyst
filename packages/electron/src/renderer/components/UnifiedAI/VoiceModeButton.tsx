/**
 * Voice Mode Button
 *
 * Persistent voice mode toggle rendered in the NavigationGutter.
 * Reads the active AI session from Jotai atoms so it doesn't need
 * session-specific props. Only one voice session can be active at a time.
 */

import React, { useState, useEffect } from 'react';
import { useAtomValue } from 'jotai';
import { MaterialSymbol } from '@nimbalyst/runtime';
import { AudioCapture } from '../../utils/audioCapture';
import { AudioPlayback } from '../../utils/audioPlayback';
import { voiceModeEnabledAtom } from '../../store/atoms/appSettings';
import { activeSessionIdAtom } from '../../store/atoms/sessions';
import { voiceTokenUsageAtom, voiceListenStateAtom, voiceErrorAtom, registerVoiceAudioCallback, registerVoiceInterruptCallback, registerVoiceSubmitPromptCallback, registerVoiceAgentTaskCompleteCallback, registerVoiceStoppedCallback } from '../../store/atoms/voiceModeState';
import { setVoiceActiveSession, clearVoiceActiveSession, persistAndClearVoiceSession, onLinkedSessionChanged, wakeVoiceListening } from '../../store/listeners/voiceModeListeners';
import { HelpTooltip } from '../../help';
import { store } from '@nimbalyst/runtime/store';

// Global singleton state - only ONE voice session can be active at a time
let activeVoiceSessionId: string | null = null;

// Keep activeVoiceSessionId in sync when voice follows a session switch
onLinkedSessionChanged((newSessionId) => {
  activeVoiceSessionId = newSessionId;
});
let globalAudioCapture: AudioCapture | null = null;
let globalAudioPlayback: AudioPlayback | null = null;

// Map of sessionId -> setter for pending voice commands
// Each AIInput registers its setter with its sessionId
const pendingVoiceCommandSetters = new Map<string, (command: {
  id: string;
  prompt: string;
  sessionId: string;
  createdAt: number;
  delayMs: number;
  workspacePath: string;
  codingAgentPrompt?: { prepend?: string; append?: string };
} | null) => void>();

// Deduplication: track recently processed prompts to prevent duplicates
let lastProcessedPrompt: { prompt: string; timestamp: number } | null = null;
const DEDUP_WINDOW_MS = 1000; // Ignore duplicate prompts within 1 second

/**
 * Register a callback to set the pending voice command for a specific session.
 * This should be called by the AIInput component.
 */
export function registerPendingVoiceCommandSetter(
  sessionId: string,
  setter: (command: {
    id: string;
    prompt: string;
    sessionId: string;
    createdAt: number;
    delayMs: number;
    workspacePath: string;
    codingAgentPrompt?: { prepend?: string; append?: string };
  } | null) => void
) {
  pendingVoiceCommandSetters.set(sessionId, setter);
  return () => {
    // Only remove if it's still the same setter (prevents race conditions)
    if (pendingVoiceCommandSetters.get(sessionId) === setter) {
      pendingVoiceCommandSetters.delete(sessionId);
    }
  };
}

/**
 * Register callbacks with the centralized voice mode listeners.
 * These callbacks are invoked by voiceModeListeners.ts when IPC events arrive.
 * NO IPC listeners are registered here -- all IPC goes through the centralized listeners.
 */
function registerVoiceCallbacks() {
  // Audio playback
  registerVoiceAudioCallback((audioBase64) => {
    if (activeVoiceSessionId !== null && globalAudioPlayback) {
      globalAudioPlayback.play(audioBase64);
    }
  });

  // Interrupt (stop audio playback when user starts speaking)
  registerVoiceInterruptCallback(() => {
    if (activeVoiceSessionId !== null && globalAudioPlayback) {
      globalAudioPlayback.stop();
    }
  });

  // Submit prompt (handle pending command UI and queuing)
  registerVoiceSubmitPromptCallback(async (payload) => {
    try {
      if (activeVoiceSessionId === null) return;

      // Deduplication check
      const now = Date.now();
      if (lastProcessedPrompt &&
          lastProcessedPrompt.prompt === payload.prompt &&
          now - lastProcessedPrompt.timestamp < DEDUP_WINDOW_MS) {
        return;
      }
      lastProcessedPrompt = { prompt: payload.prompt, timestamp: now };

      // Get the submit delay setting
      const settings = await window.electronAPI.invoke('voice-mode:get-settings') as {
        submitDelayMs?: number;
      };
      const delayMs = settings.submitDelayMs ?? 3000;

      // Get the setter for this specific session
      const setter = pendingVoiceCommandSetters.get(payload.sessionId);

      if (delayMs === 0 || !setter) {
        await window.electronAPI.invoke(
          'ai:createQueuedPrompt',
          payload.sessionId,
          payload.prompt,
          undefined,
          {
            isVoiceMode: true,
            voiceModeCodingAgentPrompt: payload.codingAgentPrompt,
          }
        );
      } else {
        setter({
          id: crypto.randomUUID(),
          prompt: payload.prompt,
          sessionId: payload.sessionId,
          createdAt: Date.now(),
          delayMs,
          workspacePath: payload.workspacePath || '',
          codingAgentPrompt: payload.codingAgentPrompt,
        });
      }
    } catch (error) {
      console.error('[VoiceModeButton] Failed to queue prompt:', error);
    }
  });

  // Agent task complete (notify main process voice agent)
  registerVoiceAgentTaskCompleteCallback((data) => {
    if (activeVoiceSessionId === null) return;
    // Prefer lastTextSection (text after last tool call = agent's summary)
    // over content (full accumulated text which is often empty or huge)
    const summary = data.lastTextSection || data.content || 'Task completed';
    window.electronAPI.send('voice-mode:agent-task-complete', {
      sessionId: data.sessionId,
      summary,
    });
  });

  // Programmatic stop (clean up audio resources)
  registerVoiceStoppedCallback(() => {
    if (globalAudioCapture) {
      globalAudioCapture.stop();
      globalAudioCapture = null;
    }
    if (globalAudioPlayback) {
      globalAudioPlayback.destroy();
      globalAudioPlayback = null;
    }
    activeVoiceSessionId = null;
  });
}

// Register callbacks immediately on module load
registerVoiceCallbacks();

/**
 * Play a soft "bing" activation sound using the Web Audio API.
 * Two layered sine tones with a quick attack and gentle decay.
 */
function playActivationSound(): void {
  try {
    const ctx = new AudioContext();
    const now = ctx.currentTime;

    // Primary tone (E6 ~1319Hz) - bright and clear
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(1319, now);
    gain1.gain.setValueAtTime(0, now);
    gain1.gain.linearRampToValueAtTime(0.15, now + 0.01);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    osc1.connect(gain1).connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.4);

    // Harmonic overtone (octave up ~2637Hz) - adds shimmer
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(2637, now);
    gain2.gain.setValueAtTime(0, now);
    gain2.gain.linearRampToValueAtTime(0.06, now + 0.01);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    osc2.connect(gain2).connect(ctx.destination);
    osc2.start(now);
    osc2.stop(now + 0.25);

    // Clean up context after sounds finish
    setTimeout(() => ctx.close(), 500);
  } catch {
    // Audio playback is best-effort
  }
}

interface VoiceModeButtonProps {
  workspacePath?: string | null;
}

export function VoiceModeButton({ workspacePath }: VoiceModeButtonProps) {
  const voiceModeEnabled = useAtomValue(voiceModeEnabledAtom);
  const activeSessionId = useAtomValue(activeSessionIdAtom);
  const listenState = useAtomValue(voiceListenStateAtom);

  const [isVoiceActive, setIsVoiceActive] = useState(activeVoiceSessionId !== null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<{ type: string; message: string } | null>(null);
  const isSleeping = listenState === 'sleeping';

  // Read error from centralized atom (set by voiceModeListeners.ts)
  const voiceError = useAtomValue(voiceErrorAtom);

  // Sync error atom -> local error state and handle auto-disconnect
  useEffect(() => {
    if (voiceError && isVoiceActive) {
      setError(voiceError);
      // Auto-disconnect on error
      if (globalAudioCapture) {
        globalAudioCapture.stop();
        globalAudioCapture = null;
      }
      if (globalAudioPlayback) {
        globalAudioPlayback.destroy();
        globalAudioPlayback = null;
      }
      window.electronAPI.invoke('voice-mode:test-disconnect', workspacePath || null, activeVoiceSessionId || '');
      activeVoiceSessionId = null;
      clearVoiceActiveSession();
      setIsVoiceActive(false);
    }
  }, [voiceError]);

  // Sync listenState -> local isVoiceActive when voice is programmatically stopped
  useEffect(() => {
    if (listenState === 'off' && isVoiceActive) {
      setIsVoiceActive(false);
    }
  }, [listenState]);

  const handleToggleVoice = async () => {
    setError(null);

    // If sleeping, wake up instead of stopping
    if (isVoiceActive && listenState === 'sleeping') {
      wakeVoiceListening();
      return;
    }

    if (isVoiceActive) {
      // Stop voice mode
      const sessionId = activeVoiceSessionId;
      try {
        if (globalAudioCapture) {
          globalAudioCapture.stop();
          globalAudioCapture = null;
        }
        if (globalAudioPlayback) {
          globalAudioPlayback.destroy();
          globalAudioPlayback = null;
        }

        const result = await window.electronAPI.invoke('voice-mode:test-disconnect', workspacePath || null, sessionId || '') as {
          success: boolean;
          tokenUsage?: { inputAudio: number; outputAudio: number; text: number; total: number };
        };

        if (sessionId) {
          await persistAndClearVoiceSession(sessionId, result.tokenUsage);
        }

        activeVoiceSessionId = null;
        setIsVoiceActive(false);
      } catch (err) {
        console.error('[VoiceModeButton] Failed to stop voice mode:', err);
      }
    } else {
      // Start voice mode for the active session
      const sessionId = activeSessionId;
      if (!sessionId) return;

      setIsConnecting(true);
      try {
        // If another session is active, stop it first
        if (activeVoiceSessionId !== null && activeVoiceSessionId !== sessionId) {
          const previousSessionId = activeVoiceSessionId;
          if (globalAudioCapture) {
            globalAudioCapture.stop();
            globalAudioCapture = null;
          }
          if (globalAudioPlayback) {
            globalAudioPlayback.destroy();
            globalAudioPlayback = null;
          }
          await window.electronAPI.invoke('voice-mode:test-disconnect', workspacePath || null, previousSessionId);
          activeVoiceSessionId = null;
          clearVoiceActiveSession();
        }

        const result = await window.electronAPI.invoke('voice-mode:test-connection', workspacePath || null, sessionId);
        if (!result.success) {
          setError({ type: 'connection_failed', message: result.message || 'Failed to connect to voice service' });
          setIsConnecting(false);
          return;
        }

        globalAudioPlayback = new AudioPlayback();
        globalAudioCapture = new AudioCapture();
        await globalAudioCapture.start((pcm16Base64) => {
          // Use activeVoiceSessionId (module-level, updated on session switch)
          // instead of the closure sessionId which would go stale.
          // Gate on listen state: don't send audio when sleeping.
          if (activeVoiceSessionId && store.get(voiceListenStateAtom) === 'listening') {
            window.electronAPI.invoke('voice-mode:send-audio', workspacePath || null, activeVoiceSessionId, pcm16Base64);
          }
        });

        activeVoiceSessionId = sessionId;
        setVoiceActiveSession(sessionId, workspacePath);
        playActivationSound();
        setIsVoiceActive(true);
      } catch (err) {
        console.error('[VoiceModeButton] Failed to start voice mode:', err);
        setError({ type: 'connection_failed', message: err instanceof Error ? err.message : 'Failed to start voice mode' });
        if (globalAudioCapture) {
          globalAudioCapture.stop();
          globalAudioCapture = null;
        }
        if (globalAudioPlayback) {
          globalAudioPlayback.destroy();
          globalAudioPlayback = null;
        }
        activeVoiceSessionId = null;
        clearVoiceActiveSession();
      } finally {
        setIsConnecting(false);
      }
    }
  };

  // Context usage ring (wraps button when voice is active -- both listening and sleeping)
  const tokenUsage = useAtomValue(voiceTokenUsageAtom);

  if (!voiceModeEnabled) {
    return null;
  }

  const getButtonIcon = () => {
    if (isConnecting) return 'sync';
    if (isVoiceActive && isSleeping) return 'mic';
    if (isVoiceActive) return 'mic';
    return 'mic_off';
  };

  const getButtonTitle = () => {
    if (isConnecting) return 'Connecting...';
    if (error) return `Error: ${getErrorMessage(error)}`;
    if (isVoiceActive && isSleeping) return 'Voice Mode (sleeping) - Click to wake';
    if (isVoiceActive) return 'Stop Voice Mode';
    if (!activeSessionId) return 'Voice Mode (no active session)';
    return 'Start Voice Mode';
  };

  // Disabled when no session is selected and voice isn't already active
  const isDisabled = isConnecting || (!isVoiceActive && !activeSessionId);

  const CONTEXT_WINDOW_TOKENS = 28000;
  const RING_RADIUS = 16;
  const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
  const showRing = isVoiceActive && tokenUsage;
  const contextPercentage = tokenUsage
    ? Math.min(100, (tokenUsage.total / CONTEXT_WINDOW_TOKENS) * 100)
    : 0;
  const ringStrokeDashoffset = RING_CIRCUMFERENCE * (1 - contextPercentage / 100);

  const getRingStrokeColor = () => {
    if (contextPercentage > 80) return '#ef4444'; // red
    if (contextPercentage > 60) return '#eab308'; // yellow
    return '#22c55e'; // green
  };

  const contextExtraContent = (isVoiceActive && tokenUsage) ? (
    <div className="flex items-center gap-2 text-xs">
      <div
        className="w-2 h-2 rounded-full shrink-0"
        style={{ backgroundColor: getRingStrokeColor() }}
      />
      <span className="text-[var(--nim-text-muted)]">
        Context: {Math.round(contextPercentage)}%
      </span>
      <span className="text-[var(--nim-text-faint)] ml-auto">
        {tokenUsage.total.toLocaleString()} / {CONTEXT_WINDOW_TOKENS.toLocaleString()}
      </span>
    </div>
  ) : undefined;

  return (
    <HelpTooltip testId="voice-mode-toggle" placement="right" extraContent={contextExtraContent}>
      <div className="relative">
        <button
          onClick={handleToggleVoice}
          disabled={isDisabled}
          data-testid="voice-mode-toggle"
          className={`nav-button relative w-9 h-9 flex items-center justify-center border-none rounded-md cursor-pointer transition-all duration-150 p-0 active:scale-95 focus-visible:outline-2 focus-visible:outline-[var(--nim-primary)] focus-visible:outline-offset-2 ${
            isVoiceActive && isSleeping
              ? 'bg-[#92400e] text-[#fbbf24] hover:bg-[#78350f]'
              : isVoiceActive
                ? 'active bg-nim-primary text-white hover:bg-nim-primary-hover'
                : error
                  ? 'bg-[var(--error-color,#dc3545)] text-white'
                  : isDisabled
                    ? 'bg-transparent text-nim-disabled cursor-not-allowed'
                    : 'bg-transparent text-nim-muted hover:bg-nim-tertiary hover:text-nim'
          }`}
          aria-label={getButtonTitle()}
        >
          <MaterialSymbol
            icon={getButtonIcon()}
            size={20}
            fill={isVoiceActive && !isSleeping}
            className={isConnecting ? 'animate-spin' : ''}
          />
          {/* Context usage ring overlay */}
          {showRing && (
            <svg
              width="36"
              height="36"
              viewBox="0 0 36 36"
              className="absolute inset-0 pointer-events-none transform -rotate-90"
            >
              {/* Background ring */}
              <circle
                cx="18"
                cy="18"
                r={RING_RADIUS}
                fill="none"
                stroke="var(--nim-bg-tertiary)"
                strokeWidth="2.5"
                opacity="0.5"
              />
              {/* Progress ring */}
              <circle
                cx="18"
                cy="18"
                r={RING_RADIUS}
                fill="none"
                stroke={getRingStrokeColor()}
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeDasharray={RING_CIRCUMFERENCE}
                strokeDashoffset={ringStrokeDashoffset}
                style={{ transition: 'stroke-dashoffset 0.3s ease, stroke 0.3s ease' }}
              />
            </svg>
          )}
        </button>
        {error && (
          <div
            className="absolute left-[calc(100%+8px)] top-1/2 -translate-y-1/2 bg-nim border border-[var(--error-color,#dc3545)] rounded-lg p-3 min-w-[200px] max-w-[300px] shadow-[0_4px_12px_rgba(0,0,0,0.15)] z-[1000]"
          >
            <div className="flex items-start gap-2 text-nim">
              <MaterialSymbol icon="error" size={18} className="text-[var(--error-color,#dc3545)] shrink-0" />
              <div className="text-[13px] leading-[1.4]">
                <div className="font-semibold mb-1">Voice Mode Error</div>
                <div className="text-nim-muted">{getErrorMessage(error)}</div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); setError(null); }}
                className="bg-transparent border-none cursor-pointer p-0 ml-auto text-nim-faint"
              >
                <MaterialSymbol icon="close" size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
    </HelpTooltip>
  );
}

/**
 * Get a user-friendly error message based on error type
 */
function getErrorMessage(error: { type: string; message: string }): string {
  switch (error.type) {
    case 'insufficient_quota':
      return 'OpenAI API quota exceeded. Please check your billing at platform.openai.com.';
    case 'rate_limit_exceeded':
      return 'Too many requests. Please wait a moment and try again.';
    case 'invalid_api_key':
      return 'Invalid OpenAI API key. Please check your settings.';
    case 'connection_failed':
      return error.message || 'Failed to connect to voice service.';
    default:
      return error.message || 'An unexpected error occurred.';
  }
}
