import React, { useEffect, useState } from 'react';
import { SettingsRepository, getOpenAIModels, getAnthropicModels, getLMStudioModels, type AIModelInfo, type AISettings } from '@stravu/runtime';

interface Props { open: boolean; onClose: () => void; }

export function AIModelsSheet({ open, onClose }: Props) {
  const [ai, setAI] = useState<AISettings>({ providers: {}, defaultProvider: 'lmstudio' });
  const [openAIModels, setOpenAIModels] = useState<AIModelInfo[]>([]);
  const [anthropicModels, setAnthropicModels] = useState<AIModelInfo[]>([]);
  const [lmstudioModels, setLmstudioModels] = useState<AIModelInfo[]>([]);
  const p = ai.providers || (ai.providers = {});

  useEffect(() => { (async () => {
    const s = await SettingsRepository.get();
    setAI({ defaultProvider: 'lmstudio', providers: {}, ...s.ai });
  })(); }, []);

  const save = async (next: AISettings) => {
    setAI(next);
    await SettingsRepository.updateAI(next);
  };

  if (!open) return null;

  const section = (title: string, body: React.ReactNode) => (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 12, marginBottom: 12 }}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>{title}</div>
      {body}
    </div>
  );

  const toggle = (label: string, checked: boolean, onChange: (v: boolean) => void) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  );

  const chips = (models: AIModelInfo[], selected: string[] = [], onToggle: (id: string, sel: boolean) => void) => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {models.map(m => (
        <button key={m.id} className="btn" style={{ background: selected.includes(m.id) ? '#eef2ff' : '#fff' }} onClick={() => onToggle(m.id, !selected.includes(m.id))}>
          {m.name}
        </button>
      ))}
    </div>
  );

  return (
    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)' }} onClick={onClose}>
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '82vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontWeight: 700 }}>AI Models</div>
            <button className="btn" onClick={onClose}>Close</button>
          </div>

          {section('Anthropic', (
            <div style={{ display: 'grid', gap: 8 }}>
              {toggle('Enable', !!p.anthropic?.enabled, (v) => save({ providers: { anthropic: { enabled: v } } } as any))}
              <input placeholder="API Key" value={p.anthropic?.apiKey || ''} onChange={(e) => save({ providers: { anthropic: { apiKey: e.target.value } } } as any)} style={{ padding: '6px 8px', border: '1px solid #e5e7eb', borderRadius: 8 }} />
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn" onClick={async () => setAnthropicModels(await getAnthropicModels(p.anthropic?.apiKey))}>Fetch Models</button>
                <button className="btn" onClick={() => save({ ...ai, providers: { ...p, anthropic: { ...(p.anthropic||{}), selectedModels: anthropicModels.map(m=>m.id) } } })}>Select All</button>
              </div>
              {chips(anthropicModels, p.anthropic?.selectedModels || [], (id, sel) => {
                const selSet = new Set(p.anthropic?.selectedModels || []);
                sel ? selSet.add(id) : selSet.delete(id);
                save({ providers: { anthropic: { selectedModels: Array.from(selSet), defaultModel: p.anthropic?.defaultModel || id } } } as any);
              })}
            </div>
          ))}

          {section('OpenAI', (
            <div style={{ display: 'grid', gap: 8 }}>
              {toggle('Enable', !!p.openai?.enabled, (v) => save({ providers: { openai: { enabled: v } } } as any))}
              <input placeholder="API Key" value={p.openai?.apiKey || ''} onChange={(e) => save({ providers: { openai: { apiKey: e.target.value } } } as any)} style={{ padding: '6px 8px', border: '1px solid #e5e7eb', borderRadius: 8 }} />
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn" onClick={async () => setOpenAIModels(await getOpenAIModels(p.openai?.apiKey))}>Fetch Models</button>
                <button className="btn" onClick={() => save({ ...ai, providers: { ...p, openai: { ...(p.openai||{}), selectedModels: openAIModels.map(m=>m.id) } } })}>Select All</button>
              </div>
              {chips(openAIModels, p.openai?.selectedModels || [], (id, sel) => {
                const selSet = new Set(p.openai?.selectedModels || []);
                sel ? selSet.add(id) : selSet.delete(id);
                save({ providers: { openai: { selectedModels: Array.from(selSet), defaultModel: p.openai?.defaultModel || id } } } as any);
              })}
            </div>
          ))}

          {section('LM Studio', (
            <div style={{ display: 'grid', gap: 8 }}>
              {toggle('Enable', !!p.lmstudio?.enabled, (v) => save({ providers: { lmstudio: { enabled: v } } } as any))}
              <input placeholder="Base URL (e.g. /lmstudio/v1)" value={p.lmstudio?.baseUrl || ''} onChange={(e) => save({ providers: { lmstudio: { baseUrl: e.target.value } } } as any)} style={{ padding: '6px 8px', border: '1px solid #e5e7eb', borderRadius: 8 }} />
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn" onClick={async () => setLmstudioModels(await getLMStudioModels((p.lmstudio?.baseUrl || '/lmstudio/v1').replace(/\/$/, '')))}>Fetch Models</button>
                <button className="btn" onClick={() => save({ ...ai, providers: { ...p, lmstudio: { ...(p.lmstudio||{}), selectedModels: lmstudioModels.map(m=>m.id) } } })}>Select All</button>
              </div>
              {chips(lmstudioModels, p.lmstudio?.selectedModels || [], (id, sel) => {
                const selSet = new Set(p.lmstudio?.selectedModels || []);
                sel ? selSet.add(id) : selSet.delete(id);
                save({ providers: { lmstudio: { selectedModels: Array.from(selSet), defaultModel: p.lmstudio?.defaultModel || id } } } as any);
              })}
            </div>
          ))}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn" onClick={onClose}>Done</button>
          </div>
        </div>
      </div>
    </div>
  );
}
