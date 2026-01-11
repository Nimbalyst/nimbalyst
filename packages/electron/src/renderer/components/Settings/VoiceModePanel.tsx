/**
 * Voice Mode Settings Panel
 */

import React from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';

interface VoiceModePanelProps {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  voice: 'marin' | 'cedar';
  onVoiceChange: (voice: 'marin' | 'cedar') => void;
  showTranscription: boolean;
  onShowTranscriptionChange: (show: boolean) => void;
  hasOpenAIKey: boolean;
}

export const VoiceModePanel: React.FC<VoiceModePanelProps> = ({
  enabled,
  onEnabledChange,
  voice,
  onVoiceChange,
  showTranscription,
  onShowTranscriptionChange,
  hasOpenAIKey,
}) => {
  return (
    <div className="provider-panel">
      <div className="provider-panel-header">
        <h3 className="provider-panel-title">Voice Mode</h3>
        <p className="provider-panel-description">
          Use OpenAI's Advanced Voice Mode to control Claude Code with your voice.
          Speak naturally to give commands, and receive spoken responses.
        </p>
      </div>

      <div className="provider-panel-section">
        <h4 className="provider-panel-section-title">Enable Voice Mode</h4>

        {!hasOpenAIKey && (
          <div className="provider-panel-hint" style={{ color: 'var(--color-warning)', marginBottom: '12px' }}>
            <MaterialSymbol icon="warning" size={16} style={{ verticalAlign: 'text-bottom', marginRight: '4px' }} />
            Voice Mode requires an OpenAI API key. Please configure it in the OpenAI settings.
          </div>
        )}

        <div className="setting-item">
          <label className="setting-label">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => onEnabledChange(e.target.checked)}
              className="setting-checkbox"
              disabled={!hasOpenAIKey}
            />
            <div className="setting-text">
              <span className="setting-name">Show Voice Mode Button</span>
              <span className="setting-description">
                Display the microphone button in the AI input area
              </span>
            </div>
          </label>
        </div>
      </div>

      {enabled && hasOpenAIKey && (
        <>
          <div className="provider-panel-section">
            <h4 className="provider-panel-section-title">Voice Settings</h4>

            <div className="setting-item">
              <div className="setting-text">
                <span className="setting-name">Voice</span>
                <span className="setting-description">
                  Choose the voice for the assistant
                </span>
              </div>
              <select
                value={voice}
                onChange={(e) => onVoiceChange(e.target.value as 'marin' | 'cedar')}
                style={{
                  marginTop: '8px',
                  padding: '6px 12px',
                  borderRadius: '4px',
                  border: '1px solid var(--border-primary)',
                  backgroundColor: 'var(--surface-secondary)',
                  color: 'var(--text-primary)',
                }}
              >
                <option value="marin">Marin (Default)</option>
                <option value="cedar">Cedar</option>
              </select>
            </div>
          </div>

          <div className="provider-panel-section">
            <h4 className="provider-panel-section-title">Display Options</h4>

            <div className="setting-item">
              <label className="setting-label">
                <input
                  type="checkbox"
                  checked={showTranscription}
                  onChange={(e) => onShowTranscriptionChange(e.target.checked)}
                  className="setting-checkbox"
                />
                <div className="setting-text">
                  <span className="setting-name">Show Live Transcription</span>
                  <span className="setting-description">
                    Display real-time transcription of your speech and the assistant's responses
                  </span>
                </div>
              </label>
            </div>
          </div>

          <div className="provider-panel-section">
            <h4 className="provider-panel-section-title">Usage & Pricing</h4>
            <p className="provider-panel-hint">
              OpenAI charges for voice mode usage:
            </p>
            <ul style={{ marginLeft: '20px', marginTop: '8px', marginBottom: '8px' }}>
              <li>Audio Input: $0.06 per minute</li>
              <li>Audio Output: $0.24 per minute</li>
              <li>Plus standard token costs for processing</li>
            </ul>
            <p className="provider-panel-hint">
              Example: A 5-minute conversation costs approximately $0.50
            </p>
          </div>

          <div className="provider-panel-section">
            <h4 className="provider-panel-section-title">How It Works</h4>
            <p className="provider-panel-hint">
              Voice Mode uses OpenAI's Advanced Voice Mode (GPT Realtime) as an intelligent
              voice interface to Claude Code. You speak your coding requests naturally,
              and the voice assistant translates them into Claude Code commands.
            </p>
            <p className="provider-panel-hint" style={{ marginTop: '8px' }}>
              When Claude Code finishes working, the assistant summarizes what was done
              and speaks it back to you.
            </p>
          </div>
        </>
      )}
    </div>
  );
};
