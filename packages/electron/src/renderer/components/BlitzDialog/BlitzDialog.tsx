import React, { useState, useEffect, useCallback, useRef } from 'react';
import { getProviderIcon } from '@nimbalyst/runtime';
import { getClaudeCodeModelLabel } from '../../utils/modelUtils';

interface Model {
  id: string;
  name: string;
  provider: string;
}

interface ModelSelection {
  id: string;
  name: string;
  provider: string;
  checked: boolean;
  count: number;
}

export interface BlitzDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (result: any) => void;
  workspacePath: string;
}

export const BlitzDialog: React.FC<BlitzDialogProps> = ({
  isOpen,
  onClose,
  onCreated,
  workspacePath,
}) => {
  const [prompt, setPrompt] = useState('');
  const [modelSelections, setModelSelections] = useState<ModelSelection[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load available models on mount
  useEffect(() => {
    if (!isOpen) return;

    const loadModels = async () => {
      setLoading(true);
      try {
        const response = await window.electronAPI.aiGetModels();
        if (response.success && response.grouped) {
          const selections: ModelSelection[] = [];

          // Only show agent-type providers (claude-code, openai-codex)
          for (const [provider, models] of Object.entries(response.grouped as Record<string, Model[]>)) {
            if (provider === 'claude-code' || provider === 'openai-codex') {
              for (const model of models) {
                selections.push({
                  id: model.id,
                  name: model.name,
                  provider: model.provider || provider,
                  checked: false,
                  count: 1,
                });
              }
            }
          }

          // Check the first model by default
          if (selections.length > 0) {
            selections[0].checked = true;
          }

          setModelSelections(selections);
        }
      } catch (err) {
        console.error('[BlitzDialog] Failed to load models:', err);
        setError('Failed to load available models');
      } finally {
        setLoading(false);
      }
    };

    loadModels();

    // Focus textarea after a short delay for animation
    setTimeout(() => textareaRef.current?.focus(), 100);
  }, [isOpen]);

  // Reset state when dialog closes
  useEffect(() => {
    if (!isOpen) {
      setPrompt('');
      setError(null);
      setCreating(false);
    }
  }, [isOpen]);

  const toggleModel = useCallback((modelId: string) => {
    setModelSelections(prev => prev.map(m =>
      m.id === modelId ? { ...m, checked: !m.checked } : m
    ));
  }, []);

  const updateCount = useCallback((modelId: string, count: number) => {
    const clamped = Math.max(1, Math.min(5, count));
    setModelSelections(prev => prev.map(m =>
      m.id === modelId ? { ...m, count: clamped } : m
    ));
  }, []);

  const selectedModels = modelSelections.filter(m => m.checked);
  const totalWorktrees = selectedModels.reduce((sum, m) => sum + m.count, 0);
  const isValid = prompt.trim().length > 0 && selectedModels.length > 0 && totalWorktrees <= 10;

  const getModelDisplayName = (model: ModelSelection): string => {
    // Use claude code label for claude-code models
    if (model.provider === 'claude-code') {
      return getClaudeCodeModelLabel(model.id);
    }
    return model.name;
  };

  const handleSubmit = useCallback(async () => {
    if (!isValid || creating) return;

    setCreating(true);
    setError(null);

    try {
      const modelConfig = selectedModels.map(m => ({
        provider: m.provider,
        model: m.id,
        count: m.count,
      }));

      const result = await window.electronAPI.invoke('blitz:create', {
        workspacePath,
        prompt: prompt.trim(),
        modelConfig,
      });

      if (result.success) {
        onCreated(result);
        onClose();
      } else {
        setError(result.error || 'Failed to create blitz');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create blitz');
    } finally {
      setCreating(false);
    }
  }, [isValid, creating, selectedModels, workspacePath, prompt, onCreated, onClose]);

  // Handle Cmd+Enter for submit within the modal
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.metaKey && isValid && !creating) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit, isValid, creating]);

  // Global Escape handler (document-level so it works regardless of focus)
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="nim-overlay backdrop-blur-sm bg-black/60"
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      <div
        className="nim-modal w-[90%] max-w-[520px] animate-[worktree-modal-appear_0.2s_ease]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-6 pt-5 pb-4 border-b border-[var(--nim-border)]">
          <svg width="20" height="20" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-[var(--nim-primary)]">
            <path d="M9 2L4 9h4l-1 5 5-7H8l1-5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="currentColor" fillOpacity="0.15"/>
          </svg>
          <h2 className="m-0 text-[18px] font-semibold text-[var(--nim-text)]">New Blitz</h2>
        </div>

        {/* Body */}
        <div className="px-6 py-5 flex flex-col gap-5">
          {/* Prompt */}
          <div className="flex flex-col gap-2">
            <label className="text-[13px] font-medium text-[var(--nim-text-muted)]">Prompt</label>
            <textarea
              ref={textareaRef}
              className="w-full p-3 text-[14px] bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] rounded-lg text-[var(--nim-text)] resize-none outline-none focus:border-[var(--nim-primary)] transition-colors placeholder:text-[var(--nim-text-faint)]"
              rows={4}
              placeholder="Enter the prompt to run across all sessions..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={creating}
            />
          </div>

          {/* Models */}
          <div className="flex flex-col gap-2">
            <label className="text-[13px] font-medium text-[var(--nim-text-muted)]">Models</label>
            {loading ? (
              <div className="text-[13px] text-[var(--nim-text-faint)] py-3">Loading models...</div>
            ) : modelSelections.length === 0 ? (
              <div className="text-[13px] text-[var(--nim-text-faint)] py-3">No agent models available. Configure API keys in Settings.</div>
            ) : (
              <div className="flex flex-col gap-1 border border-[var(--nim-border)] rounded-lg overflow-hidden">
                {modelSelections.map(model => (
                  <label
                    key={model.id}
                    className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors ${
                      model.checked ? 'bg-[var(--nim-bg-secondary)]' : 'hover:bg-[var(--nim-bg-hover)]'
                    } ${creating ? 'opacity-50 pointer-events-none' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={model.checked}
                      onChange={() => toggleModel(model.id)}
                      className="shrink-0 accent-[var(--nim-primary)]"
                      disabled={creating}
                    />
                    <span className="shrink-0">{getProviderIcon(model.provider, { size: 14 })}</span>
                    <span className="flex-1 text-[13px] text-[var(--nim-text)] truncate">{getModelDisplayName(model)}</span>
                    <input
                      type="number"
                      min={1}
                      max={5}
                      value={model.count}
                      onChange={(e) => updateCount(model.id, parseInt(e.target.value) || 1)}
                      disabled={!model.checked || creating}
                      className={`w-12 px-1.5 py-1 text-center text-[13px] bg-[var(--nim-bg)] border border-[var(--nim-border)] rounded text-[var(--nim-text)] outline-none ${
                        !model.checked ? 'opacity-30' : ''
                      }`}
                    />
                  </label>
                ))}
              </div>
            )}

            {/* Total count */}
            {selectedModels.length > 0 && (
              <div className={`text-[12px] mt-1 ${totalWorktrees > 10 ? 'text-[var(--nim-error)]' : 'text-[var(--nim-text-faint)]'}`}>
                Total: {totalWorktrees} worktree{totalWorktrees !== 1 ? 's' : ''}
                {totalWorktrees > 10 && ' (maximum 10)'}
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="text-[13px] text-[var(--nim-error)] p-3 bg-[var(--nim-error)]/10 rounded-lg">{error}</div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-[var(--nim-border)]">
          <button
            className="nim-btn-secondary px-5 py-2 text-sm font-medium rounded-lg"
            onClick={onClose}
            disabled={creating}
          >
            Cancel
          </button>
          <button
            className="nim-btn-primary px-5 py-2 text-sm font-semibold rounded-lg flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleSubmit}
            disabled={!isValid || creating}
          >
            {creating ? (
              <>
                <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>
                Creating...
              </>
            ) : (
              `Start Blitz (${totalWorktrees} worktree${totalWorktrees !== 1 ? 's' : ''})`
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
