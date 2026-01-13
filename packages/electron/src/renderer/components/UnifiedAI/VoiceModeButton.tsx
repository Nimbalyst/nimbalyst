/**
 * Voice Mode Button
 *
 * Displays a microphone button when voice mode is enabled in settings.
 * Clicking it starts/stops voice mode.
 */

import React, { useState, useEffect, useRef } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';
import { AudioCapture } from '../../utils/audioCapture';
import { AudioPlayback } from '../../utils/audioPlayback';

// Global singleton state - only ONE voice session can be active at a time
let activeVoiceSessionId: string | null = null;
let globalAudioCapture: AudioCapture | null = null;
let globalAudioPlayback: AudioPlayback | null = null;

// Register global IPC listeners ONCE (not per button click!)
let globalListenersRegistered = false;
// Callback for error notifications - set by component
let globalErrorCallback: ((error: { type: string; message: string }) => void) | null = null;
// Callback for programmatic stop notifications - set by component
let globalStoppedCallback: (() => void) | null = null;

function ensureGlobalListenersRegistered() {
  if (globalListenersRegistered) {
    return;
  }

  // These listeners are GLOBAL and permanent - they filter by sessionId
  window.electronAPI.on('voice-mode:audio-received', (payload: { sessionId: string; audioBase64: string }) => {
    // Only play audio if the event is for the active session
    if (payload.sessionId === activeVoiceSessionId && globalAudioPlayback) {
      globalAudioPlayback.play(payload.audioBase64);
    }
  });

  window.electronAPI.on('voice-mode:text-received', (payload: { sessionId: string; text: string }) => {
    // Text transcription received (not currently displayed)
  });

  window.electronAPI.on('voice-mode:submit-prompt', async (payload: {
    sessionId: string;
    workspacePath: string | null;
    prompt: string;
    codingAgentPrompt?: { prepend?: string; append?: string };
  }) => {
    try {
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
    } catch (error) {
      console.error('[VoiceModeButton] Failed to queue prompt:', error);
    }
  });

  // Listen for agent task completion (ai:streamResponse with isComplete=true)
  // and notify the main process so it can tell the voice assistant
  window.electronAPI.onAIStreamResponse((data: any) => {
    if (data.isComplete && data.sessionId === activeVoiceSessionId) {
      // Extract summary from the agent's final response
      const summary = data.content || 'Task completed';

      // Notify main process that the agent finished, including the summary
      window.electronAPI.send('voice-mode:agent-task-complete', {
        sessionId: data.sessionId,
        summary: summary
      });
    }
  });

  // Listen for interruption events (user started speaking while assistant was talking)
  window.electronAPI.on('voice-mode:interrupt', (payload: { sessionId: string }) => {
    if (payload.sessionId === activeVoiceSessionId && globalAudioPlayback) {
      globalAudioPlayback.stop();
    }
  });

  // Listen for error events (quota exceeded, rate limits, etc.)
  window.electronAPI.on('voice-mode:error', (payload: { sessionId: string; error: { type: string; message: string } }) => {
    if (payload.sessionId === activeVoiceSessionId && globalErrorCallback) {
      globalErrorCallback(payload.error);
    }
  });

  // Listen for programmatic stop events (e.g., AI assistant stopped the session)
  window.electronAPI.on('voice-mode:stopped', (payload: { sessionId: string }) => {
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
      activeVoiceSessionId = null;
      // Trigger UI update via the stopped callback if registered
      if (globalStoppedCallback) {
        globalStoppedCallback();
      }
    }
  });

  globalListenersRegistered = true;
}

interface VoiceModeButtonProps {
  sessionId?: string; // The AI session this button controls
  workspacePath?: string; // The workspace path for this session
}

export function VoiceModeButton({ sessionId, workspacePath }: VoiceModeButtonProps) {
  const [voiceModeEnabled, setVoiceModeEnabled] = useState(false);
  const [isVoiceActive, setIsVoiceActive] = useState(activeVoiceSessionId === sessionId);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<{ type: string; message: string } | null>(null);

  // Load voice mode settings on mount
  useEffect(() => {
    async function loadSettings() {
      try {
        // Ensure global IPC listeners are registered (one-time setup)
        ensureGlobalListenersRegistered();

        // Initialize voice mode handlers
        await window.electronAPI.invoke('voice-mode:init');

        // Get settings
        const settings = await window.electronAPI.invoke('voice-mode:get-settings');
        setVoiceModeEnabled(settings?.enabled || false);
      } catch (error) {
        console.error('[VoiceModeButton] Failed to load settings:', error);
        setVoiceModeEnabled(false);
      } finally {
        setIsLoading(false);
      }
    }

    loadSettings();
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
      };

      // Callback for when session is stopped programmatically (by AI assistant)
      globalStoppedCallback = () => {
        setIsVoiceActive(false);
      };
    }
    return () => {
      if (sessionId === activeVoiceSessionId) {
        globalErrorCallback = null;
        globalStoppedCallback = null;
      }
    };
  }, [isVoiceActive, sessionId, workspacePath]);

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
        await window.electronAPI.invoke('voice-mode:test-disconnect', workspacePath || null, sessionId || '');
        activeVoiceSessionId = null;
        setIsVoiceActive(false);
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
    if (isVoiceActive) return 'var(--primary-color)';
    return 'transparent';
  };

  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <button
        onClick={handleToggleVoice}
        disabled={isConnecting}
        data-testid="voice-mode-toggle"
        style={{
          padding: '0.375rem',
          borderRadius: '0.375rem',
          fontSize: '0.8125rem',
          fontWeight: 500,
          backgroundColor: getButtonColor(),
          color: (isVoiceActive || isConnecting || error) ? 'white' : 'var(--text-secondary)',
          border: error ? '1px solid var(--error-color, #dc3545)' : '1px solid var(--border-primary)',
          cursor: isConnecting ? 'wait' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '0.25rem',
          transition: 'all 0.15s ease',
          opacity: (isVoiceActive || isConnecting || error) ? 1 : 0.7,
        }}
        onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
        onMouseLeave={(e) => e.currentTarget.style.opacity = (isVoiceActive || isConnecting || error) ? '1' : '0.7'}
        title={getButtonTitle()}
      >
        <MaterialSymbol
          icon={getButtonIcon()}
          size={16}
          style={isConnecting ? { animation: 'spin 1s linear infinite' } : undefined}
        />
      </button>
      {error && (
        <div
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 8px)',
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: 'var(--background-primary)',
            border: '1px solid var(--error-color, #dc3545)',
            borderRadius: '0.5rem',
            padding: '0.75rem',
            minWidth: '200px',
            maxWidth: '300px',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
            zIndex: 1000,
          }}
        >
          <div style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.5rem',
            color: 'var(--text-primary)',
          }}>
            <MaterialSymbol icon="error" size={18} style={{ color: 'var(--error-color, #dc3545)', flexShrink: 0 }} />
            <div style={{ fontSize: '0.8125rem', lineHeight: '1.4' }}>
              <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>Voice Mode Error</div>
              <div style={{ color: 'var(--text-secondary)' }}>{getErrorMessage(error)}</div>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); setError(null); }}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '0',
                marginLeft: 'auto',
                color: 'var(--text-tertiary)',
              }}
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
