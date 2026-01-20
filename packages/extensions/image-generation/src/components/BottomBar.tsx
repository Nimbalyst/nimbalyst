/**
 * BottomBar Component
 *
 * Provides the prompt input and generation settings at the bottom of the editor.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import type { ImageStyle, AspectRatio } from '../types';
import { STYLE_PRESETS, ASPECT_RATIOS } from '../types';

interface BottomBarProps {
  defaultStyle: ImageStyle;
  defaultAspectRatio: AspectRatio;
  defaultVariations: number;
  isGenerating: boolean;
  onGenerate: (
    prompt: string,
    style: ImageStyle,
    aspectRatio: AspectRatio,
    variations: number
  ) => void;
  theme: 'light' | 'dark';
  /** Optional initial prompt value (for edit & retry) */
  initialPrompt?: string;
}

export function BottomBar({
  defaultStyle,
  defaultAspectRatio,
  defaultVariations,
  isGenerating,
  onGenerate,
  theme,
  initialPrompt = '',
}: BottomBarProps) {
  const isDark = theme === 'dark';

  const [prompt, setPrompt] = useState(initialPrompt);
  const [style, setStyle] = useState<ImageStyle>(defaultStyle);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>(defaultAspectRatio);
  const [variations, setVariations] = useState(defaultVariations);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Handle generate
  const handleGenerate = useCallback(() => {
    if (!prompt.trim() || isGenerating) return;
    onGenerate(prompt.trim(), style, aspectRatio, variations);
    // Don't clear prompt - user might want to iterate
  }, [prompt, style, aspectRatio, variations, isGenerating, onGenerate]);

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleGenerate();
      }
    },
    [handleGenerate]
  );

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
    }
  }, [prompt]);

  // Update prompt when initialPrompt changes (for edit & retry)
  useEffect(() => {
    if (initialPrompt) {
      setPrompt(initialPrompt);
    }
  }, [initialPrompt]);

  const baseInputStyle: React.CSSProperties = {
    padding: '6px 10px',
    background: isDark ? '#2d2d2d' : '#ffffff',
    border: `1px solid ${isDark ? '#4a4a4a' : '#e5e7eb'}`,
    borderRadius: 5,
    color: isDark ? '#ffffff' : '#111827',
    fontSize: 12,
    fontFamily: 'inherit',
  };

  return (
    <div
      style={{
        background: isDark ? '#1a1a1a' : '#f9fafb',
        borderTop: `1px solid ${isDark ? '#4a4a4a' : '#e5e7eb'}`,
        padding: '16px 20px',
      }}
    >
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
        {/* Prompt input and settings */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe the image you want to generate..."
            rows={1}
            style={{
              width: '100%',
              minHeight: 44,
              maxHeight: 120,
              padding: '12px 14px',
              background: isDark ? '#2d2d2d' : '#ffffff',
              border: `1px solid ${isDark ? '#4a4a4a' : '#e5e7eb'}`,
              borderRadius: 8,
              color: isDark ? '#ffffff' : '#111827',
              fontSize: 14,
              fontFamily: 'inherit',
              resize: 'vertical',
              lineHeight: 1.4,
            }}
          />

          {/* Settings row */}
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            {/* Style selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: isDark ? '#808080' : '#6b7280' }}>Style</span>
              <select
                value={style}
                onChange={(e) => setStyle(e.target.value as ImageStyle)}
                style={{ ...baseInputStyle, cursor: 'pointer' }}
              >
                {STYLE_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Size selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: isDark ? '#808080' : '#6b7280' }}>Size</span>
              <select
                value={aspectRatio}
                onChange={(e) => setAspectRatio(e.target.value as AspectRatio)}
                style={{ ...baseInputStyle, cursor: 'pointer' }}
              >
                {ASPECT_RATIOS.map((ratio) => (
                  <option key={ratio.id} value={ratio.id}>
                    {ratio.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Variations input */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: isDark ? '#808080' : '#6b7280' }}>
                Variations
              </span>
              <input
                type="number"
                min={1}
                max={4}
                value={variations}
                onChange={(e) => setVariations(Math.max(1, Math.min(4, parseInt(e.target.value) || 1)))}
                style={{
                  ...baseInputStyle,
                  width: 50,
                  textAlign: 'center',
                }}
              />
            </div>

            {/* Advanced toggle */}
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 10px',
                background: 'transparent',
                border: 'none',
                color: isDark ? '#60a5fa' : '#3b82f6',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              <span>&#9881;</span>
              Advanced
            </button>
          </div>

          {/* Advanced options (collapsed by default) */}
          {showAdvanced && (
            <div
              style={{
                padding: 12,
                background: isDark ? '#2d2d2d' : '#ffffff',
                border: `1px solid ${isDark ? '#4a4a4a' : '#e5e7eb'}`,
                borderRadius: 6,
              }}
            >
              <div style={{ fontSize: 11, color: isDark ? '#808080' : '#6b7280', marginBottom: 8 }}>
                Advanced options will be available when provider integration is complete.
              </div>
            </div>
          )}
        </div>

        {/* Generate button */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <button
            onClick={handleGenerate}
            disabled={!prompt.trim() || isGenerating}
            style={{
              padding: '12px 24px',
              background: !prompt.trim() || isGenerating ? (isDark ? '#4a4a4a' : '#d1d5db') : '#60a5fa',
              border: 'none',
              borderRadius: 8,
              color: '#ffffff',
              fontSize: 14,
              fontWeight: 600,
              cursor: !prompt.trim() || isGenerating ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              whiteSpace: 'nowrap',
              transition: 'background 0.15s ease',
            }}
          >
            {isGenerating ? (
              <>
                <span style={{ animation: 'spin 1s linear infinite' }}>&#8987;</span>
                Generating...
              </>
            ) : (
              <>
                <span>&#9889;</span>
                Generate
              </>
            )}
          </button>
          <span style={{ fontSize: 11, color: isDark ? '#808080' : '#9ca3af' }}>
            <span
              style={{
                display: 'inline-block',
                padding: '2px 5px',
                background: isDark ? '#3a3a3a' : '#e5e7eb',
                borderRadius: 3,
                fontFamily: "'SF Mono', Monaco, monospace",
                fontSize: 10,
              }}
            >
              Cmd
            </span>
            +
            <span
              style={{
                display: 'inline-block',
                padding: '2px 5px',
                background: isDark ? '#3a3a3a' : '#e5e7eb',
                borderRadius: 3,
                fontFamily: "'SF Mono', Monaco, monospace",
                fontSize: 10,
              }}
            >
              Enter
            </span>
          </span>
        </div>
      </div>

      {/* Keyframe animation for spinner */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
