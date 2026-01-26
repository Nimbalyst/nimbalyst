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
      <div className="p-5 text-nim-muted">
        Loading settings...
      </div>
    );
  }

  return (
    <div className="p-5">
      <h3 className="m-0 mb-2 text-base font-semibold">
        Google AI API Key
      </h3>
      <p className="m-0 mb-4 text-[13px] text-nim-muted leading-normal">
        Required for image generation using Google's Imagen model.{' '}
        <a
          href="https://aistudio.google.com/app/apikey"
          target="_blank"
          rel="noopener noreferrer"
          className="text-nim-link"
        >
          Get your API key
        </a>
      </p>

      {hasStoredKey && (
        <div className="px-3 py-2 mb-3 bg-[rgba(34,197,94,0.1)] border border-nim-success rounded-md text-[13px] text-nim-success flex items-center gap-2">
          <span>&#10003;</span>
          <span>API key is configured</span>
        </div>
      )}

      <div className="flex gap-2 mb-3">
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={hasStoredKey ? 'Enter new key to replace...' : 'Enter your Google AI API key'}
          className="flex-1 px-3 py-2 rounded-md border border-nim bg-nim text-nim text-sm"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && apiKey.trim()) {
              handleSave();
            }
          }}
        />
        <button
          onClick={handleSave}
          disabled={isSaving || !apiKey.trim()}
          className={`px-4 py-2 rounded-md border-none font-medium text-sm ${apiKey.trim() ? 'bg-nim-primary text-white cursor-pointer' : 'bg-nim-secondary text-nim-muted cursor-not-allowed'}`}
        >
          {isSaving ? 'Saving...' : 'Save'}
        </button>
        {hasStoredKey && (
          <button
            onClick={handleClear}
            disabled={isSaving}
            className="px-3 py-2 rounded-md border border-nim bg-transparent text-nim-muted cursor-pointer text-sm"
          >
            Clear
          </button>
        )}
      </div>

      {message && (
        <div
          className={`px-3 py-2 rounded-md text-[13px] ${message.type === 'success' ? 'bg-[rgba(34,197,94,0.1)] text-nim-success' : 'bg-[rgba(239,68,68,0.1)] text-nim-error'}`}
        >
          {message.text}
        </div>
      )}

      <div className="mt-6 pt-4 border-t border-nim">
        <h4 className="m-0 mb-2 text-sm font-medium">
          About Image Generation
        </h4>
        <p className="m-0 text-[13px] text-nim-muted leading-normal">
          This extension uses Google's Imagen 4 model to generate images from text prompts.
          Create architecture diagrams, UI wireframes, illustrations, and more directly in Nimbalyst.
        </p>
      </div>
    </div>
  );
}

export default ImageGenerationSettings;
