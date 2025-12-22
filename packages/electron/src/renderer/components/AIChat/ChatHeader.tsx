import React from 'react';
import { MaterialSymbol, getProviderIcon, ProviderIcon } from '@nimbalyst/runtime';
import { parseModelInfo } from '../../utils/modelUtils';
import { SessionDropdown } from './SessionDropdown';
import { NewSessionButton } from './NewSessionButton';
import { DiffTestDropdown } from './DiffTestDropdown';
import type { SessionData } from '@nimbalyst/runtime/ai/server/types';

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
  // Get current session's model info for display
  const getCurrentSessionModel = () => {
    if (currentSessionId) {
      const session = sessions.find(s => s.id === currentSessionId);
      if (session) {
        if (session.provider === 'claude-code') {
          return session.model || 'claude-code';
        }

        if (session.model) {
          return session.model.includes(':')
            ? session.model
            : `${session.provider}:${session.model}`;
        }

        return session.provider;
      }
    }
    return currentModel;
  };

  const displayModel = getCurrentSessionModel();
  const modelInfo = parseModelInfo(displayModel || undefined);

  // Get current session for type switching check
  const currentSession = currentSessionId
    ? sessions.find(s => s.id === currentSessionId)
    : null;

  // Check if current session has any messages
  const sessionHasMessages = (currentSession?.messages?.length ?? 0) > 0;

  // Determine provider type (agent vs model/chat)
  const getProviderType = (provider?: string): 'agent' | 'model' | null => {
    if (!provider) return null;
    return (provider === 'claude-code' || provider === 'openai-codex') ? 'agent' : 'model';
  };
  const currentProviderType = getProviderType(currentSession?.provider);

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
                    createdAt: s.createdAt,
                    name: s.name,
                    title: s.title,
                    messageCount: s.messages?.filter(m => m.role === 'user').length || 0,
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
          {/* Diff test dropdown (dev mode only) */}
          {import.meta.env.DEV && (
            <DiffTestDropdown documentContext={documentContext} />
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
          sessionHasMessages={sessionHasMessages}
          currentProviderType={currentProviderType}
        />
      </div>
    </div>
  );
}
