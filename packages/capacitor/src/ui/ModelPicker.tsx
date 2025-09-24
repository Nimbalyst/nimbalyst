import React, { useEffect, useState } from 'react';
import type { AISettings } from './aiSettingsStore';
import { getSettings, updateAISettings } from './aiSettingsStore';
import { OpenAIIcon, ClaudeIcon, LMStudioIcon } from './ProviderIcons';

interface Props {
  open: boolean;
  onClose: () => void;
  currentProvider: 'anthropic' | 'openai' | 'openai-codex' | 'lmstudio' | 'claude-code';
  currentModel: string;
  onSelect: (provider: 'anthropic'|'openai'|'openai-codex'|'lmstudio'|'claude-code', model: string) => void;
  onConfigure: () => void;
}

export function ModelPicker({ open, onClose, currentProvider, currentModel, onSelect, onConfigure }: Props) {
  const [ai, setAI] = useState<AISettings>({ providers: {}, defaultProvider: 'lmstudio' });

  useEffect(() => {
    if (open) {
      (async () => {
        const s = await getSettings();
        setAI({ defaultProvider: 'lmstudio', providers: {}, ...s.ai });
      })();
    }
  }, [open]);

  if (!open) return null;

  const p = ai.providers || {} as NonNullable<AISettings['providers']>;

  const section = (label: string, providerKey: 'anthropic'|'openai'|'openai-codex'|'lmstudio'|'claude-code') => {
    const prov = p[providerKey];
    const enabled = prov?.enabled !== false; // default true
    let models = prov?.selectedModels || [];

    // Default models for each provider when none are configured
    if (models.length === 0) {
      switch (providerKey) {
        case 'openai-codex':
          models = ['openai-codex:openai-codex-cli'];
          break;
        case 'claude-code':
          models = ['claude-code:claude-code-cli'];
          break;
        case 'anthropic':
          // No default - user must configure
          break;
        case 'openai':
          // No default - user must configure
          break;
        case 'lmstudio':
          // No default - user must configure
          break;
      }
    }

    return (
      <div style={{ padding: '8px 0', opacity: enabled ? 1 : 0.6 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', margin: '4px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
          {providerKey === 'anthropic' || providerKey === 'claude-code' ? <ClaudeIcon size={16} /> : providerKey === 'openai' || providerKey === 'openai-codex' ? <OpenAIIcon size={16} /> : <LMStudioIcon size={16} />}
          {label}
        </div>
        <div style={{ display: 'grid', gap: 6 }}>
          {models.map(id => {
            const isCurrent = currentProvider === providerKey && currentModel === id;
            // Display a nicer name for the model
            let displayName = id;
            if (id === 'openai-codex:openai-codex-cli') {
              displayName = 'OpenAI Codex CLI';
            } else if (id === 'claude-code:claude-code-cli') {
              displayName = 'Claude Code CLI';
            }
            return (
              <button key={id} className="btn" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} onClick={() => { onSelect(providerKey, id); onClose(); }}>
                <span className="truncate">{displayName}</span>
                <span className="flex items-center gap-2">
                  {isCurrent && <span className="material-symbols-rounded" style={{ fontSize: 18, color: '#16a34a' }}>check</span>}
                  <span className="material-symbols-rounded" style={{ fontSize: 18 }}>arrow_right_alt</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div style={{ position: 'absolute', inset: 0 }} onClick={onClose}>
      <div style={{ position: 'absolute', bottom: 56, left: 8, right: 8, margin: '0 auto', maxWidth: 720, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, boxShadow: '0 12px 32px rgba(0,0,0,0.2)', padding: 12 }} onClick={(e) => e.stopPropagation()}>
        {/* New conversation */}
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-semibold text-gray-500">Session</div>
          <button className="btn" onClick={() => { onSelect(currentProvider, currentModel); onClose(); }}>Use current</button>
        </div>
        <button className="btn mb-3" onClick={() => { onSelect(currentProvider, currentModel); window.dispatchEvent(new CustomEvent('ai:new-conversation')); onClose(); }}>
          <span className="material-symbols-rounded mr-2">add</span> New conversation
        </button>
        {section('CLAUDE (Anthropic)', 'anthropic')}
        {section('CLAUDE CODE (MCP)', 'claude-code')}
        {section('OPENAI', 'openai')}
        {section('OPENAI CODEX', 'openai-codex')}
        {section('LM STUDIO', 'lmstudio')}
        <div style={{ borderTop: '1px solid var(--stravu-editor-border, #e5e7eb)', marginTop: 8, paddingTop: 8, display: 'flex', justifyContent: 'space-between' }}>
          <button className="btn" onClick={onConfigure}>Configure Models</button>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
