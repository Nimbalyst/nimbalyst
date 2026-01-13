/**
 * Voice Transcription Display
 *
 * Floating overlay that shows live transcription during voice mode.
 * Displays user speech and assistant responses with visual distinction.
 */

import React, { useEffect, useState, useRef } from 'react';

interface TranscriptionEntry {
  id: string;
  type: 'user' | 'assistant';
  text: string;
  timestamp: number;
}

interface VoiceTranscriptionDisplayProps {
  isActive: boolean;
  sessionId: string;
}

// How long entries stay visible before fading
const ENTRY_TIMEOUT_MS = 8000;
// How often to check for stale entries
const CLEANUP_INTERVAL_MS = 1000;

export function VoiceTranscriptionDisplay({ isActive, sessionId }: VoiceTranscriptionDisplayProps) {
  const [entries, setEntries] = useState<TranscriptionEntry[]>([]);
  const [currentUserText, setCurrentUserText] = useState<string>('');
  const containerRef = useRef<HTMLDivElement>(null);

  // Listen for transcription events
  useEffect(() => {
    if (!isActive) {
      setEntries([]);
      setCurrentUserText('');
      return;
    }

    // Listen for user speech transcription (input_audio_transcription)
    const handleTextReceived = (payload: { sessionId: string; text: string; type?: string }) => {
      if (payload.sessionId !== sessionId) return;

      // This is typically partial transcription - update current user text
      setCurrentUserText(payload.text);
    };

    // Listen for assistant responses
    const handleAssistantText = (payload: { sessionId: string; text: string }) => {
      if (payload.sessionId !== sessionId) return;

      // Add or update assistant entry
      setEntries(prev => {
        const lastEntry = prev[prev.length - 1];
        if (lastEntry && lastEntry.type === 'assistant') {
          // Update the last assistant entry with more text
          return prev.map((e, i) =>
            i === prev.length - 1
              ? { ...e, text: e.text + payload.text, timestamp: Date.now() }
              : e
          );
        }
        // Create new assistant entry
        return [...prev, {
          id: `assistant-${Date.now()}`,
          type: 'assistant',
          text: payload.text,
          timestamp: Date.now(),
        }];
      });
    };

    // When user finishes speaking (commit), add the transcription as an entry
    const handleUserComplete = (payload: { sessionId: string; transcript: string }) => {
      if (payload.sessionId !== sessionId || !payload.transcript) return;

      setCurrentUserText('');
      setEntries(prev => [...prev, {
        id: `user-${Date.now()}`,
        type: 'user',
        text: payload.transcript,
        timestamp: Date.now(),
      }]);
    };

    // Register listeners
    window.electronAPI.on('voice-mode:text-received', handleTextReceived);
    window.electronAPI.on('voice-mode:transcript-complete', handleUserComplete);

    return () => {
      // Note: electron API doesn't have removeListener, but the component unmounts when voice mode ends
    };
  }, [isActive, sessionId]);

  // Cleanup old entries periodically
  useEffect(() => {
    if (!isActive) return;

    const interval = setInterval(() => {
      const now = Date.now();
      setEntries(prev => prev.filter(entry => now - entry.timestamp < ENTRY_TIMEOUT_MS));
    }, CLEANUP_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [isActive]);

  // Clear entries when voice mode ends
  useEffect(() => {
    if (!isActive) {
      setEntries([]);
      setCurrentUserText('');
    }
  }, [isActive]);

  // Don't render if not active or nothing to show
  if (!isActive || (entries.length === 0 && !currentUserText)) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        bottom: '100%',
        left: 0,
        right: 0,
        marginBottom: '8px',
        maxHeight: '200px',
        overflow: 'hidden',
        pointerEvents: 'none',
        zIndex: 100,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          padding: '8px 12px',
          background: 'var(--surface-elevated, rgba(0, 0, 0, 0.8))',
          borderRadius: '8px',
          backdropFilter: 'blur(8px)',
          border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.1))',
        }}
      >
        {/* Past entries */}
        {entries.map(entry => (
          <div
            key={entry.id}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '8px',
              opacity: Math.max(0.3, 1 - (Date.now() - entry.timestamp) / ENTRY_TIMEOUT_MS),
              transition: 'opacity 0.5s ease-out',
            }}
          >
            <span
              style={{
                fontSize: '11px',
                fontWeight: 600,
                color: entry.type === 'user' ? 'var(--color-accent)' : 'var(--color-success)',
                textTransform: 'uppercase',
                flexShrink: 0,
                marginTop: '2px',
              }}
            >
              {entry.type === 'user' ? 'You' : 'AI'}
            </span>
            <span
              style={{
                fontSize: '13px',
                color: 'var(--text-primary)',
                lineHeight: '1.4',
              }}
            >
              {entry.text}
            </span>
          </div>
        ))}

        {/* Current user speech (live transcription) */}
        {currentUserText && (
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '8px',
            }}
          >
            <span
              style={{
                fontSize: '11px',
                fontWeight: 600,
                color: 'var(--color-accent)',
                textTransform: 'uppercase',
                flexShrink: 0,
                marginTop: '2px',
              }}
            >
              You
            </span>
            <span
              style={{
                fontSize: '13px',
                color: 'var(--text-secondary)',
                lineHeight: '1.4',
                fontStyle: 'italic',
              }}
            >
              {currentUserText}...
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
