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

/**
 * Stop the active voice session programmatically
 * Called by the AI assistant via MCP tool to end voice mode
 * Returns true if a session was stopped, false if no session was active
 */
export function stopVoiceSession(): boolean {
  if (!activeVoiceSession) {
    console.log('[VoiceModeService] No active voice session to stop');
    return false;
  }

  const sessionId = activeVoiceSession.sessionId;
  console.log('[VoiceModeService] Stopping voice session programmatically:', sessionId);

  // Track session ended (reason: assistant_stopped)
  sendSessionEndedEvent('assistant_stopped', activeVoiceSession.startTime);

  // Disconnect from OpenAI
  activeVoiceSession.poc.disconnect('user_stopped');

  // Clean up the completion listener
  activeVoiceSession.cleanupCompletionListener();

  // Notify the renderer that voice mode was stopped
  if (activeVoiceSession.window && !activeVoiceSession.window.isDestroyed()) {
    activeVoiceSession.window.webContents.send('voice-mode:stopped', { sessionId });
  }

  activeVoiceSession = null;

  return true;
}

/**
 * Get a summary of the current AI session
 * Returns session metadata, message counts, and recent activity
 */
export async function getSessionSummary(): Promise<{
  success: boolean;
  summary?: string;
  details?: {
    sessionId: string;
    sessionName: string;
    messageCount: number;
    userMessageCount: number;
    assistantMessageCount: number;
    sessionDurationMinutes: number;
    recentTopics: string[];
  };
  error?: string;
}> {
  if (!activeVoiceSession) {
    return { success: false, error: 'No active voice session' };
  }

  try {
    const { sessionId, window, workspacePath } = activeVoiceSession;

    // Load session data from the renderer
    const session = await window.webContents.executeJavaScript(`
      window.electronAPI.invoke('ai:loadSession', ${JSON.stringify(sessionId)}, ${JSON.stringify(workspacePath)}, false)
    `);

    if (!session) {
      return { success: false, error: 'Session not found' };
    }

    const messages = session.messages || [];
    const userMessages = messages.filter((m: any) => m.role === 'user');
    const assistantMessages = messages.filter((m: any) => m.role === 'assistant');
    const sessionName = session.title || session.name || 'Untitled';

    // Calculate session duration
    const createdAt = session.createdAt || Date.now();
    const sessionDurationMinutes = Math.round((Date.now() - createdAt) / 60000);

    // Extract recent topics from user messages (last 5)
    const recentUserMessages = userMessages.slice(-5);
    const recentTopics = recentUserMessages.map((m: any) => {
      const content = typeof m.content === 'string' ? m.content : '';
      // Truncate to first 50 chars
      return content.length > 50 ? content.substring(0, 50) + '...' : content;
    });

    const details = {
      sessionId,
      sessionName,
      messageCount: messages.length,
      userMessageCount: userMessages.length,
      assistantMessageCount: assistantMessages.length,
      sessionDurationMinutes,
      recentTopics,
    };

    // Generate a human-readable summary
    const summary = `Session "${sessionName}" has ${userMessages.length} user messages and ${assistantMessages.length} assistant responses over ${sessionDurationMinutes} minutes. ${recentTopics.length > 0 ? `Recent topics: ${recentTopics.join('; ')}` : 'No messages yet.'}`;

    return { success: true, summary, details };
  } catch (error) {
    console.error('[VoiceModeService] Failed to get session summary:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export function initVoiceModeService() {
  // Create settings store instance (MUST match AIService store name!)
  const settingsStore = new Store<Record<string, unknown>>({
    name: 'ai-settings',  // Same as AIService!
    watch: true,
  });

  // Voice mode settings store (for voice mode specific settings including custom prompts)
  const voiceModeSettingsStore = new Store<Record<string, unknown>>({
    name: 'nimbalyst-settings',
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

      // Load custom voice agent prompt, turn detection settings, and voice
      const voiceModeSettings = voiceModeSettingsStore.get('voiceMode') as {
        voice?: 'alloy' | 'ash' | 'ballad' | 'coral' | 'echo' | 'sage' | 'shimmer' | 'verse' | 'marin' | 'cedar';
        voiceAgentPrompt?: { prepend?: string; append?: string };
        codingAgentPrompt?: { prepend?: string; append?: string };
        turnDetection?: {
          mode: 'server_vad' | 'push_to_talk';
          vadThreshold?: number;
          silenceDuration?: number;
          interruptible?: boolean;
        };
      } | undefined;
      const customPrompt = voiceModeSettings?.voiceAgentPrompt || {};
      const turnDetection = voiceModeSettings?.turnDetection || {
        mode: 'server_vad' as const,
        vadThreshold: 0.5,
        silenceDuration: 500,
        interruptible: true,
      };
      const selectedVoice = voiceModeSettings?.voice || 'alloy';

      // Create PoC instance with agent session context, custom prompt, turn detection, and voice
      const poc = new RealtimeAPIClient(apiKey, sessionId, workspacePath, window, sessionContext, customPrompt, turnDetection, selectedVoice);

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

      // Load coding agent prompt settings for inclusion in submit-prompt events
      const codingAgentPromptSettings = voiceModeSettings?.codingAgentPrompt || {};

      poc.setOnSubmitPrompt(async (prompt) => {
        if (window && !window.isDestroyed()) {
          // Include coding agent prompt settings so they can be passed to the provider
          window.webContents.send('voice-mode:submit-prompt', {
            sessionId,
            workspacePath,
            prompt,
            codingAgentPrompt: codingAgentPromptSettings,
          });
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

      // Set up callbacks for voice agent tools
      poc.setOnStopSession(() => {
        return stopVoiceSession();
      });

      poc.setOnGetSessionSummary(async () => {
        const result = await getSessionSummary();
        return {
          success: result.success,
          summary: result.summary,
          error: result.error,
        };
      });

      poc.setOnAskCodingAgent(async (question: string) => {
        // Send the question to the coding agent via the existing prompt system
        // The [VOICE] prefix signals this is from the voice assistant
        // The system prompt (via isVoiceMode in documentContext) provides full context
        const questionPrompt = `[VOICE] ${question}`;

        try {
          if (window && !window.isDestroyed()) {
            // Create a promise that resolves when the agent responds
            return new Promise((resolve) => {
              let timeoutId: NodeJS.Timeout | null = null;

              // Set up a one-time listener for the response via ipcMain
              // This listens for the same event that submit_agent_prompt uses
              const responseHandler = (_event: any, data: { sessionId: string; summary: string }) => {
                if (data.sessionId === sessionId) {
                  // Clean up
                  ipcMain.removeListener('voice-mode:agent-task-complete', responseHandler);
                  if (timeoutId) clearTimeout(timeoutId);

                  // Return the answer
                  resolve({
                    success: true,
                    answer: data.summary || 'I was unable to find an answer.',
                  });
                }
              };

              // Listen for the response
              ipcMain.on('voice-mode:agent-task-complete', responseHandler);

              // Send the question to the renderer to queue
              window.webContents.send('voice-mode:submit-prompt', {
                sessionId,
                workspacePath,
                prompt: questionPrompt,
              });

              // Timeout after 60 seconds
              timeoutId = setTimeout(() => {
                ipcMain.removeListener('voice-mode:agent-task-complete', responseHandler);
                resolve({
                  success: false,
                  error: 'Question timed out waiting for response',
                });
              }, 60000);
            });
          } else {
            return { success: false, error: 'Window not available' };
          }
        } catch (error) {
          console.error('[VoiceModeService] Failed to ask coding agent:', error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
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

  /**
   * Preview a voice using OpenAI's TTS API
   */
  safeHandle('voice-mode:preview-voice', async (event, voiceId: string) => {
    try {
      // Get OpenAI API key
      const apiKeys = settingsStore.get('apiKeys') as Record<string, string> | undefined;
      const apiKey = apiKeys?.openai;

      if (!apiKey) {
        return {
          success: false,
          message: 'OpenAI API key not configured',
        };
      }

      // TTS API supports: alloy, ash, coral, echo, fable, nova, onyx, sage, shimmer
      // Realtime API adds: ballad, marin, cedar, verse
      // Map unsupported voices to similar TTS voices for preview
      const ttsVoiceMap: Record<string, string> = {
        'ballad': 'nova',    // Warm and melodic -> Nova
        'marin': 'alloy',    // Natural conversational -> Alloy
        'cedar': 'onyx',     // Deep and resonant -> Onyx
        'verse': 'fable',    // Dynamic and engaging -> Fable
      };

      const ttsVoice = ttsVoiceMap[voiceId] || voiceId;
      const isApproximation = ttsVoiceMap[voiceId] !== undefined;

      // Use OpenAI's TTS API to generate a preview
      const response = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'tts-1',
          input: isApproximation
            ? `Hello! I'm ${voiceId}. This preview uses a similar voice. The actual voice in conversation will sound slightly different.`
            : `Hello! I'm ${voiceId}. This is how I sound when speaking to you.`,
          voice: ttsVoice,
          response_format: 'mp3',
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`TTS API error: ${response.status} - ${errorText}`);
      }

      // Get the audio data
      const audioBuffer = await response.arrayBuffer();
      const audioBase64 = Buffer.from(audioBuffer).toString('base64');

      // Get the window that made the request
      const window = BrowserWindow.fromWebContents(event.sender);
      if (window) {
        // Send audio to renderer for playback
        window.webContents.send('voice-mode:preview-audio', {
          voiceId,
          audioBase64,
          format: 'mp3',
        });
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        message: `Voice preview failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  });

  console.log('[VoiceModeService] Test handlers initialized');
}
