import React from 'react';
import { MaterialSymbol } from '../MaterialSymbol';
import { getProviderIcon } from '../icons/ProviderIcons';
import { ProviderIcon } from '../icons/ProviderIcons';
import { parseModelInfo } from '../../utils/modelUtils';

interface ChatHeaderProps {
  onToggleCollapse: () => void;
  children?: React.ReactNode;
  provider?: string;
  model?: string;  // Full provider:model ID
  showPerformanceMetrics?: boolean;
  onTogglePerformanceMetrics?: () => void;
  onCopyChat?: () => void;
}

export function ChatHeader({ 
  onToggleCollapse, 
  children, 
  provider, 
  model,
  showPerformanceMetrics,
  onTogglePerformanceMetrics,
  onCopyChat 
}: ChatHeaderProps) {
  const modelInfo = parseModelInfo(model);

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
        </h3>
        <div className="ai-chat-header-actions">
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
          {onCopyChat && (
            <button
              className="ai-chat-action-button"
              onClick={onCopyChat}
              title="Copy Chat to Clipboard"
              aria-label="Copy Chat"
            >
              <MaterialSymbol icon="content_copy" size={18} />
            </button>
          )}
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
        {children}
      </div>
    </div>
  );
}
