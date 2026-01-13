/**
 * Voice Context Indicator
 *
 * Shows live token usage during voice mode sessions.
 * Displays a progress bar showing how much of the context window has been used.
 */

import React, { useEffect, useState } from 'react';

interface VoiceContextIndicatorProps {
  isActive: boolean;
  sessionId: string;
}

interface TokenUsage {
  inputAudio: number;
  outputAudio: number;
  text: number;
  total: number;
}

// OpenAI Realtime API context window is ~32k tokens effective
// (128k documented but quality degrades, auto-truncation at ~28k)
const CONTEXT_WINDOW_TOKENS = 28000;

export function VoiceContextIndicator({ isActive, sessionId }: VoiceContextIndicatorProps) {
  const [tokenUsage, setTokenUsage] = useState<TokenUsage | null>(null);

  useEffect(() => {
    if (!isActive) {
      setTokenUsage(null);
      return;
    }

    const handleTokenUsage = (payload: { sessionId: string; usage: TokenUsage }) => {
      if (payload.sessionId !== sessionId) return;
      setTokenUsage(payload.usage);
    };

    const removeListener = window.electronAPI.on('voice-mode:token-usage', handleTokenUsage);

    return () => {
      removeListener?.();
    };
  }, [isActive, sessionId]);

  if (!isActive) {
    return null;
  }

  const total = tokenUsage?.total || 0;
  const percentage = Math.min(100, (total / CONTEXT_WINDOW_TOKENS) * 100);

  // Color based on usage level
  const getColor = () => {
    if (percentage > 80) return 'var(--error-color)';
    if (percentage > 60) return 'var(--warning-color)';
    return 'var(--success-color)';
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '2px 8px',
        fontSize: '11px',
        color: 'var(--text-secondary)',
        background: 'var(--surface-tertiary)',
        borderRadius: '4px',
        fontFamily: 'monospace',
      }}
      title={`Voice context: ${total.toLocaleString()} / ${CONTEXT_WINDOW_TOKENS.toLocaleString()} tokens (${percentage.toFixed(1)}%)\nInput audio: ${tokenUsage?.inputAudio.toLocaleString() || 0}\nOutput audio: ${tokenUsage?.outputAudio.toLocaleString() || 0}\nText: ${tokenUsage?.text.toLocaleString() || 0}`}
    >
      {/* Progress bar */}
      <div
        style={{
          width: '40px',
          height: '6px',
          background: 'var(--surface-primary)',
          borderRadius: '3px',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${percentage}%`,
            height: '100%',
            background: getColor(),
            transition: 'width 0.3s ease, background 0.3s ease',
          }}
        />
      </div>
      {/* Token count */}
      <span style={{ minWidth: '45px', textAlign: 'right' }}>
        {total > 1000 ? `${(total / 1000).toFixed(1)}k` : total}
      </span>
    </div>
  );
}
