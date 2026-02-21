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

  // Get final token usage before disconnecting
  const finalTokenUsage = activeVoiceSession.poc.getTokenUsage();

  // Disconnect from OpenAI
  activeVoiceSession.poc.disconnect('user_stopped');

  // Clean up the completion listener
  activeVoiceSession.cleanupCompletionListener();

  // Notify the renderer that voice mode was stopped, include final token usage for persistence
  if (activeVoiceSession.window && !activeVoiceSession.window.isDestroyed()) {
    activeVoiceSession.window.webContents.send('voice-mode:stopped', {
      sessionId,
      tokenUsage: finalTokenUsage,
    });
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

      // Check microphone permission on macOS
      if (process.platform === 'darwin') {
        const micStatus = systemPreferences.getMediaAccessStatus('microphone');
        console.log('[VoiceModeService] Microphone access status:', micStatus);

        if (micStatus !== 'granted') {
          // NOTE: We cannot programmatically request microphone permission because
          // the app intentionally omits the audio-input entitlement to prevent
          // permission prompts when Claude Agent SDK spawns subprocesses.
          // Users must manually grant permission in System Settings.
          throw new Error('Microphone access is required for Voice Mode.\n\nPlease manually grant permission:\n1. Open System Settings\n2. Go to Privacy & Security > Microphone\n3. Enable access for Nimbalyst\n4. Try again');
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
          const sessionMode = session.mode || 'agent'; // 'agent' or 'planning'

          // Build context parts
          const contextParts: string[] = [];
          contextParts.push(`Session: "${sessionName}"`);
          contextParts.push(`Mode: ${sessionMode === 'planning' ? 'Planning mode (read-only exploration)' : 'Agent mode (can make changes)'}`);

          if (messageCount === 0) {
            contextParts.push('Status: New session with no messages yet.');
          } else {
            contextParts.push(`Activity: ${userMessageCount} user ${userMessageCount === 1 ? 'prompt' : 'prompts'}, ${messageCount} total messages.`);

            // Extract recent activity from messages (last few tool calls or key actions)
            const recentMessages = (session.messages || []).slice(-10);
            const recentToolCalls = recentMessages
              .filter((m: any) => m.role === 'assistant' && m.toolCalls?.length > 0)
              .flatMap((m: any) => m.toolCalls || [])
              .slice(-5);

            if (recentToolCalls.length > 0) {
              const toolSummary = recentToolCalls.map((tc: any) => {
                if (tc.name === 'Edit' || tc.name === 'Write') {
                  const filePath = tc.arguments?.file_path || tc.arguments?.filePath;
                  return filePath ? `edited ${filePath.split('/').pop()}` : 'edited a file';
                } else if (tc.name === 'Read') {
                  const filePath = tc.arguments?.file_path || tc.arguments?.filePath;
                  return filePath ? `read ${filePath.split('/').pop()}` : 'read a file';
                } else if (tc.name === 'Bash') {
                  return 'ran a command';
                } else if (tc.name === 'Grep' || tc.name === 'Glob') {
                  return 'searched files';
                }
                return tc.name?.toLowerCase() || 'used a tool';
              }).join(', ');
              contextParts.push(`Recent: ${toolSummary}`);
            }
          }

          sessionContext = contextParts.join('\n');
        }
      } catch (error) {
        console.error('[VoiceModeService] Failed to load session context:', error);
      }

      // Get files that have been read or edited during this session
      try {
        const { SessionFilesRepository } = await import('@nimbalyst/runtime/storage/repositories/SessionFilesRepository');
        const [editedFiles, readFiles] = await Promise.all([
          SessionFilesRepository.getFilesBySession(sessionId, 'edited'),
          SessionFilesRepository.getFilesBySession(sessionId, 'read'),
        ]);

        // Combine and dedupe, prioritizing edited files
        const allFiles = [...editedFiles];
        for (const file of readFiles) {
          if (!allFiles.some(f => f.filePath === file.filePath)) {
            allFiles.push(file);
          }
        }

        if (allFiles.length > 0) {
          // Show up to 8 files, with edited files first
          const fileList = allFiles.slice(0, 8).map(f => {
            const fileName = f.filePath.split('/').pop();
            const isEdited = editedFiles.some(e => e.filePath === f.filePath);
            return isEdited ? `${fileName} (edited)` : fileName;
          }).join(', ');
          sessionContext += `\nSession files: ${fileList}`;
        }
      } catch (error) {
        // Ignore - session files are optional context
        console.error('[VoiceModeService] Failed to load session files:', error);
      }

      // Load AI-generated project summary for voice mode context
      // This is stored in nimbalyst-local/voice-project-summary.md and generated on demand
      if (workspacePath) {
        try {
          const fs = await import('fs/promises');
          const path = await import('path');

          const summaryPath = path.join(workspacePath, 'nimbalyst-local', 'voice-project-summary.md');
          const summaryContent = await fs.readFile(summaryPath, 'utf-8').catch(() => null);

          if (summaryContent) {
            // Include the full summary - it's already AI-curated to be concise and voice-friendly
            sessionContext += `\n\nProject Summary:\n${summaryContent.trim()}`;
          }
        } catch (error) {
          // Ignore - summary file is optional
        }
      }

      // NOTE: Initial active file context is sent by the renderer via
      // voice-mode:editor-context-changed IPC after voiceActiveSessionIdAtom is set.
      // The voiceModeListeners subscription fires checkAndReportFileChange automatically.

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

      // Helper: get the current linked session ID (may change if user switches sessions)
      const currentSessionId = () => activeVoiceSession?.sessionId ?? sessionId;

      // Set up callbacks to forward audio/text to renderer
      // Use currentSessionId() so events always target the current session
      poc.setOnAudio((audioBase64) => {
        if (window && !window.isDestroyed()) {
          window.webContents.send('voice-mode:audio-received', { sessionId: currentSessionId(), audioBase64 });
        }
      });

      poc.setOnText((text) => {
        if (window && !window.isDestroyed()) {
          window.webContents.send('voice-mode:text-received', { sessionId: currentSessionId(), text });
        }
      });

      poc.setOnUserTranscript((transcript) => {
        if (window && !window.isDestroyed()) {
          window.webContents.send('voice-mode:transcript-complete', { sessionId: currentSessionId(), transcript });
        }
      });

      poc.setOnUserTranscriptDelta((delta, itemId) => {
        if (window && !window.isDestroyed()) {
          window.webContents.send('voice-mode:transcript-delta', { sessionId: currentSessionId(), delta, itemId });
        }
      });

      poc.setOnTokenUsage((usage) => {
        if (window && !window.isDestroyed()) {
          window.webContents.send('voice-mode:token-usage', { sessionId: currentSessionId(), usage });
        }
      });

      // Load coding agent prompt settings for inclusion in submit-prompt events
      const codingAgentPromptSettings = voiceModeSettings?.codingAgentPrompt || {};

      poc.setOnSubmitPrompt(async (prompt) => {
        if (window && !window.isDestroyed()) {
          // Include coding agent prompt settings so they can be passed to the provider
          window.webContents.send('voice-mode:submit-prompt', {
            sessionId: currentSessionId(),
            workspacePath,
            prompt,
            codingAgentPrompt: codingAgentPromptSettings,
          });
        }
      });

      poc.setOnInterruption(() => {
        if (window && !window.isDestroyed()) {
          window.webContents.send('voice-mode:interrupt', { sessionId: currentSessionId() });
        }
      });

      poc.setOnError((error) => {
        console.error('[VoiceModeService] Error from OpenAI:', error.type, error.message);
        if (window && !window.isDestroyed()) {
          window.webContents.send('voice-mode:error', { sessionId: currentSessionId(), error });
        }
      });

      // Set up callbacks for voice agent tools
      poc.setOnStopSession(() => {
        return stopVoiceSession();
      });

      poc.setOnPauseListening(() => {
        if (window && !window.isDestroyed()) {
          window.webContents.send('voice-mode:pause-listening', { sessionId: currentSessionId() });
        }
      });

      poc.setOnGetSessionSummary(async () => {
        const result = await getSessionSummary();
        return {
          success: result.success,
          summary: result.summary,
          error: result.error,
        };
      });

      // Track whether an ask_coding_agent call is in-flight so the
      // completion listener doesn't also fire an [INTERNAL] notification
      // for the same response (which would cause the voice agent to say
      // "I finished that task" instead of summarizing the answer).
      let askCodingAgentInFlight = false;

      poc.setOnAskCodingAgent(async (question: string) => {
        // Send the question to the coding agent via the existing prompt system
        // The [VOICE] prefix signals this is from the voice assistant
        // The system prompt (via isVoiceMode in documentContext) provides full context
        const questionPrompt = `[VOICE] ${question}`;
        const targetSessionId = currentSessionId();

        console.log('[VoiceModeService] ask_coding_agent called with question:', question, 'target:', targetSessionId);
        askCodingAgentInFlight = true;

        try {
          if (window && !window.isDestroyed()) {
            // Create a promise that resolves when the agent responds
            return new Promise((resolve) => {
              let timeoutId: NodeJS.Timeout | null = null;

              // Set up a one-time listener for the response via ipcMain
              // This listens for the same event that submit_agent_prompt uses
              const responseHandler = (_event: any, data: { sessionId: string; summary: string }) => {
                if (data.sessionId === targetSessionId) {
                  // Clean up
                  ipcMain.removeListener('voice-mode:agent-task-complete', responseHandler);
                  if (timeoutId) clearTimeout(timeoutId);
                  askCodingAgentInFlight = false;

                  // Log what we received
                  console.log('[VoiceModeService] ask_coding_agent received response:', {
                    summaryLength: data.summary?.length,
                    summaryPreview: data.summary?.substring(0, 500),
                  });

                  // Truncate the answer for the voice context window.
                  // gpt-realtime struggles with very long function results.
                  const answer = data.summary || 'I was unable to find an answer.';
                  const truncatedAnswer = answer.length > 2000
                    ? answer.substring(0, 2000) + '... (truncated)'
                    : answer;

                  resolve({
                    success: true,
                    answer: truncatedAnswer,
                  });
                }
              };

              // Listen for the response
              ipcMain.on('voice-mode:agent-task-complete', responseHandler);

              // Send the question to the renderer to queue
              window.webContents.send('voice-mode:submit-prompt', {
                sessionId: targetSessionId,
                workspacePath,
                prompt: questionPrompt,
              });

              // Timeout after 60 seconds
              timeoutId = setTimeout(() => {
                ipcMain.removeListener('voice-mode:agent-task-complete', responseHandler);
                askCodingAgentInFlight = false;
                resolve({
                  success: false,
                  error: 'Question timed out waiting for response',
                });
              }, 60000);
            });
          } else {
            askCodingAgentInFlight = false;
            return { success: false, error: 'Window not available' };
          }
        } catch (error) {
          askCodingAgentInFlight = false;
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
      // and can notify the voice assistant.
      // IMPORTANT: Skip this when ask_coding_agent is in-flight because
      // that path returns the response via the function call result instead.
      const completionListener = (_event: any, data: { sessionId: string; summary?: string }) => {
        if (data.sessionId === currentSessionId()) {
          // Don't send [INTERNAL] notification when ask_coding_agent is handling
          // this response -- the answer goes back via the function call result.
          if (askCodingAgentInFlight) {
            return;
          }

          // Build a concise completion notification from the coding agent's response
          let completionMessage: string;

          if (data.summary) {
            const summaryLines = data.summary.split('\n').filter(line => line.trim());
            const firstLine = summaryLines[0] || '';

            if (firstLine.length < 200 && firstLine.length > 0) {
              completionMessage = `[INTERNAL: Task complete. Result: ${firstLine}]`;
            } else {
              completionMessage = '[INTERNAL: Task complete.]';
            }
          } else {
            completionMessage = '[INTERNAL: Task complete.]';
          }

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

      let tokenUsage: { inputAudio: number; outputAudio: number; text: number; total: number } | undefined;

      // Only disconnect if this is the active session
      if (activeVoiceSession && activeVoiceSession.sessionId === sessionId) {
        // Track session ended before cleanup
        sendSessionEndedEvent('user_stopped', activeVoiceSession.startTime);

        // Get final token usage before disconnect
        tokenUsage = activeVoiceSession.poc.getTokenUsage();

        activeVoiceSession.poc.disconnect();
        // Clean up the completion listener
        activeVoiceSession.cleanupCompletionListener();
        activeVoiceSession = null;
      }

      return {
        success: true,
        message: 'Disconnected',
        tokenUsage,
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

  /**
   * Generate a voice-friendly project summary using Claude
   * Stores the result in nimbalyst-local/voice-project-summary.md
   */
  safeHandle('voice-mode:generate-project-summary', async (event, workspacePath: string) => {
    try {
      if (!workspacePath) {
        return { success: false, message: 'Workspace path is required' };
      }

      const fs = await import('fs/promises');
      const path = await import('path');

      // Get Anthropic API key
      const apiKeys = settingsStore.get('apiKeys') as Record<string, string> | undefined;
      const apiKey = apiKeys?.anthropic;

      if (!apiKey) {
        return { success: false, message: 'Anthropic API key not configured' };
      }

      // Read relevant project files for context
      const contextFiles: { name: string; content: string }[] = [];

      // Try to read CLAUDE.md
      try {
        const claudeMd = await fs.readFile(path.join(workspacePath, 'CLAUDE.md'), 'utf-8');
        contextFiles.push({ name: 'CLAUDE.md', content: claudeMd.slice(0, 15000) }); // Limit size
      } catch { /* ignore */ }

      // Try to read README.md
      try {
        const readme = await fs.readFile(path.join(workspacePath, 'README.md'), 'utf-8');
        contextFiles.push({ name: 'README.md', content: readme.slice(0, 8000) });
      } catch { /* ignore */ }

      // Try to read package.json
      try {
        const pkgJson = await fs.readFile(path.join(workspacePath, 'package.json'), 'utf-8');
        contextFiles.push({ name: 'package.json', content: pkgJson });
      } catch { /* ignore */ }

      if (contextFiles.length === 0) {
        return { success: false, message: 'No project files found (CLAUDE.md, README.md, or package.json)' };
      }

      // Build the prompt
      const prompt = `You are generating a concise project summary for a voice assistant that helps developers with this codebase. The voice assistant needs a quick overview it can reference during conversations.

Based on the following project files, generate a voice-friendly summary (400-600 words) that covers:
1. What the project is and what it does (1-2 sentences)
2. Key technologies and frameworks used
3. Main directory/package structure (if it's a monorepo)
4. Important conventions or patterns to be aware of
5. Current focus areas or notable features

Keep it conversational and scannable - this will be read by an AI, not displayed to humans. Avoid code blocks, bullet points with symbols, and overly technical jargon. Use natural sentences.

${contextFiles.map(f => `--- ${f.name} ---\n${f.content}`).join('\n\n')}

Generate the summary now:`;

      // Call Anthropic API directly
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1024,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, message: `API error: ${response.status} - ${errorText}` };
      }

      const result = await response.json() as { content: Array<{ type: string; text?: string }> };
      const summary = result.content.find(c => c.type === 'text')?.text;

      if (!summary) {
        return { success: false, message: 'No summary generated' };
      }

      // Ensure nimbalyst-local directory exists
      const nimbalystLocalDir = path.join(workspacePath, 'nimbalyst-local');
      await fs.mkdir(nimbalystLocalDir, { recursive: true });

      // Write the summary
      const summaryPath = path.join(nimbalystLocalDir, 'voice-project-summary.md');
      await fs.writeFile(summaryPath, summary.trim(), 'utf-8');

      console.log('[VoiceModeService] Generated project summary:', summaryPath);

      return {
        success: true,
        message: 'Project summary generated',
        path: summaryPath,
        summary: summary.trim(),
      };
    } catch (error) {
      console.error('[VoiceModeService] Failed to generate project summary:', error);
      return {
        success: false,
        message: `Failed to generate summary: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  });

  /**
   * Find the most recent voice session for a workspace, if it was updated
   * within the timeout window. Used to resume an existing voice session
   * rather than creating a new one every time the button is pressed.
   */
  safeHandle('voice-mode:findRecentSession', async (_event, data: {
    workspacePath: string;
    timeoutMs: number;
  }) => {
    try {
      const { database } = await import('../../database/PGLiteDatabaseWorker');
      const result = await database.query(
        `SELECT id, updated_at FROM ai_sessions
         WHERE workspace_id = $1
           AND session_type = 'voice'
           AND updated_at > NOW() - INTERVAL '1 millisecond' * $2
         ORDER BY updated_at DESC
         LIMIT 1`,
        [data.workspacePath, data.timeoutMs]
      );
      if (result.rows.length > 0) {
        return { found: true, sessionId: result.rows[0].id };
      }
      return { found: false };
    } catch (error) {
      console.error('[VoiceModeService] Failed to find recent voice session:', error);
      return { found: false };
    }
  });

  /**
   * Create a voice session row in ai_sessions.
   * Called immediately when voice activates so the session is visible right away.
   */
  safeHandle('voice-mode:createSession', async (_event, data: {
    id: string;
    workspacePath: string;
    linkedSessionId: string;
  }) => {
    try {
      const { database } = await import('../../database/PGLiteDatabaseWorker');
      await database.query(
        `INSERT INTO ai_sessions (id, workspace_id, provider, title, session_type, metadata, created_at, updated_at)
         VALUES ($1, $2, 'openai-realtime', 'Voice Session', 'voice', $3, NOW(), NOW())
         ON CONFLICT (id) DO NOTHING`,
        [
          data.id,
          data.workspacePath,
          JSON.stringify({ linkedSessionId: data.linkedSessionId }),
        ]
      );
      return { success: true };
    } catch (error) {
      console.error('[VoiceModeService] Failed to create voice session:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  /**
   * Resume an existing voice session by touching its updated_at and
   * updating the linked coding session ID in metadata.
   */
  safeHandle('voice-mode:resumeSession', async (_event, data: {
    sessionId: string;
    linkedSessionId: string;
  }) => {
    try {
      const { database } = await import('../../database/PGLiteDatabaseWorker');
      await database.query(
        `UPDATE ai_sessions
         SET updated_at = NOW(),
             metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
         WHERE id = $1`,
        [
          data.sessionId,
          JSON.stringify({ linkedSessionId: data.linkedSessionId }),
        ]
      );
      return { success: true };
    } catch (error) {
      console.error('[VoiceModeService] Failed to resume voice session:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  /**
   * Append a single transcript message to a voice session.
   * Called incrementally as user speaks and assistant responds.
   */
  safeHandle('voice-mode:appendMessage', async (_event, data: {
    sessionId: string;
    direction: 'input' | 'output';
    content: string;
    entryId: string;
    timestamp: number;
  }) => {
    try {
      const { database } = await import('../../database/PGLiteDatabaseWorker');
      await database.query(
        `INSERT INTO ai_agent_messages (session_id, source, direction, content, metadata, created_at)
         VALUES ($1, 'voice', $2, $3, $4, $5)`,
        [
          data.sessionId,
          data.direction,
          data.content,
          JSON.stringify({ voiceEntryId: data.entryId }),
          new Date(data.timestamp).toISOString(),
        ]
      );
      // Touch updated_at on the session
      await database.query(
        `UPDATE ai_sessions SET updated_at = NOW() WHERE id = $1`,
        [data.sessionId]
      );
      return { success: true };
    } catch (error) {
      console.error('[VoiceModeService] Failed to append voice message:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  /**
   * Update voice session metadata (token usage, duration) on stop.
   */
  safeHandle('voice-mode:updateSessionMetadata', async (_event, data: {
    sessionId: string;
    tokenUsage: unknown;
    durationMs: number;
  }) => {
    try {
      const { database } = await import('../../database/PGLiteDatabaseWorker');
      // Merge token usage and duration into existing metadata
      await database.query(
        `UPDATE ai_sessions
         SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
             updated_at = NOW()
         WHERE id = $1`,
        [
          data.sessionId,
          JSON.stringify({
            tokenUsage: data.tokenUsage,
            durationMs: data.durationMs,
          }),
        ]
      );
      return { success: true };
    } catch (error) {
      console.error('[VoiceModeService] Failed to update voice session metadata:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  /**
   * Update the linked AI session for the active voice session.
   * Called when the user switches to a different coding session while voice is active.
   * This ensures voice agent commands (submit-prompt, ask_coding_agent) target the correct session.
   */
  ipcMain.on('voice-mode:update-linked-session', (_event, data: {
    newSessionId: string;
    sessionName?: string;
  }) => {
    if (!activeVoiceSession) return;
    const oldSessionId = activeVoiceSession.sessionId;
    if (oldSessionId === data.newSessionId) return;

    activeVoiceSession.sessionId = data.newSessionId;
    const name = data.sessionName || 'Untitled';
    console.log(`[VoiceModeService] Updated linked session -> "${name}"`);

    // Notify the voice agent so it knows commands now target a different session
    if (activeVoiceSession.poc.isConnected()) {
      activeVoiceSession.poc.injectContext(
        `[INTERNAL: User switched to a different coding session called "${name}". Your commands now target this session.]`
      );
    }
  });

  /**
   * Listen state changed -- renderer notifies when voice goes to sleep or wakes up.
   * Used to suspend/resume the inactivity disconnect timer.
   */
  ipcMain.on('voice-mode:listen-state-changed', (_event, data: { sleeping: boolean }) => {
    if (!activeVoiceSession) return;
    activeVoiceSession.poc.setListeningPaused(data.sleeping);
  });

  /**
   * Editor context changed -- user switched to a different file.
   * Notify the active voice agent so it knows what document the user is viewing.
   */
  ipcMain.on('voice-mode:editor-context-changed', (_event, data: {
    sessionId: string;
    filePath: string | null;
  }) => {
    if (!activeVoiceSession || activeVoiceSession.sessionId !== data.sessionId) return;
    if (!activeVoiceSession.poc.isConnected()) return;

    if (data.filePath) {
      // Extract just the filename for the voice agent (full paths are noisy for speech)
      const fileName = data.filePath.split('/').pop() || data.filePath;
      activeVoiceSession.poc.injectContext(
        `[INTERNAL: User is now viewing ${fileName}]`
      );
    }
  });

  console.log('[VoiceModeService] Test handlers initialized');
}
