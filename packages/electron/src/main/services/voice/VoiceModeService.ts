/**
 * Voice Mode Service - manages voice mode sessions and integrates with OpenAI Realtime API
 */

import { BrowserWindow, ipcMain, systemPreferences } from 'electron';
import { RealtimeAPIClient } from './RealtimeAPIClient';
import { safeHandle } from '../../utils/ipcRegistry';
import Store from 'electron-store';
import { AnalyticsService } from '../analytics/AnalyticsService';

// Store active voice session info
interface VoiceSession {
  poc: RealtimeAPIClient;
  window: BrowserWindow;
  workspacePath: string | null;
  sessionId: string;
  cleanupCompletionListener: () => void;
  startTime: number; // For duration tracking
  hasExistingSession: boolean; // Whether AI session had prior messages
}

/**
 * Get duration category for analytics (privacy-preserving)
 */
function getDurationCategory(durationMs: number): 'short' | 'medium' | 'long' {
  if (durationMs < 60000) return 'short'; // < 1 minute
  if (durationMs < 300000) return 'medium'; // 1-5 minutes
  return 'long'; // > 5 minutes
}

/**
 * Send voice session ended analytics event
 */
function sendSessionEndedEvent(reason: string, startTime: number): void {
  const durationMs = Date.now() - startTime;
  AnalyticsService.getInstance().sendEvent('voice_session_ended', {
    reason,
    durationCategory: getDurationCategory(durationMs),
  });
}

let activeVoiceSession: VoiceSession | null = null;

/**
 * Check if voice mode is active for a given session
 */
export function isVoiceModeActive(sessionId: string): boolean {
  return activeVoiceSession !== null && activeVoiceSession.sessionId === sessionId;
}

/**
 * Get the active voice session ID if one exists
 * Returns null if no voice session is active
 */
export function getActiveVoiceSessionId(): string | null {
  return activeVoiceSession?.sessionId ?? null;
}

/**
 * Send a message to the active voice agent to be spoken aloud
 * Returns true if the message was sent successfully, false if:
 * - No active voice session for this sessionId
 * - Voice agent WebSocket is not connected
 * - Message sending failed
 */
export function sendToVoiceAgent(sessionId: string, message: string): boolean {
  if (!activeVoiceSession || activeVoiceSession.sessionId !== sessionId) {
    console.error('[VoiceModeService] No active voice session for sessionId:', sessionId);
    return false;
  }

  // Check if the voice agent is still connected
  if (!activeVoiceSession.poc.isConnected()) {
    console.error('[VoiceModeService] Voice agent WebSocket is not connected');
    return false;
  }

  // Attempt to send the message
  const success = activeVoiceSession.poc.sendUserMessage(message);

  if (!success) {
    console.error('[VoiceModeService] Failed to send message to voice agent');
  }

  return success;
}

export function initVoiceModeService() {
  // Create settings store instance (MUST match AIService store name!)
  const settingsStore = new Store<Record<string, unknown>>({
    name: 'ai-settings',  // Same as AIService!
    watch: true,
  });

  /**
   * Test OpenAI Realtime API connection
   */
  safeHandle('voice-mode:test-connection', async (event, workspacePath: string | null, sessionId: string) => {
    try {
      if (!sessionId) {
        throw new Error('Session ID is required for voice mode');
      }

      // Request microphone permission on macOS (required for packaged builds)
      if (process.platform === 'darwin') {
        const micStatus = systemPreferences.getMediaAccessStatus('microphone');
        console.log('[VoiceModeService] Microphone access status:', micStatus);

        if (micStatus !== 'granted') {
          // Request permission - this will show the system dialog
          const granted = await systemPreferences.askForMediaAccess('microphone');
          if (!granted) {
            throw new Error('Microphone access is required for Voice Mode. Please grant permission in System Settings > Privacy & Security > Microphone.');
          }
        }
      }

      // If there's an active session, disconnect it first
      if (activeVoiceSession) {
        activeVoiceSession.poc.disconnect();
        activeVoiceSession = null;
      }

      // Get OpenAI API key from settings store
      const apiKeys = settingsStore.get('apiKeys', {}) as Record<string, string>;
      const apiKey = apiKeys['openai'] || process.env.OPENAI_API_KEY;

      if (!apiKey) {
        throw new Error('OpenAI API key not configured. Please add it in Settings.');
      }

      // Store window reference for sending events
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window) {
        throw new Error('Could not find window for session');
      }

      // Load session to get context by calling the renderer to fetch it
      let sessionContext = 'New session with no prior messages.';
      let hasExistingSession = false; // For analytics
      try {
        // Request session data from the renderer
        const session = await window.webContents.executeJavaScript(`
          window.electronAPI.invoke('ai:loadSession', ${JSON.stringify(sessionId)}, ${JSON.stringify(workspacePath)}, false)
        `);

        if (session) {
          const messageCount = session.messages?.length || 0;
          hasExistingSession = messageCount > 0;
          // Session name is stored in the 'title' field, not 'name'
          const sessionName = session.title || session.name || 'Untitled';
          const userMessageCount = session.messages?.filter((m: any) => m.role === 'user').length || 0;

          if (messageCount === 0) {
            sessionContext = `Session "${sessionName}" - New session with no messages yet.`;
          } else {
            sessionContext = `Session "${sessionName}" - ${userMessageCount} user ${userMessageCount === 1 ? 'prompt' : 'prompts'} so far, ${messageCount} total messages in conversation.`;
          }
        }
      } catch (error) {
        console.error('[VoiceModeService] Failed to load session context:', error);
      }

      // Create PoC instance with agent session context
      const poc = new RealtimeAPIClient(apiKey, sessionId, workspacePath, window, sessionContext);

      // Set up callbacks to forward audio/text to renderer
      // Include sessionId in the event payload so the renderer can filter
      poc.setOnAudio((audioBase64) => {
        if (window && !window.isDestroyed()) {
          window.webContents.send('voice-mode:audio-received', { sessionId, audioBase64 });
        }
      });

      poc.setOnText((text) => {
        if (window && !window.isDestroyed()) {
          window.webContents.send('voice-mode:text-received', { sessionId, text });
        }
      });

      poc.setOnSubmitPrompt(async (prompt) => {
        if (window && !window.isDestroyed()) {
          window.webContents.send('voice-mode:submit-prompt', { sessionId, workspacePath, prompt });
        }
      });

      poc.setOnInterruption(() => {
        if (window && !window.isDestroyed()) {
          window.webContents.send('voice-mode:interrupt', { sessionId });
        }
      });

      poc.setOnError((error) => {
        console.error('[VoiceModeService] Error from OpenAI:', error.type, error.message);
        if (window && !window.isDestroyed()) {
          window.webContents.send('voice-mode:error', { sessionId, error });
        }
      });

      // Track when connection is closed (for timeout/error disconnect reasons)
      const sessionStartTime = Date.now();
      poc.setOnDisconnect((reason) => {
        // Only send analytics if this is still the active session
        // (user_stopped is handled separately in the disconnect handler)
        if (activeVoiceSession?.sessionId === sessionId && reason !== 'user_stopped') {
          sendSessionEndedEvent(reason, sessionStartTime);
          // Clean up session on auto-disconnect
          activeVoiceSession.cleanupCompletionListener();
          activeVoiceSession = null;
        }
      });

      // Listen for agent completion events
      // When the coding agent finishes a task, we'll get a message from the renderer
      // and can notify the voice assistant
      const completionListener = (_event: any, data: { sessionId: string; summary?: string }) => {
        if (data.sessionId === sessionId) {
          // Extract a concise summary from the coding agent's response
          // The summary contains the full text response, which may be very long
          // We need to create a brief notification for the voice agent
          let completionMessage: string;

          if (data.summary) {
            // Try to extract key information from the summary
            // Look for common patterns like "I've..." or action verbs
            const summaryLines = data.summary.split('\n').filter(line => line.trim());
            const firstLine = summaryLines[0] || '';

            // If the first line is short and clear, use it. Otherwise, provide a generic message
            if (firstLine.length < 200 && firstLine.length > 0) {
              completionMessage = `[INTERNAL: Your task is complete. Here's what you did: ${firstLine}. Acknowledge naturally in first person, be brief.]`;
            } else {
              // Summary is too long or unclear, provide generic completion
              completionMessage = '[INTERNAL: Your previous task has completed. Acknowledge the completion to the user naturally using first person ("I finished that task"). Be brief.]';
            }
          } else {
            completionMessage = '[INTERNAL: Your previous task has completed. Acknowledge the completion to the user naturally using first person ("I finished that task"). Be brief.]';
          }

          // Send the completion notification to the voice assistant
          poc.sendUserMessage(completionMessage);
        }
      };
      ipcMain.on('voice-mode:agent-task-complete', completionListener);

      // Store cleanup function for this listener
      const cleanupCompletionListener = () => {
        ipcMain.removeListener('voice-mode:agent-task-complete', completionListener);
      };

      // Connect
      await poc.connect();

      // Store active session info
      activeVoiceSession = {
        poc,
        window,
        workspacePath,
        sessionId,
        cleanupCompletionListener,
        startTime: Date.now(),
        hasExistingSession,
      };

      // Track session started
      AnalyticsService.getInstance().sendEvent('voice_session_started');

      console.log('[VoiceModeService] Voice mode activated for sessionId:', sessionId);

      return {
        success: true,
        message: 'Successfully connected to OpenAI Realtime API',
        sessionId: poc.isConnected() ? 'connected' : null,
      };
    } catch (error) {
      return {
        success: false,
        message: `Connection failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  });

  /**
   * Disconnect from OpenAI
   */
  safeHandle('voice-mode:test-disconnect', async (_event, workspacePath: string | null, sessionId: string) => {
    try {
      if (!sessionId) {
        throw new Error('Session ID is required for voice mode');
      }

      // Only disconnect if this is the active session
      if (activeVoiceSession && activeVoiceSession.sessionId === sessionId) {
        // Track session ended before cleanup
        sendSessionEndedEvent('user_stopped', activeVoiceSession.startTime);

        activeVoiceSession.poc.disconnect();
        // Clean up the completion listener
        activeVoiceSession.cleanupCompletionListener();
        activeVoiceSession = null;
      }

      return {
        success: true,
        message: 'Disconnected',
      };
    } catch (error) {
      return {
        success: false,
        message: `Disconnect failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  });

  /**
   * Check connection status
   */
  safeHandle('voice-mode:test-status', async (_event, workspacePath: string | null, sessionId: string) => {
    const isActiveSession = activeVoiceSession?.sessionId === sessionId;
    const connected = isActiveSession && activeVoiceSession?.poc.isConnected() || false;
    return {
      success: true,
      connected,
      message: connected ? 'Connected' : 'Disconnected',
    };
  });

  /**
   * Send audio chunk to OpenAI
   */
  safeHandle('voice-mode:send-audio', async (_event, workspacePath: string | null, sessionId: string, audioBase64: string) => {
    try {
      if (!sessionId) {
        throw new Error('Session ID is required for voice mode');
      }

      if (!activeVoiceSession || activeVoiceSession.sessionId !== sessionId) {
        throw new Error('No active voice session for this session ID');
      }

      if (!activeVoiceSession.poc.isConnected()) {
        throw new Error('Not connected to OpenAI');
      }

      activeVoiceSession.poc.sendAudio(audioBase64);

      return {
        success: true,
      };
    } catch (error) {
      return {
        success: false,
        message: `Send audio failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  });

  /**
   * Commit audio buffer (tell OpenAI to process it)
   */
  safeHandle('voice-mode:commit-audio', async (_event, workspacePath: string | null, sessionId: string) => {
    try {
      if (!sessionId) {
        throw new Error('Session ID is required for voice mode');
      }

      if (!activeVoiceSession || activeVoiceSession.sessionId !== sessionId) {
        throw new Error('No active voice session for this session ID');
      }

      if (!activeVoiceSession.poc.isConnected()) {
        throw new Error('Not connected to OpenAI');
      }

      activeVoiceSession.poc.commitAudio();

      return {
        success: true,
      };
    } catch (error) {
      return {
        success: false,
        message: `Commit audio failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  });

  console.log('[VoiceModeService] Test handlers initialized');
}
