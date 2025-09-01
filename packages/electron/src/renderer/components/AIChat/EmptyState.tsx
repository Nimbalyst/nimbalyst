import React from 'react';
import './EmptyState.css';

interface EmptyStateProps {
  onOpenSettings: () => void;
}

export function EmptyState({ onOpenSettings }: EmptyStateProps) {
  return (
    <div className="ai-chat-empty-state">
      <div className="empty-state-icon">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z"/>
          <path d="M12 11v6"/>
          <circle cx="12" cy="8" r="1"/>
        </svg>
      </div>
      
      <h3>AI Assistant Not Ready</h3>
      
      <p className="empty-state-description">
        To start using the AI assistant, you need to configure your AI provider and enable at least one model.
      </p>
      
      <div className="empty-state-steps">
        <div className="step">
          <span className="step-number">1</span>
          <span className="step-text">Choose your AI provider:
            <div style={{ marginTop: '4px', fontSize: '12px', opacity: 0.8 }}>
              • <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer">Anthropic</a> (Claude)
              • <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">OpenAI</a> (GPT-4)
              • <a href="https://lmstudio.ai" target="_blank" rel="noopener noreferrer">LM Studio</a> (Local models)
            </div>
          </span>
        </div>
        <div className="step">
          <span className="step-number">2</span>
          <span className="step-text">Get your API key (or start LM Studio locally)</span>
        </div>
        <div className="step">
          <span className="step-number">3</span>
          <span className="step-text">Add your key in AI Settings and enable models</span>
        </div>
        <div className="step">
          <span className="step-number">4</span>
          <span className="step-text">Start chatting with your AI assistant!</span>
        </div>
      </div>
      
      <button className="empty-state-button" onClick={onOpenSettings}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
        Open AI Settings
      </button>
      
      <div className="empty-state-tip">
        <strong>Tip:</strong> Claude can help you write, edit, and understand your markdown documents.
      </div>
    </div>
  );
}