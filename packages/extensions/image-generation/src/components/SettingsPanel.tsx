/**
 * Image Generation Settings Panel
 *
 * Settings panel for configuring the Image Generation extension.
 * Displayed in Settings > Extensions > Image Generation.
 */

import { useState, useEffect } from 'react';
import type { SettingsPanelProps } from '@nimbalyst/runtime';

// Storage key for the Google AI API key (must match ImageProjectEditor)
const GOOGLE_AI_KEY_STORAGE_KEY = 'google_ai_api_key';

export function ImageGenerationSettings({ storage, theme }: SettingsPanelProps) {
  const isDark = theme === 'dark' || theme === 'crystal-dark';
  const [apiKey, setApiKey] = useState('');
  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Load existing API key on mount
  useEffect(() => {
    const loadApiKey = async () => {
      try {
        const storedKey = await storage.getSecret(GOOGLE_AI_KEY_STORAGE_KEY);
        if (storedKey) {
          // Show masked version
          setApiKey('');
          setHasStoredKey(true);
        }
      } catch (error) {
        console.error('[ImageGenSettings] Failed to load API key:', error);
      } finally {
        setIsLoading(false);
      }
    };
    loadApiKey();
  }, [storage]);

  const handleSave = async () => {
    if (!apiKey.trim()) {
      setMessage({ type: 'error', text: 'Please enter an API key' });
      return;
    }

    setIsSaving(true);
    setMessage(null);

    try {
      await storage.setSecret(GOOGLE_AI_KEY_STORAGE_KEY, apiKey.trim());
      setHasStoredKey(true);
      setApiKey(''); // Clear the input after saving
      setMessage({ type: 'success', text: 'API key saved successfully' });
    } catch (error) {
      console.error('[ImageGenSettings] Failed to save API key:', error);
      setMessage({ type: 'error', text: 'Failed to save API key' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleClear = async () => {
    setIsSaving(true);
    setMessage(null);

    try {
      await storage.deleteSecret(GOOGLE_AI_KEY_STORAGE_KEY);
      setHasStoredKey(false);
      setApiKey('');
      setMessage({ type: 'success', text: 'API key removed' });
    } catch (error) {
      console.error('[ImageGenSettings] Failed to clear API key:', error);
      setMessage({ type: 'error', text: 'Failed to remove API key' });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div style={{ padding: 20, color: 'var(--nim-text-muted)' }}>
        Loading settings...
      </div>
    );
  }

  return (
    <div style={{ padding: 20 }}>
      <h3 style={{ margin: '0 0 8px 0', fontSize: 16, fontWeight: 600 }}>
        Google AI API Key
      </h3>
      <p style={{ margin: '0 0 16px 0', fontSize: 13, color: 'var(--nim-text-muted)', lineHeight: 1.5 }}>
        Required for image generation using Google's Imagen model.{' '}
        <a
          href="https://aistudio.google.com/app/apikey"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'var(--accent-color)' }}
        >
          Get your API key
        </a>
      </p>

      {hasStoredKey && (
        <div
          style={{
            padding: '8px 12px',
            marginBottom: 12,
            background: 'var(--success-background, rgba(34, 197, 94, 0.1))',
            border: '1px solid var(--success-color, #22c55e)',
            borderRadius: 6,
            fontSize: 13,
            color: 'var(--success-color, #22c55e)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span>&#10003;</span>
          <span>API key is configured</span>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={hasStoredKey ? 'Enter new key to replace...' : 'Enter your Google AI API key'}
          style={{
            flex: 1,
            padding: '8px 12px',
            borderRadius: 6,
            border: '1px solid var(--border-color)',
            background: 'var(--input-background)',
            color: 'var(--nim-text)',
            fontSize: 14,
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && apiKey.trim()) {
              handleSave();
            }
          }}
        />
        <button
          onClick={handleSave}
          disabled={isSaving || !apiKey.trim()}
          style={{
            padding: '8px 16px',
            borderRadius: 6,
            border: 'none',
            background: apiKey.trim() ? 'var(--accent-color)' : 'var(--nim-bg-secondary)',
            color: apiKey.trim() ? '#ffffff' : 'var(--nim-text-muted)',
            cursor: apiKey.trim() ? 'pointer' : 'not-allowed',
            fontWeight: 500,
            fontSize: 14,
          }}
        >
          {isSaving ? 'Saving...' : 'Save'}
        </button>
        {hasStoredKey && (
          <button
            onClick={handleClear}
            disabled={isSaving}
            style={{
              padding: '8px 12px',
              borderRadius: 6,
              border: '1px solid var(--border-color)',
              background: 'transparent',
              color: 'var(--nim-text-muted)',
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            Clear
          </button>
        )}
      </div>

      {message && (
        <div
          style={{
            padding: '8px 12px',
            borderRadius: 6,
            fontSize: 13,
            background:
              message.type === 'success'
                ? 'var(--success-background, rgba(34, 197, 94, 0.1))'
                : 'var(--error-background, rgba(239, 68, 68, 0.1))',
            color:
              message.type === 'success'
                ? 'var(--success-color, #22c55e)'
                : 'var(--error-color, #ef4444)',
          }}
        >
          {message.text}
        </div>
      )}

      <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--border-color)' }}>
        <h4 style={{ margin: '0 0 8px 0', fontSize: 14, fontWeight: 500 }}>
          About Image Generation
        </h4>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--nim-text-muted)', lineHeight: 1.5 }}>
          This extension uses Google's Imagen 4 model to generate images from text prompts.
          Create architecture diagrams, UI wireframes, illustrations, and more directly in Nimbalyst.
        </p>
      </div>
    </div>
  );
}

export default ImageGenerationSettings;
