/**
 * Voice Mode Button
 *
 * Displays a microphone button when voice mode is enabled in settings.
 * Clicking it starts/stops voice mode.
 */

import React, { useState, useEffect, useRef } from 'react';
import { useAtomValue } from 'jotai';
import { MaterialSymbol } from '@nimbalyst/runtime';
import { AudioCapture } from '../../utils/audioCapture';
import { AudioPlayback } from '../../utils/audioPlayback';
import { voiceModeEnabledAtom } from '../../store/atoms/appSettings';

// Global singleton state - only ONE voice session can be active at a time
let activeVoiceSessionId: string | null = null;
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

  // These listeners are GLOBAL and permanent - they filter by sessionId
  cleanupFunctions.push(
    window.electronAPI.on('voice-mode:audio-received', (payload: { sessionId: string; audioBase64: string }) => {
      // Only play audio if the event is for the active session
      if (payload.sessionId === activeVoiceSessionId && globalAudioPlayback) {
        globalAudioPlayback.play(payload.audioBase64);
      }
    })
  );

  cleanupFunctions.push(
    window.electronAPI.on('voice-mode:text-received', (payload: { sessionId: string; text: string }) => {
      // Text transcription received (not currently displayed)
    })
  );

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
        // Only process if this window has the active voice session
        if (payload.sessionId !== activeVoiceSessionId) {
          console.log('[VoiceModeButton] Ignoring - not active voice session');
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
  // and notify the main process so it can tell the voice assistant
  cleanupFunctions.push(
    window.electronAPI.onAIStreamResponse((data: any) => {
      if (data.isComplete && data.sessionId === activeVoiceSessionId) {
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
      if (payload.sessionId === activeVoiceSessionId && globalAudioPlayback) {
        globalAudioPlayback.stop();
      }
    })
  );

  // Listen for error events (quota exceeded, rate limits, etc.)
  cleanupFunctions.push(
    window.electronAPI.on('voice-mode:error', (payload: { sessionId: string; error: { type: string; message: string } }) => {
      if (payload.sessionId === activeVoiceSessionId && globalErrorCallback) {
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
      if (payload.sessionId === activeVoiceSessionId) {
        // Clean up audio resources
        if (globalAudioCapture) {
          globalAudioCapture.stop();
          globalAudioCapture = null;
        }
        if (globalAudioPlayback) {
          globalAudioPlayback.destroy();
          globalAudioPlayback = null;
        }

        // Persist voice token usage to session metadata
        if (payload.tokenUsage && payload.tokenUsage.total > 0) {
          try {
            await window.electronAPI.invoke('ai:updateSessionMetadata', payload.sessionId, {
              voiceTokenUsage: payload.tokenUsage,
            });
            console.log('[VoiceModeButton] Persisted voice token usage:', payload.tokenUsage);
          } catch (error) {
            console.error('[VoiceModeButton] Failed to persist voice token usage:', error);
          }
        }

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
  sessionId?: string; // The AI session this button controls
  workspacePath?: string; // The workspace path for this session
  onVoiceActiveChange?: (isActive: boolean) => void; // Callback when voice mode activates/deactivates
}

export function VoiceModeButton({ sessionId, workspacePath, onVoiceActiveChange }: VoiceModeButtonProps) {
  // Subscribe to voice mode settings from Jotai atoms
  // These update automatically when settings change in SettingsView
  const voiceModeEnabled = useAtomValue(voiceModeEnabledAtom);

  const [isVoiceActive, setIsVoiceActive] = useState(activeVoiceSessionId === sessionId);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<{ type: string; message: string } | null>(null);

  // Ensure global IPC listeners are registered once
  useEffect(() => {
    ensureGlobalListenersRegistered();
  }, []);

  // Set up error and stopped callbacks when this session becomes active
  useEffect(() => {
    if (isVoiceActive && sessionId === activeVoiceSessionId) {
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
        window.electronAPI.invoke('voice-mode:test-disconnect', workspacePath || null, sessionId || '');
        activeVoiceSessionId = null;
        setIsVoiceActive(false);
        onVoiceActiveChange?.(false);
      };

      // Callback for when session is stopped programmatically (by AI assistant)
      globalStoppedCallback = () => {
        setIsVoiceActive(false);
        onVoiceActiveChange?.(false);
      };
    }
    return () => {
      if (sessionId === activeVoiceSessionId) {
        globalErrorCallback = null;
        globalStoppedCallback = null;
      }
    };
  }, [isVoiceActive, sessionId, workspacePath, onVoiceActiveChange]);

  // Clean up if this component unmounts while its session is active
  useEffect(() => {
    return () => {
      // Only clean up if THIS session is the active one
      if (activeVoiceSessionId === sessionId) {
        if (globalAudioCapture) {
          globalAudioCapture.stop();
          globalAudioCapture = null;
        }
        if (globalAudioPlayback) {
          globalAudioPlayback.destroy();
          globalAudioPlayback = null;
        }
        window.electronAPI.invoke('voice-mode:test-disconnect', workspacePath || null, sessionId || '');
        activeVoiceSessionId = null;
      }
    };
  }, [sessionId, workspacePath]);

  const handleToggleVoice = async () => {
    // Clear any previous error when user tries again
    setError(null);

    const isThisSessionActive = activeVoiceSessionId === sessionId;

    if (isThisSessionActive) {
      // Stop voice mode for this session
      try {
        // Stop audio capture
        if (globalAudioCapture) {
          globalAudioCapture.stop();
          globalAudioCapture = null;
        }

        // Stop audio playback
        if (globalAudioPlayback) {
          globalAudioPlayback.destroy();
          globalAudioPlayback = null;
        }

        // Disconnect from OpenAI
        const result = await window.electronAPI.invoke('voice-mode:test-disconnect', workspacePath || null, sessionId || '') as {
          success: boolean;
          tokenUsage?: { inputAudio: number; outputAudio: number; text: number; total: number };
        };

        // Persist voice token usage to session metadata
        if (result.tokenUsage && result.tokenUsage.total > 0 && sessionId) {
          try {
            await window.electronAPI.invoke('ai:updateSessionMetadata', sessionId, {
              voiceTokenUsage: result.tokenUsage,
            });
            console.log('[VoiceModeButton] Persisted voice token usage:', result.tokenUsage);
          } catch (persistError) {
            console.error('[VoiceModeButton] Failed to persist voice token usage:', persistError);
          }
        }

        activeVoiceSessionId = null;
        setIsVoiceActive(false);
        onVoiceActiveChange?.(false);
      } catch (error) {
        console.error('[VoiceModeButton] Failed to stop voice mode:', error);
      }
    } else {
      // Start voice mode for this session
      setIsConnecting(true);
      try {
        // If another session is active, stop it first
        if (activeVoiceSessionId !== null && activeVoiceSessionId !== sessionId) {
          const previousSessionId = activeVoiceSessionId;

          // Stop audio capture and playback
          if (globalAudioCapture) {
            globalAudioCapture.stop();
            globalAudioCapture = null;
          }
          if (globalAudioPlayback) {
            globalAudioPlayback.destroy();
            globalAudioPlayback = null;
          }

          // Disconnect the PREVIOUS session
          await window.electronAPI.invoke('voice-mode:test-disconnect', workspacePath || null, previousSessionId);
          activeVoiceSessionId = null;
        }

        // Connect to OpenAI with session context
        const result = await window.electronAPI.invoke('voice-mode:test-connection', workspacePath || null, sessionId || '');
        if (!result.success) {
          console.error('[VoiceModeButton] Failed to start voice mode:', result.message);
          setError({ type: 'connection_failed', message: result.message || 'Failed to connect to voice service' });
          setIsConnecting(false);
          return;
        }

        // Set up audio playback
        globalAudioPlayback = new AudioPlayback();

        // Start capturing audio from microphone
        globalAudioCapture = new AudioCapture();
        await globalAudioCapture.start((pcm16Base64) => {
          // Send audio chunks to OpenAI
          window.electronAPI.invoke('voice-mode:send-audio', workspacePath || null, sessionId || '', pcm16Base64);
        });

        activeVoiceSessionId = sessionId || null;
        setIsVoiceActive(true);
        onVoiceActiveChange?.(true);
      } catch (error) {
        console.error('[VoiceModeButton] Failed to start voice mode:', error);
        setError({ type: 'connection_failed', message: error instanceof Error ? error.message : 'Failed to start voice mode' });
        // Clean up on error
        if (globalAudioCapture) {
          globalAudioCapture.stop();
          globalAudioCapture = null;
        }
        if (globalAudioPlayback) {
          globalAudioPlayback.destroy();
          globalAudioPlayback = null;
        }
        activeVoiceSessionId = null;
      } finally {
        setIsConnecting(false);
      }
    }
  };

  if (!voiceModeEnabled) {
    return null;
  }

  // Determine button state and appearance
  const getButtonIcon = () => {
    if (isConnecting) return 'sync';
    if (isVoiceActive) return 'mic';
    return 'mic_off';
  };

  const getButtonTitle = () => {
    if (isConnecting) return 'Connecting...';
    if (error) return `Error: ${getErrorMessage(error)}`;
    if (isVoiceActive) return 'Stop Voice Mode';
    return 'Start Voice Mode';
  };

  const getButtonColor = () => {
    if (error) return 'var(--error-color, #dc3545)';
    if (isConnecting) return 'var(--warning-color, #ffc107)';
    if (isVoiceActive) return 'var(--nim-primary)';
    return 'transparent';
  };

  return (
    <div className="relative inline-flex items-center">
      <button
        onClick={handleToggleVoice}
        disabled={isConnecting}
        data-testid="voice-mode-toggle"
        className={`p-1.5 rounded-md text-[13px] font-medium flex items-center gap-1 transition-all duration-150 ${
          error ? 'border border-[var(--error-color,#dc3545)]' : 'border border-nim'
        } ${isConnecting ? 'cursor-wait' : 'cursor-pointer'} ${
          (isVoiceActive || isConnecting || error) ? 'text-white opacity-100' : 'text-nim-muted opacity-70 hover:opacity-100'
        }`}
        style={{ backgroundColor: getButtonColor() }}
        aria-label={getButtonTitle()}
      >
        <MaterialSymbol
          icon={getButtonIcon()}
          size={16}
          className={isConnecting ? 'animate-spin' : ''}
        />
      </button>
      {error && (
        <div
          className="absolute bottom-[calc(100%+8px)] left-1/2 -translate-x-1/2 bg-nim border border-[var(--error-color,#dc3545)] rounded-lg p-3 min-w-[200px] max-w-[300px] shadow-[0_4px_12px_rgba(0,0,0,0.15)] z-[1000]"
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
