import React, { useEffect, useState } from 'react';
import { SettingsRepository, type AISettings } from '@stravu/runtime';
import { OpenAIIcon, ClaudeIcon, LMStudioIcon } from './ProviderIcons';

interface Props {
  open: boolean;
  onClose: () => void;
  currentProvider: 'anthropic' | 'openai' | 'lmstudio';
  currentModel: string;
  onSelect: (provider: 'anthropic'|'openai'|'lmstudio', model: string) => void;
  onConfigure: () => void;
}

export function ModelPicker({ open, onClose, currentProvider, currentModel, onSelect, onConfigure }: Props) {
  const [ai, setAI] = useState<AISettings>({ providers: {}, defaultProvider: 'lmstudio' });

  useEffect(() => { if (open) { (async () => { const s = await SettingsRepository.get(); setAI({ defaultProvider: 'lmstudio', providers: {}, ...s.ai }); })(); } }, [open]);

  if (!open) return null;

  const p = ai.providers || {} as NonNullable<AISettings['providers']>;

  const section = (label: string, providerKey: 'anthropic'|'openai'|'lmstudio') => {
    const prov = p[providerKey];
    const enabled = prov?.enabled !== false; // default true
    const models = prov?.selectedModels || [];
    return (
      <div style={{ padding: '8px 0', opacity: enabled ? 1 : 0.6 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', margin: '4px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
          {providerKey === 'anthropic' ? <ClaudeIcon size={16} /> : providerKey === 'openai' ? <OpenAIIcon size={16} /> : <LMStudioIcon size={16} />}
          {label}
        </div>
        <div style={{ display: 'grid', gap: 6 }}>
          {models.length === 0 ? (
            <div className="muted">No models selected</div>
          ) : models.map(id => {
            const isCurrent = currentProvider === providerKey && currentModel === id;
            return (
              <button key={id} className="btn" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} onClick={() => { onSelect(providerKey, id); onClose(); }}>
                <span className="truncate">{id}</span>
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
        {section('OPENAI', 'openai')}
        {section('LM STUDIO', 'lmstudio')}
        <div style={{ borderTop: '1px solid var(--stravu-editor-border, #e5e7eb)', marginTop: 8, paddingTop: 8, display: 'flex', justifyContent: 'space-between' }}>
          <button className="btn" onClick={onConfigure}>Configure Models</button>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
