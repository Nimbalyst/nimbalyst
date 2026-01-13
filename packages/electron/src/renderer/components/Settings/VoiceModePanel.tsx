/**
 * Voice Mode Settings Panel
 */

import React from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';

interface SystemPromptConfig {
  prepend?: string;
  append?: string;
}

interface VoiceModePanelProps {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  voice: 'marin' | 'cedar';
  onVoiceChange: (voice: 'marin' | 'cedar') => void;
  showTranscription: boolean;
  onShowTranscriptionChange: (show: boolean) => void;
  hasOpenAIKey: boolean;
  voiceAgentPrompt?: SystemPromptConfig;
  onVoiceAgentPromptChange?: (config: SystemPromptConfig) => void;
  codingAgentPrompt?: SystemPromptConfig;
  onCodingAgentPromptChange?: (config: SystemPromptConfig) => void;
}

export const VoiceModePanel: React.FC<VoiceModePanelProps> = ({
  enabled,
  onEnabledChange,
  voice,
  onVoiceChange,
  showTranscription,
  onShowTranscriptionChange,
  hasOpenAIKey,
  voiceAgentPrompt,
  onVoiceAgentPromptChange,
  codingAgentPrompt,
  onCodingAgentPromptChange,
}) => {
  const [showVoiceAgentPrompt, setShowVoiceAgentPrompt] = React.useState(false);
  const [showCodingAgentPrompt, setShowCodingAgentPrompt] = React.useState(false);
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
            <MaterialSymbol icon="warning" size={16} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
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

          <div className="provider-panel-section">
            <h4 className="provider-panel-section-title">System Prompt Customization</h4>
            <p className="provider-panel-hint" style={{ marginBottom: '16px' }}>
              Customize the behavior of the voice agent and coding agent during voice mode sessions.
            </p>

            {/* Voice Agent Prompt Section */}
            <button
              onClick={() => setShowVoiceAgentPrompt(!showVoiceAgentPrompt)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                background: 'none',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                color: 'var(--text-primary)',
                fontSize: '14px',
                fontWeight: 500,
                marginBottom: showVoiceAgentPrompt ? '12px' : '16px',
              }}
            >
              <MaterialSymbol icon={showVoiceAgentPrompt ? 'expand_less' : 'expand_more'} size={20} />
              Voice Agent Instructions
            </button>

            {showVoiceAgentPrompt && onVoiceAgentPromptChange && (
              <div style={{ marginBottom: '24px', paddingLeft: '28px' }}>
                <p className="provider-panel-hint" style={{ marginBottom: '12px' }}>
                  Customize the voice assistant (GPT-4 Realtime) that handles speech interaction.
                </p>

                <div className="setting-item" style={{ marginBottom: '16px' }}>
                  <div className="setting-text">
                    <span className="setting-name">Prepend to Instructions</span>
                    <span className="setting-description">
                      Added before the default voice assistant instructions
                    </span>
                  </div>
                  <textarea
                    value={voiceAgentPrompt?.prepend || ''}
                    onChange={(e) => onVoiceAgentPromptChange({
                      ...voiceAgentPrompt,
                      prepend: e.target.value,
                    })}
                    placeholder="e.g., Always respond in a formal tone..."
                    style={{
                      marginTop: '8px',
                      width: '100%',
                      minHeight: '80px',
                      padding: '8px 12px',
                      borderRadius: '4px',
                      border: '1px solid var(--border-primary)',
                      backgroundColor: 'var(--surface-secondary)',
                      color: 'var(--text-primary)',
                      fontFamily: 'inherit',
                      fontSize: '13px',
                      resize: 'vertical',
                    }}
                  />
                </div>

                <div className="setting-item">
                  <div className="setting-text">
                    <span className="setting-name">Append to Instructions</span>
                    <span className="setting-description">
                      Added after the default voice assistant instructions
                    </span>
                  </div>
                  <textarea
                    value={voiceAgentPrompt?.append || ''}
                    onChange={(e) => onVoiceAgentPromptChange({
                      ...voiceAgentPrompt,
                      append: e.target.value,
                    })}
                    placeholder="e.g., When discussing code, always mention file names..."
                    style={{
                      marginTop: '8px',
                      width: '100%',
                      minHeight: '80px',
                      padding: '8px 12px',
                      borderRadius: '4px',
                      border: '1px solid var(--border-primary)',
                      backgroundColor: 'var(--surface-secondary)',
                      color: 'var(--text-primary)',
                      fontFamily: 'inherit',
                      fontSize: '13px',
                      resize: 'vertical',
                    }}
                  />
                </div>
              </div>
            )}

            {/* Coding Agent Prompt Section */}
            <button
              onClick={() => setShowCodingAgentPrompt(!showCodingAgentPrompt)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                background: 'none',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                color: 'var(--text-primary)',
                fontSize: '14px',
                fontWeight: 500,
                marginBottom: showCodingAgentPrompt ? '12px' : '0',
              }}
            >
              <MaterialSymbol icon={showCodingAgentPrompt ? 'expand_less' : 'expand_more'} size={20} />
              Coding Agent Instructions (Voice Mode)
            </button>

            {showCodingAgentPrompt && onCodingAgentPromptChange && (
              <div style={{ paddingLeft: '28px' }}>
                <p className="provider-panel-hint" style={{ marginBottom: '12px' }}>
                  Customize the coding agent (Claude) when processing voice mode requests.
                  These instructions are added to the system prompt only during voice mode sessions.
                </p>

                <div className="setting-item" style={{ marginBottom: '16px' }}>
                  <div className="setting-text">
                    <span className="setting-name">Prepend to Instructions</span>
                    <span className="setting-description">
                      Added before the coding agent's voice mode context
                    </span>
                  </div>
                  <textarea
                    value={codingAgentPrompt?.prepend || ''}
                    onChange={(e) => onCodingAgentPromptChange({
                      ...codingAgentPrompt,
                      prepend: e.target.value,
                    })}
                    placeholder="e.g., When responding to voice requests, prioritize brevity..."
                    style={{
                      marginTop: '8px',
                      width: '100%',
                      minHeight: '80px',
                      padding: '8px 12px',
                      borderRadius: '4px',
                      border: '1px solid var(--border-primary)',
                      backgroundColor: 'var(--surface-secondary)',
                      color: 'var(--text-primary)',
                      fontFamily: 'inherit',
                      fontSize: '13px',
                      resize: 'vertical',
                    }}
                  />
                </div>

                <div className="setting-item">
                  <div className="setting-text">
                    <span className="setting-name">Append to Instructions</span>
                    <span className="setting-description">
                      Added after the coding agent's voice mode context
                    </span>
                  </div>
                  <textarea
                    value={codingAgentPrompt?.append || ''}
                    onChange={(e) => onCodingAgentPromptChange({
                      ...codingAgentPrompt,
                      append: e.target.value,
                    })}
                    placeholder="e.g., Always summarize what you did in 1-2 sentences at the end..."
                    style={{
                      marginTop: '8px',
                      width: '100%',
                      minHeight: '80px',
                      padding: '8px 12px',
                      borderRadius: '4px',
                      border: '1px solid var(--border-primary)',
                      backgroundColor: 'var(--surface-secondary)',
                      color: 'var(--text-primary)',
                      fontFamily: 'inherit',
                      fontSize: '13px',
                      resize: 'vertical',
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
