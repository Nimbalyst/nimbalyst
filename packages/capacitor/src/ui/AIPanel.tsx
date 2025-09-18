import React, { useEffect, useMemo, useRef, useState } from 'react';
import { sendStreamingEdit, sendStreamingEditWithProvider, type DocumentContext, AISessionsRepository, type ChatMessage } from '@stravu/runtime';
import { getSettings, updateAISettings } from './aiSettingsStore';
import { ToolExecutor, toolRegistry } from '@stravu/runtime';
import { AIModelsSheet } from './AIModelsSheet';
import { ModelPicker } from './ModelPicker';
import { OpenAIIcon, ClaudeIcon, LMStudioIcon } from './ProviderIcons';
import { SessionDropdown } from './SessionDropdown';

interface AIPanelProps {
  open: boolean;
  onClose: () => void;
  document?: DocumentContext;
  workspaceId: string;
}

export function AIPanel({ open, onClose, document, workspaceId }: AIPanelProps) {
  const [prompt, setPrompt] = useState('Continue writing this section.');
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const [endpoint, setEndpoint] = useState<string>('/api/ai/stream');
  const [provider, setProvider] = useState<'anthropic' | 'openai' | 'lmstudio'>('lmstudio');
  const [model, setModel] = useState<string>('gpt-4o-mini');
  const [baseUrl, setBaseUrl] = useState<string>('/lmstudio/v1');
  const [apiKey, setApiKey] = useState<string>('');
  // settings gear removed from toolbar; configuration lives in ModelPicker popover
  const [showModels, setShowModels] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [showSessions, setShowSessions] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<{ role: 'user'|'assistant'; content: string; id: string }[]>([]);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [sessionId, setSessionId] = useState<string>(() => `sess_${Date.now()}`);
  const assistantBuffer = useRef<string>('');

  useEffect(() => {
    (async () => {
      const s = await getSettings();
      const ai = s.ai || ({} as any);
      const prov = ai.defaultProvider || ai.provider;
      if (prov) setProvider(prov);
      if (ai.model) setModel(ai.model);
      if (ai.endpoint) setEndpoint(ai.endpoint);
      if (ai.baseUrl) setBaseUrl(ai.baseUrl);
      if (ai.apiKey) setApiKey(ai.apiKey);
      const p = ai.providers || ({} as any);
      if (prov && p[prov]?.selectedModels) {
        setAvailableModels(p[prov].selectedModels);
        if (!ai.model && p[prov].defaultModel) setModel(p[prov].defaultModel);
      }
      const restoredId = ai.lastSessionId || sessionId;
      setSessionId(restoredId);
      if (!ai.lastSessionId) await updateAISettings({ lastSessionId: restoredId });
      const sess = await AISessionsRepository.get(restoredId);
      if (sess?.messages?.length) {
        const simplified = sess.messages
          .filter((m: ChatMessage) => m.role === 'user' || m.role === 'assistant')
          .map((m: ChatMessage, i: number) => ({ role: m.role as 'user' | 'assistant', content: m.content, id: `m_${i}_${m.role[0]}` }));
        setMessages(simplified);
      }
    })();
  }, []);
  useEffect(() => {
    // Helpful defaults: when switching to LM Studio and no baseUrl set, use the dev proxy
    if (provider === 'lmstudio' && !baseUrl) setBaseUrl('/lmstudio/v1');
    (async () => {
      const s = await getSettings();
      const p = s.ai.providers || ({} as any);
      const list: string[] = (p[provider]?.selectedModels) || [];
      setAvailableModels(list);
      if (list.length && !list.includes(model)) setModel(p[provider]?.defaultModel || list[0]);
    })();
  }, [provider]);
  useEffect(() => {
    void updateAISettings({ provider, model, endpoint, baseUrl, apiKey, lastSessionId: sessionId });
  }, [provider, model, endpoint, baseUrl, apiKey, sessionId]);

  useEffect(() => {
    if (!open) {
      setBusy(false);
      setExpanded(false);
    }
  }, [open]);

  const onSend = async () => {
    if (!document) { console.warn('[ai] onSend: no document'); setError('Open a document to stream edits.'); return; }
    if (busy) { console.warn('[ai] onSend: already busy'); return; }
    setBusy(true); setExpanded(true); setError(null);
    const ac = new AbortController(); abortRef.current = ac;
    const timeoutId = setTimeout(() => { try { ac.abort(); } catch {} }, 90000);
    try {
      await AISessionsRepository.create({
        id: sessionId,
        provider,
        model,
        workspaceId,
        documentContext: document ? { filePath: document.filePath, fileType: document.fileType, content: document.content } : undefined,
      }).catch(() => {});
      await AISessionsRepository.appendMessage(sessionId, { role: 'user', content: prompt, timestamp: Date.now() });
      const userMsgId = `m_${Date.now()}_u`;
      const asstMsgId = `m_${Date.now()}_a`;
      setMessages((m) => [...m, { role: 'user', id: userMsgId, content: prompt }, { role: 'assistant', id: asstMsgId, content: '' }]);
      const history = messages.map(m => ({ role: m.role, content: m.content }));
      assistantBuffer.current = '';
      const callbacks = {
        onContent: (chunk: string) => {
          assistantBuffer.current += chunk;
          setMessages((m) => m.map(msg => msg.id === asstMsgId ? { ...msg, content: msg.content + chunk } : msg));
        },
        onEnd: async () => {
          const assistant = assistantBuffer.current; assistantBuffer.current = '';
          if (assistant) await AISessionsRepository.appendMessage(sessionId, { role: 'assistant', content: assistant, timestamp: Date.now() });
        }
      };
      if (provider === 'lmstudio') {
        console.log('[ai] LMStudio stream', { baseUrl, model });
        await sendStreamingEditWithProvider({ provider, prompt, document, apiKey: apiKey || '', baseUrl, model, history }, { signal: ac.signal, callbacks });
      } else if (endpoint && endpoint !== '/api/ai/stream') {
        await sendStreamingEdit({ endpoint, prompt, document, headers: {}, apiKey: apiKey || undefined }, { signal: ac.signal, callbacks });
      } else {
        await sendStreamingEditWithProvider({ provider, prompt, document, apiKey: apiKey || '', model, history }, { signal: ac.signal, callbacks });
      }
    } catch (e: any) {
      console.error('[ai] send failed', e);
      setError(e?.message || 'AI request failed');
    } finally {
      clearTimeout(timeoutId);
      setBusy(false); setExpanded(false);
    }
  };

  const onCancel = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
      setBusy(false);
      setExpanded(false);
    }
  };

  if (!open) return null;

  useEffect(() => {
    const handler = async () => {
      const newId = `sess_${Date.now()}`;
      setSessionId(newId);
      setMessages([]);
      await AISessionsRepository.create({
        id: newId,
        provider,
        model,
        workspaceId,
      }).catch(() => {});
      await updateAISettings({ lastSessionId: newId });
    };
    window.addEventListener('ai:new-conversation', handler as any);
    return () => window.removeEventListener('ai:new-conversation', handler as any);
  }, [provider, model]);

  return (
    <div className="ai-wrapper">
      <div className="ai-panel" style={{ width: '100%', overflow: 'hidden' }}>
        {/* History above prompt */}
        {messages.length > 0 && (
          <div className="ai-messages">
            {messages.map((m) => (
              <div key={m.id} style={{ margin: '6px 0', display: 'flex', justifyContent: m.role==='user' ? 'flex-end' : 'flex-start' }}>
                <div className={`bubble ${m.role==='user' ? 'user' : ''}`}>
                  <pre style={{ margin: 0, whiteSpace: 'pre-wrap', font: '12px/1.4 ui-sans-serif, system-ui' }}>{m.content}</pre>
                </div>
              </div>
            ))}
            <ToolEventsView />
          </div>
        )}
        <div className="ai-toolbar">
          {/* Big screens: chip above prompt */}
          <button className="chip ai-chip" title={`${provider.toUpperCase()} • ${model}`} onClick={() => setShowModelPicker(true)}>
            {provider === 'anthropic' ? <ClaudeIcon size={16} /> : provider === 'openai' ? <OpenAIIcon size={16} /> : <LMStudioIcon size={16} />}
            <span style={{ fontSize: 12 }}>{provider.toUpperCase()} • {model}</span>
          </button>
          {/* Small screens: icon only */}
          <button className="icon-btn provider-icon-btn" title={`${provider.toUpperCase()} • ${model}`} onClick={() => setShowModelPicker(true)}>
            {provider === 'anthropic' ? <ClaudeIcon size={16} /> : provider === 'openai' ? <OpenAIIcon size={16} /> : <LMStudioIcon size={16} />}
          </button>

          {/* Prompt input */}
          <textarea
            className="prompt-input"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); } }}
            rows={1}
            placeholder="Ask AI to edit… (Enter to send, Shift+Enter newline)"
          />
          {/* Actions */}
          <button className="icon-btn" onClick={() => setShowSessions(true)} title="Sessions"><span className="material-symbols-rounded">history</span></button>
          {busy ? (
            <button className="icon-btn" onClick={onCancel} title="Cancel"><span className="material-symbols-rounded">stop_circle</span></button>
          ) : (
            <button className="icon-btn" onClick={onSend} title="Send" disabled={busy || !document}><span className="material-symbols-rounded">send</span></button>
          )}
        </div>
        {/* Settings moved to Configure Models dialog */}
        {expanded && (
          <div style={{ padding: 8, borderTop: '1px solid #e5e7eb' }}>
            <div className="muted">{busy ? 'Streaming into document… you can keep editing.' : 'Done.'}</div>
            {error && <div style={{ color: '#b91c1c', marginTop: 6 }}>{error}</div>}
          </div>
        )}
      </div>
      <AIModelsSheet open={showModels} onClose={() => setShowModels(false)} />
      <SessionDropdown
        open={showSessions}
        onClose={() => setShowSessions(false)}
        workspaceId={workspaceId}
        onSelect={async (id) => {
        const sess = await AISessionsRepository.get(id);
        if (sess) {
          setSessionId(id);
          setProvider(sess.provider as any);
          setModel(sess.model);
          const simplified = (sess.messages || [])
            .filter((m: ChatMessage) => m.role === 'user' || m.role === 'assistant')
            .map((m: ChatMessage, i: number) => ({ role: m.role as 'user' | 'assistant', content: m.content, id: `m_${i}_${m.role[0]}` }));
          setMessages(simplified);
          await updateAISettings({ lastSessionId: id, provider: sess.provider as any, model: sess.model });
        }
        }}
      />
      <ModelPicker
        open={showModelPicker}
        onClose={() => setShowModelPicker(false)}
        currentProvider={provider}
        currentModel={model}
        onSelect={async (prov, mdl) => { 
          setProvider(prov); setModel(mdl);
          await updateAISettings({
            provider: prov,
            model: mdl,
            defaultProvider: prov,
            providers: { [prov]: { defaultModel: mdl } } as any,
          });
        }}
        onConfigure={() => { setShowModelPicker(false); setShowModels(true); }}
      />
    </div>
  );
}

type ToolEventEntry = {
  id: string;
  name: string;
  args: any;
  result?: any;
  error?: string;
};

function ToolEventsView() {
  const [events, setEvents] = useState<ToolEventEntry[]>([]);
  useEffect(() => {
    const handler = (e: any) => {
      const detail = e.detail || {};
      setEvents((prev) => [...prev, {
        id: `t_${Date.now()}`,
        name: detail.name,
        args: detail.args,
        result: detail.result,
        error: detail.result?.error || detail.error
      }]);
    };
    window.addEventListener('aiToolCall' as any, handler as any);
    return () => window.removeEventListener('aiToolCall' as any, handler as any);
  }, []);
  if (!events.length) return null;
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {events.map(ev => (
        <div key={ev.id} style={{ background: 'var(--stravu-bg-secondary, #fff)', border: '1px solid var(--stravu-editor-border, #e5e7eb)', borderRadius: 10, padding: 8 }}>
          <div className="flex items-center justify-between" style={{ gap: 8 }}>
            <div className="muted">
              Using tool: {ev.name}
              {ev.error && <span style={{ marginLeft: 6, color: '#b91c1c' }}>Error: {ev.error}</span>}
            </div>
            {ev.name === 'applyDiff' && !ev.error && (
              <div className="flex gap-2">
                <button className="btn" onClick={async () => { try { await ToolExecutor.execute('applyDiff', ev.args); } catch (e) { console.error('reapply failed', e);} }}>Accept</button>
                <button className="btn" onClick={async () => {
                  try {
                    const reversed = {
                      replacements: (ev.args?.replacements || []).map((r: any) => ({ oldText: r.newText, newText: r.oldText }))
                    };
                    await ToolExecutor.execute('applyDiff', reversed);
                  } catch (e) { console.error('reject failed', e); }
                }}>Reject</button>
              </div>
            )}
          </div>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', font: '12px/1.4 ui-sans-serif, system-ui' }}>{JSON.stringify(ev.args, null, 2)}</pre>
          {ev.result && !ev.error && (
            <pre style={{ marginTop: 4, whiteSpace: 'pre-wrap', font: '11px/1.4 ui-sans-serif, system-ui', color: '#4b5563' }}>{JSON.stringify(ev.result, null, 2)}</pre>
          )}
        </div>
      ))}
    </div>
  );
}
