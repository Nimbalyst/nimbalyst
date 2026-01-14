/**
 * Voice Mode Settings Panel
 */

import React from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';

interface SystemPromptConfig {
  prepend?: string;
  append?: string;
}

interface TurnDetectionConfig {
  mode: 'server_vad' | 'push_to_talk';
  vadThreshold?: number;
  silenceDuration?: number;
  interruptible?: boolean;
}

// Voice type - all available OpenAI Realtime voices
type VoiceId = 'alloy' | 'ash' | 'ballad' | 'coral' | 'echo' | 'sage' | 'shimmer' | 'verse' | 'marin' | 'cedar';

interface VoiceModePanelProps {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  voice: VoiceId;
  onVoiceChange: (voice: VoiceId) => void;
  showTranscription: boolean;
  onShowTranscriptionChange: (show: boolean) => void;
  turnDetection?: TurnDetectionConfig;
  onTurnDetectionChange?: (config: TurnDetectionConfig) => void;
  hasOpenAIKey: boolean;
  voiceAgentPrompt?: SystemPromptConfig;
  onVoiceAgentPromptChange?: (config: SystemPromptConfig) => void;
  codingAgentPrompt?: SystemPromptConfig;
  onCodingAgentPromptChange?: (config: SystemPromptConfig) => void;
  workspacePath?: string;
}

// Default turn detection config
const DEFAULT_TURN_DETECTION: TurnDetectionConfig = {
  mode: 'server_vad',
  vadThreshold: 0.5,
  silenceDuration: 500,
  interruptible: true,
};

// Available OpenAI Realtime API voices with descriptions
// Some voices are Realtime-only and use approximations for TTS preview
// Gender categorization based on OpenAI documentation and community observations
const VOICE_OPTIONS: Array<{
  id: string;
  name: string;
  description: string;
  gender: 'male' | 'female' | 'neutral';
  realtimeOnly?: boolean; // If true, preview uses a similar voice approximation
}> = [
  // Male voices
  { id: 'ash', name: 'Ash', description: 'Clear and confident', gender: 'male' },
  { id: 'echo', name: 'Echo', description: 'Smooth and resonant', gender: 'male' },
  { id: 'verse', name: 'Verse', description: 'Dynamic and engaging', gender: 'male', realtimeOnly: true },
  { id: 'cedar', name: 'Cedar', description: 'Deep and authoritative', gender: 'male', realtimeOnly: true },
  // Female voices
  { id: 'coral', name: 'Coral', description: 'Warm and friendly', gender: 'female' },
  { id: 'sage', name: 'Sage', description: 'Thoughtful and calm', gender: 'female' },
  { id: 'shimmer', name: 'Shimmer', description: 'Bright and cheerful', gender: 'female' },
  { id: 'ballad', name: 'Ballad', description: 'Melodic and expressive', gender: 'female', realtimeOnly: true },
  { id: 'marin', name: 'Marin', description: 'Natural and conversational', gender: 'female', realtimeOnly: true },
  // Neutral voices
  { id: 'alloy', name: 'Alloy', description: 'Balanced and versatile', gender: 'neutral' },
];

// Group voices by gender for the dropdown
const VOICE_GROUPS = [
  { label: 'Male', voices: VOICE_OPTIONS.filter(v => v.gender === 'male') },
  { label: 'Female', voices: VOICE_OPTIONS.filter(v => v.gender === 'female') },
  { label: 'Neutral', voices: VOICE_OPTIONS.filter(v => v.gender === 'neutral') },
];

export const VoiceModePanel: React.FC<VoiceModePanelProps> = ({
  enabled,
  onEnabledChange,
  voice,
  onVoiceChange,
  showTranscription,
  onShowTranscriptionChange,
  turnDetection,
  onTurnDetectionChange,
  hasOpenAIKey,
  voiceAgentPrompt,
  onVoiceAgentPromptChange,
  codingAgentPrompt,
  onCodingAgentPromptChange,
  workspacePath,
}) => {
  const [showVoiceAgentPrompt, setShowVoiceAgentPrompt] = React.useState(false);
  const [showCodingAgentPrompt, setShowCodingAgentPrompt] = React.useState(false);
  const [isPreviewPlaying, setIsPreviewPlaying] = React.useState(false);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);

  // Project summary state
  const [projectSummaryExists, setProjectSummaryExists] = React.useState<boolean | null>(null);
  const [isGeneratingSummary, setIsGeneratingSummary] = React.useState(false);
  const [summaryError, setSummaryError] = React.useState<string | null>(null);
  const [summaryPath, setSummaryPath] = React.useState<string | null>(null);

  // Check if project summary exists
  React.useEffect(() => {
    if (!workspacePath) {
      setProjectSummaryExists(null);
      return;
    }

    const checkSummary = async () => {
      try {
        const path = `${workspacePath}/nimbalyst-local/voice-project-summary.md`;
        const exists = await window.electronAPI?.invoke('file:exists', path);
        setProjectSummaryExists(exists);
        if (exists) {
          setSummaryPath(path);
        }
      } catch {
        setProjectSummaryExists(false);
      }
    };

    checkSummary();
  }, [workspacePath]);

  // Generate project summary
  const handleGenerateSummary = async () => {
    if (!workspacePath) return;

    setIsGeneratingSummary(true);
    setSummaryError(null);

    try {
      const result = await window.electronAPI?.invoke('voice-mode:generate-project-summary', workspacePath);
      if (result?.success) {
        setProjectSummaryExists(true);
        setSummaryPath(result.path);
      } else {
        setSummaryError(result?.message || 'Failed to generate summary');
      }
    } catch (error) {
      setSummaryError(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setIsGeneratingSummary(false);
    }
  };

  // Open summary file in editor
  const handleOpenSummary = async () => {
    if (summaryPath && workspacePath) {
      await window.electronAPI?.invoke('workspace:open-file', { workspacePath, filePath: summaryPath });
    }
  };

  // Auto-generate summary when voice mode is first enabled
  const handleEnabledChange = async (newEnabled: boolean) => {
    onEnabledChange(newEnabled);

    // If enabling voice mode and no summary exists, generate one
    if (newEnabled && workspacePath && projectSummaryExists === false) {
      handleGenerateSummary();
    }
  };

  // Listen for preview audio from main process
  React.useEffect(() => {
    const handlePreviewAudio = (payload: { voiceId: string; audioBase64: string; format: string }) => {
      // Create audio element and play
      const audio = new Audio(`data:audio/${payload.format};base64,${payload.audioBase64}`);
      audioRef.current = audio;
      setIsPreviewPlaying(true);

      audio.onended = () => {
        setIsPreviewPlaying(false);
        audioRef.current = null;
      };

      audio.onerror = () => {
        setIsPreviewPlaying(false);
        audioRef.current = null;
      };

      audio.play().catch(() => {
        setIsPreviewPlaying(false);
        audioRef.current = null;
      });
    };

    window.electronAPI?.on('voice-mode:preview-audio', handlePreviewAudio);

    return () => {
      // Stop any playing audio on unmount
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  // Use defaults for turn detection
  const currentTurnDetection = { ...DEFAULT_TURN_DETECTION, ...turnDetection };

  const handleTurnDetectionChange = (updates: Partial<TurnDetectionConfig>) => {
    if (onTurnDetectionChange) {
      onTurnDetectionChange({ ...currentTurnDetection, ...updates });
    }
  };

  const handlePreviewVoice = async () => {
    if (isPreviewPlaying) {
      // Stop current preview
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      setIsPreviewPlaying(false);
      return;
    }

    setIsPreviewPlaying(true);
    try {
      const result = await window.electronAPI?.invoke('voice-mode:preview-voice', voice);
      if (!result?.success) {
        console.error('[VoiceModePanel] Preview failed:', result?.message);
        setIsPreviewPlaying(false);
      }
      // Audio will be received via IPC and played automatically
    } catch (error) {
      console.error('[VoiceModePanel] Preview error:', error);
      setIsPreviewPlaying(false);
    }
  };
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
              onChange={(e) => handleEnabledChange(e.target.checked)}
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
                  Choose the voice for the assistant. Each voice has its own personality and tone.
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' }}>
                <select
                  value={voice}
                  onChange={(e) => onVoiceChange(e.target.value as VoiceId)}
                  style={{
                    flex: 1,
                    padding: '6px 12px',
                    borderRadius: '4px',
                    border: '1px solid var(--border-primary)',
                    backgroundColor: 'var(--surface-secondary)',
                    color: 'var(--text-primary)',
                  }}
                >
                  {VOICE_GROUPS.map((group) => (
                    <optgroup key={group.label} label={group.label}>
                      {group.voices.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name} - {v.description}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <button
                  onClick={handlePreviewVoice}
                  disabled={isPreviewPlaying && !audioRef.current}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '4px',
                    border: '1px solid var(--border-primary)',
                    backgroundColor: isPreviewPlaying ? 'var(--color-accent)' : 'var(--surface-secondary)',
                    color: isPreviewPlaying ? 'white' : 'var(--text-primary)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                  title={isPreviewPlaying ? 'Stop preview' : 'Preview this voice'}
                >
                  <MaterialSymbol icon={isPreviewPlaying ? 'stop' : 'play_arrow'} size={16} />
                  {isPreviewPlaying ? 'Stop' : 'Preview'}
                </button>
              </div>
              <p className="provider-panel-hint" style={{ marginTop: '8px', fontSize: '12px' }}>
                Preview plays a short sample using OpenAI's TTS API.
                {VOICE_OPTIONS.find(v => v.id === voice)?.realtimeOnly && (
                  <span style={{ color: 'var(--text-secondary)' }}>
                    {' '}This voice is Realtime-only; preview uses a similar voice.
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="provider-panel-section">
            <h4 className="provider-panel-section-title">Turn Detection</h4>
            <p className="provider-panel-hint" style={{ marginBottom: '16px' }}>
              Control how the assistant detects when you're speaking and when you're done.
            </p>

            {/* Mode Selection */}
            <div className="setting-item" style={{ marginBottom: '16px' }}>
              <div className="setting-text">
                <span className="setting-name">Input Mode</span>
                <span className="setting-description">
                  Choose how voice input is captured
                </span>
              </div>
              <select
                value={currentTurnDetection.mode}
                onChange={(e) => handleTurnDetectionChange({ mode: e.target.value as 'server_vad' | 'push_to_talk' })}
                style={{
                  marginTop: '8px',
                  padding: '6px 12px',
                  borderRadius: '4px',
                  border: '1px solid var(--border-primary)',
                  backgroundColor: 'var(--surface-secondary)',
                  color: 'var(--text-primary)',
                }}
              >
                <option value="server_vad">Voice Activity Detection (automatic)</option>
                <option value="push_to_talk">Push to Talk (hold button)</option>
              </select>
            </div>

            {/* VAD-specific settings */}
            {currentTurnDetection.mode === 'server_vad' && (
              <>
                {/* VAD Threshold */}
                <div className="setting-item" style={{ marginBottom: '16px' }}>
                  <div className="setting-text">
                    <span className="setting-name">Voice Detection Sensitivity</span>
                    <span className="setting-description">
                      How sensitive the microphone is to your voice. Lower = more sensitive (picks up quiet speech), Higher = less sensitive (requires louder speech).
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '8px' }}>
                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Sensitive</span>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={(currentTurnDetection.vadThreshold || 0.5) * 100}
                      onChange={(e) => handleTurnDetectionChange({ vadThreshold: parseInt(e.target.value) / 100 })}
                      style={{ flex: 1 }}
                    />
                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Less sensitive</span>
                    <span style={{ fontSize: '12px', color: 'var(--text-primary)', minWidth: '36px' }}>
                      {Math.round((currentTurnDetection.vadThreshold || 0.5) * 100)}%
                    </span>
                  </div>
                </div>

                {/* Silence Duration */}
                <div className="setting-item" style={{ marginBottom: '16px' }}>
                  <div className="setting-text">
                    <span className="setting-name">Pause Before Processing</span>
                    <span className="setting-description">
                      How long to wait after you stop speaking before processing your request. Shorter = faster response, Longer = more time for natural pauses.
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '8px' }}>
                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Faster</span>
                    <input
                      type="range"
                      min="200"
                      max="1500"
                      step="100"
                      value={currentTurnDetection.silenceDuration || 500}
                      onChange={(e) => handleTurnDetectionChange({ silenceDuration: parseInt(e.target.value) })}
                      style={{ flex: 1 }}
                    />
                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Slower</span>
                    <span style={{ fontSize: '12px', color: 'var(--text-primary)', minWidth: '50px' }}>
                      {((currentTurnDetection.silenceDuration || 500) / 1000).toFixed(1)}s
                    </span>
                  </div>
                </div>
              </>
            )}

            {/* Interruptible setting */}
            <div className="setting-item">
              <label className="setting-label">
                <input
                  type="checkbox"
                  checked={currentTurnDetection.interruptible !== false}
                  onChange={(e) => handleTurnDetectionChange({ interruptible: e.target.checked })}
                  className="setting-checkbox"
                />
                <div className="setting-text">
                  <span className="setting-name">Allow Interruptions</span>
                  <span className="setting-description">
                    You can interrupt the assistant while it's speaking by starting to talk
                  </span>
                </div>
              </label>
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
                    Display a floating transcription of your speech above the input area
                  </span>
                </div>
              </label>
            </div>
          </div>

          {/* Project Summary Section */}
          {workspacePath && (
            <div className="provider-panel-section">
              <h4 className="provider-panel-section-title">Project Summary</h4>
              <p className="provider-panel-hint" style={{ marginBottom: '12px' }}>
                The voice assistant uses an AI-generated summary of your project to understand context.
                This summary is stored in <code style={{ fontSize: '12px', background: 'var(--surface-secondary)', padding: '2px 4px', borderRadius: '3px' }}>nimbalyst-local/voice-project-summary.md</code>.
              </p>

              {isGeneratingSummary ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)' }}>
                  <MaterialSymbol icon="sync" size={16} style={{ animation: 'spin 1s linear infinite' }} />
                  Generating project summary using Claude...
                </div>
              ) : projectSummaryExists ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <MaterialSymbol icon="check_circle" size={16} style={{ color: 'var(--success-color)' }} />
                  <span style={{ color: 'var(--text-secondary)' }}>Summary exists</span>
                  <button
                    onClick={handleOpenSummary}
                    style={{
                      padding: '4px 8px',
                      borderRadius: '4px',
                      border: '1px solid var(--border-primary)',
                      backgroundColor: 'var(--surface-secondary)',
                      color: 'var(--text-primary)',
                      cursor: 'pointer',
                      fontSize: '12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                    title="Open summary file"
                  >
                    <MaterialSymbol icon="open_in_new" size={14} />
                    View
                  </button>
                  <button
                    onClick={handleGenerateSummary}
                    style={{
                      padding: '4px 8px',
                      borderRadius: '4px',
                      border: '1px solid var(--border-primary)',
                      backgroundColor: 'var(--surface-secondary)',
                      color: 'var(--text-primary)',
                      cursor: 'pointer',
                      fontSize: '12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                    title="Regenerate summary"
                  >
                    <MaterialSymbol icon="refresh" size={14} />
                    Regenerate
                  </button>
                </div>
              ) : (
                <div>
                  <button
                    onClick={handleGenerateSummary}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '4px',
                      border: '1px solid var(--border-primary)',
                      backgroundColor: 'var(--accent-primary)',
                      color: 'white',
                      cursor: 'pointer',
                      fontSize: '13px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    <MaterialSymbol icon="auto_awesome" size={16} />
                    Generate Project Summary
                  </button>
                  <p className="provider-panel-hint" style={{ marginTop: '8px', fontSize: '12px' }}>
                    This will read your CLAUDE.md, README.md, and package.json to create a concise summary.
                  </p>
                </div>
              )}

              {summaryError && (
                <p style={{ color: 'var(--error-color)', marginTop: '8px', fontSize: '12px' }}>
                  {summaryError}
                </p>
              )}
            </div>
          )}

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
