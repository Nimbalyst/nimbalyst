import React from 'react';
import './ApiKeyDialog.css';

interface ApiKeyDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenPreferences: () => void;
}

export function ApiKeyDialog({ isOpen, onClose, onOpenPreferences }: ApiKeyDialogProps) {
  if (!isOpen) return null;

  const handleOpenPreferences = () => {
    onClose();
    onOpenPreferences();
  };

  return (
    <div className="api-key-dialog-overlay" onClick={onClose}>
      <div className="api-key-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="api-key-dialog-header">
          <h2>API Key Required</h2>
          <button className="api-key-dialog-close" onClick={onClose}>×</button>
        </div>
        
        <div className="api-key-dialog-content">
          <div className="api-key-dialog-icon">🔑</div>
          
          <p className="api-key-dialog-message">
            To use the AI chat features, you need to configure your Anthropic API key.
          </p>
          
          <div className="api-key-dialog-steps">
            <h3>How to get started:</h3>
            <ol>
              <li>Get your API key from <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer">console.anthropic.com</a></li>
              <li>Click "Open Preferences" below</li>
              <li>Go to the AI Settings tab</li>
              <li>Enter your API key and save</li>
            </ol>
          </div>
        </div>
        
        <div className="api-key-dialog-footer">
          <button className="api-key-dialog-button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="api-key-dialog-button primary" onClick={handleOpenPreferences}>
            Open Preferences
          </button>
        </div>
      </div>
    </div>
  );
}