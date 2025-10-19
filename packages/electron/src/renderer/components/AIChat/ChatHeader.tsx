import React from 'react';
import { MaterialSymbol } from '../MaterialSymbol';
import { getProviderIcon } from '../icons/ProviderIcons';
import { ProviderIcon } from '../icons/ProviderIcons';
import { parseModelInfo } from '../../utils/modelUtils';
import { SessionDropdown } from './SessionDropdown';
import { NewSessionButton } from './NewSessionButton';
import type { SessionData } from '@nimbalyst/runtime/ai/server/types';
import { editorRegistry } from '@nimbalyst/runtime/ai/EditorRegistry';

// Using SessionData directly from runtime package

interface ChatHeaderProps {
  // Header actions
  onToggleCollapse: () => void;
  showPerformanceMetrics?: boolean;
  onTogglePerformanceMetrics?: () => void;
  onCopyChat?: () => void;

  // Session management
  currentSessionId: string | null;
  sessions: SessionData[];
  currentModel: string | null;  // Full provider:model ID
  isLoading: boolean;
  hasUnsavedInput: boolean;

  // Session actions
  onSessionSelect: (sessionId: string) => void;
  onNewSession: (modelId?: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onRenameSession?: (sessionId: string, newName: string) => void;
  onOpenSessionManager?: () => void;
  onOpenSettings?: () => void;

  // Debug
  documentContext?: { filePath?: string } | null;
}

export function ChatHeader({
  onToggleCollapse,
  showPerformanceMetrics,
  onTogglePerformanceMetrics,
  onCopyChat,
  currentSessionId,
  sessions,
  currentModel,
  isLoading,
  hasUnsavedInput,
  onSessionSelect,
  onNewSession,
  onDeleteSession,
  onRenameSession,
  onOpenSessionManager,
  onOpenSettings,
  documentContext
}: ChatHeaderProps) {

  // Debug button to test streaming validation
  const handleTestStream = () => {
    const targetPath = documentContext?.filePath;

    if (!targetPath) {
      alert('No file path available');
      return;
    }

    if (!editorRegistry.has(targetPath)) {
      alert('Editor not registered for this file');
      return;
    }

    const testId = 'test-stream-' + Date.now();
    console.error('[TEST] Starting test stream with targetFilePath:', targetPath);

    // Start streaming with target file path
    editorRegistry.startStreaming(targetPath, {
      id: testId,
      insertAtEnd: true
    });

    // Stream some content
    setTimeout(() => {
      editorRegistry.streamContent(targetPath, testId, '\n\n## Test Stream Insert\n\n');
    }, 100);

    setTimeout(() => {
      editorRegistry.streamContent(targetPath, testId, 'This is a test streaming insertion.\n\n');
    }, 200);

    setTimeout(() => {
      editorRegistry.endStreaming(targetPath, testId);
      console.error('[TEST] Test stream complete');
    }, 300);
  };

  // Debug button to test diff validation
  const handleTestDiff = async () => {
    const targetPath = documentContext?.filePath;

    if (!targetPath) {
      alert('No file path available');
      return;
    }

    if (!editorRegistry.has(targetPath)) {
      alert('Editor not registered for this file');
      return;
    }

    console.error('[TEST] Starting test diff with targetFilePath:', targetPath);

    // Create a simple diff replacement using the correct format
    const replacements = [
      {
        oldText: 'This is a test streaming insertion.',
        newText: 'This is an update of the test streaming insertion.',
        type: 'replace'
      }
    ];

    const result = await editorRegistry.applyReplacements(targetPath, replacements);
    console.error('[TEST] Test diff result:', result);
  };
  // Get current session's model info for display
  const getCurrentSessionModel = () => {
    if (currentSessionId) {
      const session = sessions.find(s => s.id === currentSessionId);
      if (session) {
        // Format as provider:model or just provider for claude-code
        return session.provider === 'claude-code'
          ? 'claude-code'
          : `${session.provider}:${session.model}`;
      }
    }
    return currentModel;
  };

  const displayModel = getCurrentSessionModel();
  const modelInfo = parseModelInfo(displayModel || undefined);

  // Get provider class name for styling
  const getProviderClass = (providerId?: string) => {
    if (!providerId) return '';
    return `model-tag-${providerId}`;
  };

  return (
    <div className="ai-chat-header">
      <div className="ai-chat-header-top">
        <h3 className="ai-chat-title">
          AI Assistant









            <SessionDropdown
                currentSessionId={currentSessionId}
                sessions={sessions.map(s => ({
                    id: s.id,
                    timestamp: s.timestamp,
                    name: s.name,
                    title: s.title,
                    messageCount: s.messages?.length || 0,
                    provider: s.provider,
                    model: s.model
                }))}
                onSessionSelect={onSessionSelect}
                onNewSession={() => onNewSession()}
                onDeleteSession={onDeleteSession}
                onRenameSession={onRenameSession}
                onOpenSessionManager={onOpenSessionManager}
            />



        </h3>
        <div className="ai-chat-header-actions">
          {/* Debug buttons to test validation (dev mode only) */}
          {import.meta.env.DEV && (
            <>
              <button
                className="ai-chat-action-button"
                onClick={handleTestStream}
                title="Test Stream (Debug)"
                aria-label="Test Stream"
                style={{ backgroundColor: '#ff6b6b', color: 'white' }}
              >
                <MaterialSymbol icon="bug_report" size={18} />
              </button>
              <button
                className="ai-chat-action-button"
                onClick={handleTestDiff}
                title="Test Diff (Debug)"
                aria-label="Test Diff"
                style={{ backgroundColor: '#51cf66', color: 'white' }}
              >
                <MaterialSymbol icon="difference" size={18} />
              </button>
            </>
          )}

          {onTogglePerformanceMetrics && (
            <button
              className="ai-chat-action-button"
              onClick={onTogglePerformanceMetrics}
              title={showPerformanceMetrics ? "Hide Performance Metrics" : "Show Performance Metrics"}
              aria-label="Toggle Performance Metrics"
              style={{ opacity: showPerformanceMetrics ? 1 : 0.6 }}
            >
              <MaterialSymbol icon="speed" size={18} />
            </button>
          )}
          {/* Copy button for the chat history (needs work) */}
          {/*{onCopyChat && (*/}
          {/*  <button*/}
          {/*    className="ai-chat-action-button"*/}
          {/*    onClick={onCopyChat}*/}
          {/*    title="Copy Chat to Clipboard"*/}
          {/*    aria-label="Copy Chat"*/}
          {/*  >*/}
          {/*    <MaterialSymbol icon="content_copy" size={18} />*/}
          {/*  </button>*/}
          {/*)}*/}
          <button
            className="ai-chat-action-button"
            onClick={onToggleCollapse}
            title="Collapse (⌘⇧A)"
            aria-label="Collapse AI Assistant"
          >
            <MaterialSymbol icon="chevron_right" size={20} />
          </button>
        </div>
      </div>

      <div className="ai-chat-header-bottom">
        {/* Model tags */}
          {modelInfo && (
              <div className="ai-chat-model-tags">
              <span className={`ai-chat-provider-tag ${getProviderClass(modelInfo.providerId)}`}>
                <ProviderIcon provider={modelInfo.providerId as any} size={12} />
                  {modelInfo.providerName}
              </span>
                  <span className="ai-chat-model-tag">
                {modelInfo.modelName}
              </span>
              </div>
          )}

        <NewSessionButton
          currentModel={displayModel || ''}
          onNewSession={onNewSession}
          onOpenSettings={onOpenSettings}
          disabled={isLoading}
          hasUnsavedInput={hasUnsavedInput}
        />
      </div>
    </div>
  );
}
