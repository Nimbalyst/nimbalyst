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
import { voiceTokenUsageAtom, voiceListenStateAtom } from '../../store/atoms/voiceModeState';
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

// Register global IPC listeners ONCE (not per button click!)
// Use a window property to survive HMR reloads and prevent duplicate listeners
const VOICE_LISTENERS_KEY = '__voiceModeListenersCleanup';

// Clean up any existing listeners from previous HMR loads
// This runs on module load, before any components mount
if ((window as any)[VOICE_LISTENERS_KEY]) {
  const oldCleanups = (window as any)[VOICE_LISTENERS_KEY] as (() => void)[];
  oldCleanups.forEach(cleanup => cleanup?.());
  delete (window as any)[VOICE_LISTENERS_KEY];
}

// Callback for error notifications - set by component
let globalErrorCallback: ((error: { type: string; message: string }) => void) | null = null;
// Callback for programmatic stop notifications - set by component
let globalStoppedCallback: (() => void) | null = null;
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

function ensureGlobalListenersRegistered() {
  // Check if listeners are already registered (survives HMR)
  if ((window as any)[VOICE_LISTENERS_KEY]) {
    return;
  }

  // Mark as registered immediately to prevent race conditions
  const cleanupFunctions: (() => void)[] = [];
  (window as any)[VOICE_LISTENERS_KEY] = cleanupFunctions;

  // These listeners are GLOBAL and permanent - voice is a singleton so we just
  // check that any voice session is active rather than comparing session IDs
  cleanupFunctions.push(
    window.electronAPI.on('voice-mode:audio-received', (payload: { sessionId: string; audioBase64: string }) => {
      if (activeVoiceSessionId !== null && globalAudioPlayback) {
        globalAudioPlayback.play(payload.audioBase64);
      }
    })
  );

  // voice-mode:text-received is handled by centralized voiceModeListeners.ts

  cleanupFunctions.push(
    window.electronAPI.on('voice-mode:submit-prompt', async (payload: {
      sessionId: string;
      workspacePath: string | null;
      prompt: string;
      codingAgentPrompt?: { prepend?: string; append?: string };
    }) => {
      console.log('[VoiceModeButton] Received submit-prompt event', {
        payloadSessionId: payload.sessionId,
        activeVoiceSessionId,
        prompt: payload.prompt.substring(0, 50),
      });

      try {
        // Only process if voice is active
        if (activeVoiceSessionId === null) {
          console.log('[VoiceModeButton] Ignoring - no active voice session');
          return;
        }

        // Deduplication check: ignore if we just processed the same prompt
        const now = Date.now();
        if (lastProcessedPrompt &&
            lastProcessedPrompt.prompt === payload.prompt &&
            now - lastProcessedPrompt.timestamp < DEDUP_WINDOW_MS) {
          console.log('[VoiceModeButton] Ignoring duplicate submit-prompt event');
          return;
        }
        lastProcessedPrompt = { prompt: payload.prompt, timestamp: now };
        console.log('[VoiceModeButton] Processing submit-prompt, delayMs check next');

        // Get the submit delay setting
        const settings = await window.electronAPI.invoke('voice-mode:get-settings') as {
          submitDelayMs?: number;
        };
        const delayMs = settings.submitDelayMs ?? 3000;

        // Get the setter for this specific session
        const setter = pendingVoiceCommandSetters.get(payload.sessionId);

        if (delayMs === 0 || !setter) {
          // Immediate submission (no delay configured or no setter registered for this session)
          // Queue the prompt using the existing queue system
          // This ensures prompts are processed sequentially, not concurrently
          // Pass isVoiceMode in documentContext so the system prompt includes voice mode instructions
          // Also pass custom coding agent prompt settings if configured
          await window.electronAPI.invoke(
            'ai:createQueuedPrompt',
            payload.sessionId,
            payload.prompt,
            undefined, // attachments
            {
              isVoiceMode: true,
              voiceModeCodingAgentPrompt: payload.codingAgentPrompt,
            }
          );
        } else {
          // Set pending command for countdown UI - only for the matching session
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
    })
  );

  // Listen for agent task completion (ai:streamResponse with isComplete=true)
  // and notify the main process so it can tell the voice assistant.
  // Use the actual data.sessionId from the event (not activeVoiceSessionId)
  // so the main process can match it even after a session switch.
  cleanupFunctions.push(
    window.electronAPI.onAIStreamResponse((data: any) => {
      if (data.isComplete && activeVoiceSessionId !== null) {
        // Extract summary from the agent's final response
        const summary = data.content || 'Task completed';

        console.log('[VoiceModeButton] Agent task complete, sending to main:', {
          sessionId: data.sessionId,
          contentLength: data.content?.length,
          contentPreview: data.content?.substring(0, 500),
        });

        // Notify main process that the agent finished, including the summary
        window.electronAPI.send('voice-mode:agent-task-complete', {
          sessionId: data.sessionId,
          summary: summary
        });
      }
    })
  );

  // Listen for interruption events (user started speaking while assistant was talking)
  cleanupFunctions.push(
    window.electronAPI.on('voice-mode:interrupt', (payload: { sessionId: string }) => {
      if (activeVoiceSessionId !== null && globalAudioPlayback) {
        globalAudioPlayback.stop();
      }
    })
  );

  // Listen for error events (quota exceeded, rate limits, etc.)
  cleanupFunctions.push(
    window.electronAPI.on('voice-mode:error', (payload: { sessionId: string; error: { type: string; message: string } }) => {
      if (activeVoiceSessionId !== null && globalErrorCallback) {
        globalErrorCallback(payload.error);
      }
    })
  );

  // Listen for programmatic stop events (e.g., AI assistant stopped the session)
  cleanupFunctions.push(
    window.electronAPI.on('voice-mode:stopped', async (payload: {
      sessionId: string;
      tokenUsage?: { inputAudio: number; outputAudio: number; text: number; total: number };
    }) => {
      if (activeVoiceSessionId !== null) {
        // Clean up audio resources
        if (globalAudioCapture) {
          globalAudioCapture.stop();
          globalAudioCapture = null;
        }
        if (globalAudioPlayback) {
          globalAudioPlayback.destroy();
          globalAudioPlayback = null;
        }

        // Transcript and token usage persistence handled by voiceModeListeners.ts

        activeVoiceSessionId = null;
        // Trigger UI update via the stopped callback if registered
        if (globalStoppedCallback) {
          globalStoppedCallback();
        }
      }
    })
  );
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

  // Ensure global IPC listeners are registered once
  useEffect(() => {
    ensureGlobalListenersRegistered();
  }, []);

  // Set up error and stopped callbacks
  useEffect(() => {
    if (isVoiceActive && activeVoiceSessionId !== null) {
      globalErrorCallback = (err) => {
        setError(err);
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
      };

      globalStoppedCallback = () => {
        setIsVoiceActive(false);
      };
    }
    return () => {
      globalErrorCallback = null;
      globalStoppedCallback = null;
    };
  }, [isVoiceActive, workspacePath]);

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
    <HelpTooltip testId="voice-mode-toggle" extraContent={contextExtraContent}>
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
