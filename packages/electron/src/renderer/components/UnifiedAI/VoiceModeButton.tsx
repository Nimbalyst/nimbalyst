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

  window.electronAPI.on('voice-mode:submit-prompt', async (payload: { sessionId: string; workspacePath: string | null; prompt: string }) => {
    try {
      // Queue the prompt using the existing queue system
      // This ensures prompts are processed sequentially, not concurrently
      await window.electronAPI.invoke(
        'ai:createQueuedPrompt',
        payload.sessionId,
        payload.prompt,
        undefined, // attachments
        undefined  // documentContext
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
      }
    }
  };

  if (!voiceModeEnabled) {
    return null;
  }

  return (
    <button
      onClick={handleToggleVoice}
      style={{
        padding: '0.375rem',
        borderRadius: '0.375rem',
        fontSize: '0.8125rem',
        fontWeight: 500,
        backgroundColor: isVoiceActive ? 'var(--primary-color)' : 'transparent',
        color: isVoiceActive ? 'white' : 'var(--text-secondary)',
        border: '1px solid var(--border-primary)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '0.25rem',
        transition: 'all 0.15s ease',
        opacity: isVoiceActive ? 1 : 0.7,
      }}
      onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
      onMouseLeave={(e) => e.currentTarget.style.opacity = isVoiceActive ? '1' : '0.7'}
      title={isVoiceActive ? "Stop Voice Mode" : "Start Voice Mode"}
    >
      <MaterialSymbol icon={isVoiceActive ? "mic" : "mic_off"} size={16} />
    </button>
  );
}
