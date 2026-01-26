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

  return (
    <div
      className="image-gen-bottom-bar"
      style={{
        flexShrink: 0,
        flexGrow: 0,
        background: 'var(--nim-bg-secondary)',
        borderTop: '1px solid var(--nim-border)',
        padding: '16px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        overflow: 'visible',
      }}
    >
      {/* Prompt textarea */}
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
          background: 'var(--nim-bg)',
          border: '1px solid var(--nim-border)',
          borderRadius: 8,
          color: 'var(--nim-text)',
          fontSize: 14,
          fontFamily: 'inherit',
          resize: 'none',
          lineHeight: 1.4,
          overflow: 'hidden',
        }}
      />

      {/* Settings row with Generate button */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', overflow: 'visible' }}>
        {/* Style selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--nim-text-muted)' }}>Style</span>
          <select
            value={style}
            onChange={(e) => setStyle(e.target.value as ImageStyle)}
            style={{
              padding: '6px 10px',
              background: 'var(--nim-bg)',
              border: '1px solid var(--nim-border)',
              borderRadius: 5,
              color: 'var(--nim-text)',
              fontSize: 12,
              fontFamily: 'inherit',
              cursor: 'pointer',
            }}
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
          <span style={{ fontSize: 12, color: 'var(--nim-text-muted)' }}>Size</span>
          <select
            value={aspectRatio}
            onChange={(e) => setAspectRatio(e.target.value as AspectRatio)}
            style={{
              padding: '6px 10px',
              background: 'var(--nim-bg)',
              border: '1px solid var(--nim-border)',
              borderRadius: 5,
              color: 'var(--nim-text)',
              fontSize: 12,
              fontFamily: 'inherit',
              cursor: 'pointer',
            }}
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
          <span style={{ fontSize: 12, color: 'var(--nim-text-muted)' }}>Variations</span>
          <input
            type="number"
            min={1}
            max={4}
            value={variations}
            onChange={(e) =>
              setVariations(Math.max(1, Math.min(4, parseInt(e.target.value) || 1)))
            }
            style={{
              padding: '6px 10px',
              background: 'var(--nim-bg)',
              border: '1px solid var(--nim-border)',
              borderRadius: 5,
              color: 'var(--nim-text)',
              fontSize: 12,
              fontFamily: 'inherit',
              width: 50,
              textAlign: 'center',
            }}
          />
        </div>

        {/* Spacer to push button to the right */}
        <div style={{ flex: 1 }} />

        {/* Generate button */}
        <button
          onClick={handleGenerate}
          disabled={!prompt.trim() || isGenerating}
          style={{
            padding: '8px 20px',
            background:
              !prompt.trim() || isGenerating
                ? 'var(--nim-text-disabled)'
                : 'var(--nim-primary)',
            border: 'none',
            borderRadius: 6,
            color: '#ffffff',
            fontSize: 13,
            fontWeight: 600,
            cursor: !prompt.trim() || isGenerating ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            whiteSpace: 'nowrap',
            transition: 'background 0.15s ease',
          }}
        >
          {isGenerating ? 'Generating...' : 'Generate'}
        </button>
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
