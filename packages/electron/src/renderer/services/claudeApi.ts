import { detectStreamingIntent, parseStreamingChunk, StreamingEditRequest } from './claudeStreamProtocol';
import { logger } from '../utils/logger';

interface DocumentContext {
  filePath: string;
  fileType: string;
  content: string;
  cursorPosition?: { line: number; column: number };
  selection?: { start: { line: number; column: number }; end: { line: number; column: number } };
}

interface EditRequest {
  type: 'edit' | 'insert' | 'delete' | 'replace' | 'stream';
  file: string;
  range: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
  content: string;
  preview: boolean;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  edits?: EditRequest[];
}

interface Session {
  id: string;
  timestamp: number;
  messages: Message[];
  documentContext?: DocumentContext;
  provider?: 'claude' | 'claude-code';
  providerConfig?: any;
}

class ClaudeAPI {
  private listeners: Map<string, Set<Function>> = new Map();
  private isStreamingEdit: boolean = false;
  private streamingConfig: any = null;
  private accumulatedContent: string = '';
  private streamStartDetected: boolean = false;
  private streamBuffer: string = ''; // Buffer for detecting split markers
  private defaultProvider: 'claude' | 'claude-code' = 'claude-code';

  constructor() {
    // Set up IPC listener for errors (both legacy and new)
    window.electronAPI.onClaudeError((error: any) => {
      console.error('Claude API Error:', error);
      console.error('Error details:', {
        message: error.message,
        type: error.type,
        stack: error.stack
      });
      
      // Emit error event so UI can handle it
      this.emit('error', error);
    });
    
    // Also listen for new AI error events
    window.electronAPI.onAIError((error: any) => {
      console.error('AI API Error:', error);
      console.error('Error details:', {
        message: error.message,
        type: error.type,
        stack: error.stack
      });
      
      // Emit error event so UI can handle it
      this.emit('error', error);
    });
    
    // Set up IPC listeners for streaming edit events from AI service
    window.electronAPI.onAIStreamEditStart((config: any) => {
      logger.log('streaming', '🚀 Stream edit started from AI service:', config);
      this.emit('streamEditStart', config);
    });

    window.electronAPI.onAIStreamEditContent((content: string) => {
      logger.log('streaming', 'Stream edit content from AI service:', content.substring(0, 50));
      this.emit('streamEditContent', content);
    });

    window.electronAPI.onAIStreamEditEnd((data: any) => {
      logger.log('streaming', '🏁 Stream edit ended from AI service:', data);
      this.emit('streamEditEnd', data);
    });

    // Set up IPC listeners for streaming responses (both legacy and new)
    const handleStreamResponse = (data: any) => {
      logger.log('api', 'Received stream response:', {
        hasPartial: !!data.partial,
        partialLength: data.partial?.length,
        isComplete: data.isComplete,
        preview: data.partial?.substring(0, 100)
      });
      
      // Accumulate content to check for streaming markers
      if (data.partial) {
        this.accumulatedContent += data.partial;
      }
      
      // Check if this is a streaming edit response
      if (!this.isStreamingEdit && !this.streamStartDetected) {
        // Check accumulated content for streaming marker
        const { isStreaming, streamConfig, cleanContent } = detectStreamingIntent(this.accumulatedContent);
        logger.log('api', 'Stream detection on accumulated content:', {
          isStreaming,
          streamConfig,
          accumulatedLength: this.accumulatedContent.length,
          hasStreamMarker: this.accumulatedContent.includes('STREAM_EDIT')
        });
        
        if (isStreaming) {
          logger.log('streaming', '🚀 STREAMING MODE ACTIVATED', streamConfig);
          this.isStreamingEdit = true;
          this.streamStartDetected = true;
          this.streamingConfig = streamConfig;
          
          // Clear accumulated content and keep only clean content
          this.accumulatedContent = cleanContent;
          
          // Emit streaming edit start event
          logger.log('streaming', 'Emitting streamEditStart event with config:', streamConfig);
          this.emit('streamEditStart', streamConfig);
          
          // If there's content after the marker, process it
          // Add a small delay to allow React state to update
          if (cleanContent) {
            setTimeout(() => {
              if (!this.isStreamingEdit) {
                logger.log('streaming', 'Streaming was cancelled, not emitting initial content');
                return;
              }
              
              // Check if we have the end marker already
              if (cleanContent.includes('<!-- STREAM_END -->')) {
                const contentBeforeEnd = cleanContent.split('<!-- STREAM_END -->')[0];
                logger.log('streaming', 'Found complete stream in one chunk');
                this.emit('streamEditContent', contentBeforeEnd);
                this.emit('streamEditEnd', {});
                this.isStreamingEdit = false;
                this.streamingConfig = null;
                this.accumulatedContent = '';
                this.streamStartDetected = false;
              } else {
                logger.log('streaming', 'Emitting initial clean content after delay:', cleanContent.substring(0, 100));
                this.emit('streamEditContent', cleanContent);
                this.accumulatedContent = ''; // Clear for next chunks
              }
            }, 100); // 100ms delay to ensure React state updates
          }
          return;
        }
      }
      
      // If we're in streaming edit mode, handle the content
      if (this.isStreamingEdit && data.partial) {
        // Add to buffer to check for split markers
        this.streamBuffer += data.partial;
        
        // Check if we have a complete end marker
        if (this.streamBuffer.includes('<!-- STREAM_END -->')) {
          // Extract content before the end marker
          const endIndex = this.streamBuffer.indexOf('<!-- STREAM_END -->');
          const contentToStream = this.streamBuffer.substring(0, endIndex);
          
          // Only emit if there's actual content
          if (contentToStream.trim()) {
            logger.log('streaming', 'Final content before end:', contentToStream.substring(0, 100));
            this.emit('streamEditContent', contentToStream);
          }
          
          logger.log('streaming', '🏁 STREAMING MODE ENDED');
          this.emit('streamEditEnd', {});
          this.isStreamingEdit = false;
          this.streamingConfig = null;
          this.accumulatedContent = '';
          this.streamStartDetected = false;
          this.streamBuffer = '';
        } else {
          // Check if buffer ends with partial marker that might continue
          const partialMarkers = ['<!--', '<!-- S', '<!-- ST', '<!-- STR', '<!-- STRE', '<!-- STREA', '<!-- STREAM', '<!-- STREAM_', '<!-- STREAM_E', '<!-- STREAM_EN', '<!-- STREAM_END'];
          let hasPartialMarker = false;
          
          for (const marker of partialMarkers) {
            if (this.streamBuffer.endsWith(marker)) {
              hasPartialMarker = true;
              break;
            }
          }
          
          // If no partial marker at the end, emit accumulated content and clear buffer
          if (!hasPartialMarker && this.streamBuffer.length > 0) {
            logger.log('streaming', 'Streaming content chunk:', this.streamBuffer.substring(0, 50));
            this.emit('streamEditContent', this.streamBuffer);
            this.streamBuffer = '';
          }
          // Otherwise keep accumulating until we have a complete marker or no partial
        }
        return;
      }
      
      // Reset accumulated content when message is complete
      if (data.isComplete) {
        // If we were still in streaming mode, end it with error
        if (this.isStreamingEdit) {
          logger.log('streaming', '⚠️ Stream ended unexpectedly without STREAM_END marker');
          
          // Emit any remaining buffer content
          if (this.streamBuffer.trim()) {
            this.emit('streamEditContent', this.streamBuffer);
          }
          
          this.emit('streamEditEnd', { error: 'Stream ended without proper closing marker' });
          this.isStreamingEdit = false;
          this.streamingConfig = null;
          this.streamBuffer = '';
        }
        
        this.accumulatedContent = '';
        this.streamStartDetected = false;
      }
      
      // Normal streaming response
      logger.log('api', 'Normal (non-streaming) response');
      this.emit('streamResponse', data);
    };

    // Listen for both legacy and new stream response events
    window.electronAPI.onClaudeStreamResponse(handleStreamResponse);
    window.electronAPI.onAIStreamResponse(handleStreamResponse);

    // Listen for edit requests
    window.electronAPI.onClaudeEditRequest((edit: EditRequest) => {
      this.emit('editRequest', edit);
    });
    
    // Listen for new AI applyDiff events
    window.electronAPI.onAIApplyDiff(async (data: { replacements: any[], resultChannel: string }) => {
      try {
        // Try to access the bridge if it's available on the window
        const aiChatBridge = (window as any).aiChatBridge;
        
        if (aiChatBridge) {
          const result = await aiChatBridge.applyReplacements(data.replacements);
          // Send result back through the result channel
          window.electronAPI.sendMcpApplyDiffResult(data.resultChannel, result);
        } else {
          // No bridge available, send error
          window.electronAPI.sendMcpApplyDiffResult(data.resultChannel, {
            success: false,
            error: 'Editor bridge not available'
          });
        }
      } catch (error) {
        console.error('Failed to apply diff:', error);
        window.electronAPI.sendMcpApplyDiffResult(data.resultChannel, {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to apply diff'
        });
      }
    });
  }

  // Provider management
  setDefaultProvider(provider: 'claude' | 'claude-code') {
    this.defaultProvider = provider;
  }

  getDefaultProvider(): 'claude' | 'claude-code' {
    return this.defaultProvider;
  }

  // Initialize with optional provider selection
  async initialize(apiKey?: string, provider?: 'claude' | 'claude-code'): Promise<{ success: boolean }> {
    // Use new AI initialize for specific provider, or legacy for backward compat
    if (provider) {
      return window.electronAPI.aiInitialize(provider, apiKey);
    }
    return window.electronAPI.claudeInitialize(apiKey);
  }

  // Create session with provider selection
  async createSession(documentContext?: DocumentContext, projectPath?: string, provider?: 'claude' | 'claude-code'): Promise<Session> {
    // Use new AI method if provider specified, otherwise use legacy
    if (provider) {
      return window.electronAPI.aiCreateSession(provider, documentContext, projectPath);
    }
    return window.electronAPI.claudeCreateSession(documentContext, projectPath);
  }

  // New method specifically for creating session with provider
  async createSessionWithProvider(
    provider: 'claude' | 'claude-code',
    documentContext?: DocumentContext,
    projectPath?: string
  ): Promise<Session> {
    return window.electronAPI.aiCreateSession(provider, documentContext, projectPath);
  }

  async sendMessage(
    message: string, 
    documentContext?: DocumentContext,
    sessionId?: string,
    projectPath?: string
  ): Promise<{ content: string; edits: EditRequest[] }> {
    return window.electronAPI.claudeSendMessage(message, documentContext, sessionId, projectPath);
  }

  async getSessions(projectPath?: string): Promise<Session[]> {
    return window.electronAPI.claudeGetSessions(projectPath);
  }

  async loadSession(sessionId: string, projectPath?: string): Promise<Session> {
    return window.electronAPI.claudeLoadSession(sessionId, projectPath);
  }

  async clearSession(): Promise<{ success: boolean }> {
    return window.electronAPI.claudeClearSession();
  }
  
  async updateSessionMessages(sessionId: string, messages: any[], projectPath?: string): Promise<{ success: boolean; error?: string }> {
    return window.electronAPI.claudeUpdateSessionMessages(sessionId, messages, projectPath);
  }
  
  async saveDraftInput(sessionId: string, draftInput: string, projectPath?: string): Promise<{ success: boolean; error?: string }> {
    return window.electronAPI.claudeSaveDraftInput(sessionId, draftInput, projectPath);
  }

  async deleteSession(sessionId: string, projectPath?: string): Promise<{ success: boolean }> {
    return window.electronAPI.claudeDeleteSession(sessionId, projectPath);
  }

  async applyEdit(edit: EditRequest): Promise<{ success: boolean; error?: string }> {
    // Check if we have access to the AI chat bridge (only available when editor is loaded)
    try {
      // Try to access the bridge if it's available on the window
      const aiChatBridge = (window as any).aiChatBridge;
      
      // If this is a diff edit with replacements and bridge is available, use it
      if (aiChatBridge && edit.type === 'diff' && 'replacements' in edit) {
        const result = await aiChatBridge.applyReplacements((edit as any).replacements);
        return result;
      }
      
      // For other edit types or if bridge not available, use the IPC method
      const result = await window.electronAPI.claudeApplyEdit(edit);
      return { success: result.success, error: result.success ? undefined : 'Failed to apply edit' };
    } catch (error) {
      console.error('Failed to apply edit:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to apply edit' 
      };
    }
  }

  // Event handling
  on(event: string, callback: Function) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }

  off(event: string, callback: Function) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.delete(callback);
    }
  }

  private emit(event: string, data: any) {
    const callbacks = this.listeners.get(event);
    logger.log('api', `Emitting event '${event}' with ${callbacks?.size || 0} listeners`, data);
    if (callbacks) {
      callbacks.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`[ClaudeAPI] Error in event handler for '${event}':`, error);
        }
      });
    }
  }

  // Settings management
  async getSettings(): Promise<{
    defaultProvider: 'claude' | 'claude-code';
    apiKeys: Record<string, string>;
    providerSettings: any;
  }> {
    return window.electronAPI.getAISettings();
  }

  async saveSettings(settings: {
    defaultProvider?: 'claude' | 'claude-code';
    apiKeys?: Record<string, string>;
    providerSettings?: any;
  }): Promise<{ success: boolean }> {
    return window.electronAPI.saveAISettings(settings);
  }

  // Test connection for a specific provider
  async testConnection(provider: 'claude' | 'claude-code'): Promise<{ success: boolean; error?: string }> {
    return window.electronAPI.testAIConnection(provider);
  }

  // Get available models
  async getModels(): Promise<{ success: boolean; models?: any[] }> {
    return window.electronAPI.getAIModels();
  }
}

export const claudeApi = new ClaudeAPI();
export type { DocumentContext, EditRequest, Message, Session };