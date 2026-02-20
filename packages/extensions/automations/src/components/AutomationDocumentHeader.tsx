/**
 * AutomationDocumentHeader - Compact schedule controls above the editor.
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { AutomationStatus, AutomationSchedule, DayOfWeek, ScheduleType } from '../frontmatter/types';

interface AIModel {
  id: string;
  name: string;
  provider: string;
}

import { ALL_DAYS, DAY_LABELS } from '../frontmatter/types';
import { parseAutomationStatus, updateAutomationStatus } from '../frontmatter/parser';
import { formatSchedule, formatRelativeTime, calculateNextRun } from '../scheduler/scheduleUtils';

/** Discover output files for an automation and allow opening them. */
function useOutputFiles(outputLocation: string | undefined) {
  const [files, setFiles] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    if (!outputLocation) return;
    const electronAPI = (window as any).electronAPI;
    if (!electronAPI) return;
    try {
      // Get workspace path to resolve relative output location
      const state = await electronAPI.getInitialState();
      const wp = state?.workspacePath;
      if (!wp) return;
      const absDir = outputLocation.startsWith('/') ? outputLocation : `${wp}/${outputLocation}`;
      const contents = await electronAPI.getFolderContents(absDir);
      if (contents?.children) {
        // Sort by name descending (newest date first for YYYY-MM-DD names)
        const mdFiles = contents.children
          .filter((c: any) => c.name?.endsWith('.md'))
          .map((c: any) => c.path as string)
          .sort((a: string, b: string) => b.localeCompare(a));
        setFiles(mdFiles);
      }
    } catch {
      // Output directory may not exist yet
      setFiles([]);
    }
  }, [outputLocation]);

  useEffect(() => { refresh(); }, [refresh]);

  const openFile = useCallback((filePath: string) => {
    const electronAPI = (window as any).electronAPI;
    if (electronAPI?.switchWorkspaceFile) {
      electronAPI.switchWorkspaceFile(filePath);
    }
  }, []);

  return { files, openFile, refresh };
}

interface DocumentHeaderComponentProps {
  filePath: string;
  fileName: string;
  getContent: () => string;
  contentVersion: number;
  onContentChange?: (newContent: string) => void;
  editor?: unknown;
}

let runNowCallback: ((filePath: string) => void) | null = null;
export function setRunNowCallback(cb: (filePath: string) => void): void {
  runNowCallback = cb;
}

export const AutomationDocumentHeader: React.FC<DocumentHeaderComponentProps> = ({
  filePath,
  getContent,
  contentVersion,
  onContentChange,
}) => {
  const [status, setStatus] = useState<AutomationStatus | null>(null);
  const [availableModels, setAvailableModels] = useState<AIModel[]>([]);

  useEffect(() => {
    const electronAPI = (window as any).electronAPI;
    if (!electronAPI?.aiGetModels) return;
    electronAPI.aiGetModels().then((response: any) => {
      if (response?.success && response.grouped) {
        const models: AIModel[] = [];
        for (const [provider, providerModels] of Object.entries(response.grouped)) {
          for (const m of providerModels as any[]) {
            models.push({ id: m.id, name: m.name, provider });
          }
        }
        setAvailableModels(models);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const content = getContent();
    const parsed = parseAutomationStatus(content);
    setStatus(parsed);
  }, [getContent, contentVersion]);

  const handleUpdate = useCallback(
    (updates: Partial<AutomationStatus>) => {
      if (!onContentChange) return;
      const content = getContent();
      const updated = updateAutomationStatus(content, updates);
      onContentChange(updated);
    },
    [getContent, onContentChange],
  );

  const handleToggleEnabled = useCallback(() => {
    if (!status) return;
    const nextRun = !status.enabled ? calculateNextRun(status.schedule)?.toISOString() : undefined;
    handleUpdate({ enabled: !status.enabled, nextRun });
  }, [status, handleUpdate]);

  const handleScheduleTypeChange = useCallback(
    (type: ScheduleType) => {
      if (!status) return;
      let schedule: AutomationSchedule;
      const prevTime = (status.schedule as any).time ?? '09:00';
      switch (type) {
        case 'interval':
          schedule = { type: 'interval', intervalMinutes: 60 };
          break;
        case 'daily':
          schedule = { type: 'daily', time: prevTime };
          break;
        case 'weekly':
          schedule = { type: 'weekly', days: ['mon', 'tue', 'wed', 'thu', 'fri'], time: prevTime };
          break;
      }
      const nextRun = status.enabled ? calculateNextRun(schedule)?.toISOString() : undefined;
      handleUpdate({ schedule, nextRun });
    },
    [status, handleUpdate],
  );

  const handleDayToggle = useCallback(
    (day: DayOfWeek) => {
      if (!status || status.schedule.type !== 'weekly') return;
      const days = status.schedule.days.includes(day)
        ? status.schedule.days.filter((d) => d !== day)
        : [...status.schedule.days, day];
      if (days.length === 0) return;
      const schedule: AutomationSchedule = { type: 'weekly', days, time: status.schedule.time };
      const nextRun = status.enabled ? calculateNextRun(schedule)?.toISOString() : undefined;
      handleUpdate({ schedule, nextRun });
    },
    [status, handleUpdate],
  );

  const handleTimeChange = useCallback(
    (time: string) => {
      if (!status || status.schedule.type === 'interval') return;
      const schedule: AutomationSchedule = status.schedule.type === 'weekly'
        ? { type: 'weekly', days: status.schedule.days, time }
        : { type: 'daily', time };
      const nextRun = status.enabled ? calculateNextRun(schedule)?.toISOString() : undefined;
      handleUpdate({ schedule, nextRun });
    },
    [status, handleUpdate],
  );

  const handleModelChange = useCallback(
    (model: string) => {
      if (!status) return;
      const [provider] = model.split(':');
      const providerValue = (provider === 'claude-code' || provider === 'claude' || provider === 'openai')
        ? provider as 'claude-code' | 'claude' | 'openai'
        : undefined;
      handleUpdate({ model: model || undefined, provider: providerValue });
    },
    [status, handleUpdate],
  );

  const handleRunNow = useCallback(() => {
    if (runNowCallback) runNowCallback(filePath);
  }, [filePath]);

  const { files: outputFiles, openFile: openOutputFile, refresh: refreshOutputFiles } = useOutputFiles(status?.output?.location);
  const [showOutputs, setShowOutputs] = useState(false);
  const outputsRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!showOutputs) return;
    const handler = (e: MouseEvent) => {
      if (outputsRef.current && !outputsRef.current.contains(e.target as Node)) {
        setShowOutputs(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showOutputs]);

  // Refresh output files when dropdown opens
  const handleToggleOutputs = useCallback(() => {
    if (!showOutputs) refreshOutputFiles();
    setShowOutputs((v) => !v);
  }, [showOutputs, refreshOutputFiles]);

  if (!status) return null;

  const time = status.schedule.type !== 'interval'
    ? (status.schedule as { time: string }).time
    : '';

  return (
    <div className="automation-header">
      <div className="automation-header__row">
        {/* Icon */}
        <span className="material-symbols-outlined" style={{ fontSize: 18, color: 'var(--nim-primary, #60a5fa)', fontVariationSettings: "'FILL' 1" }}>auto_mode</span>

        {/* Enable toggle */}
        <button
          className={`automation-header__toggle ${status.enabled ? 'automation-header__toggle--active' : ''}`}
          onClick={handleToggleEnabled}
          aria-label={status.enabled ? 'Disable automation' : 'Enable automation'}
        >
          <span className="automation-header__toggle-knob" />
        </button>

        {/* Schedule type */}
        <div className="automation-header__segmented">
          {(['daily', 'weekly', 'interval'] as ScheduleType[]).map((t) => (
            <button
              key={t}
              className={`automation-header__seg-btn ${status.schedule.type === t ? 'automation-header__seg-btn--active' : ''}`}
              onClick={() => handleScheduleTypeChange(t)}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {/* Day chips (weekly only) */}
        {status.schedule.type === 'weekly' && (
          <div className="automation-header__day-picker">
            {ALL_DAYS.map((day) => (
              <button
                key={day}
                className={`automation-header__day-chip ${status.schedule.type === 'weekly' && status.schedule.days.includes(day) ? 'automation-header__day-chip--active' : ''}`}
                onClick={() => handleDayToggle(day)}
              >
                {DAY_LABELS[day]}
              </button>
            ))}
          </div>
        )}

        {/* Time input (daily/weekly) */}
        {status.schedule.type !== 'interval' && (
          <input
            type="time"
            className="automation-header__time-input"
            value={time}
            onChange={(e) => handleTimeChange(e.target.value)}
          />
        )}

        {/* Interval input */}
        {status.schedule.type === 'interval' && (
          <div className="automation-header__interval">
            <span className="automation-header__dim">every</span>
            <input
              type="number"
              className="automation-header__interval-input"
              min={1}
              value={status.schedule.intervalMinutes}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                if (!isNaN(val) && val > 0) {
                  handleUpdate({ schedule: { type: 'interval', intervalMinutes: val } });
                }
              }}
            />
            <span className="automation-header__dim">min</span>
          </div>
        )}

        <div className="automation-header__spacer" />

        {/* Model selector */}
        <select
          className="automation-header__model-select"
          value={status.model || ''}
          onChange={(e) => handleModelChange(e.target.value)}
        >
          <option value="">Default model</option>
          {availableModels.length > 0 && (
            Object.entries(
              availableModels.reduce<Record<string, AIModel[]>>((acc, m) => {
                if (!acc[m.provider]) acc[m.provider] = [];
                acc[m.provider].push(m);
                return acc;
              }, {})
            ).map(([provider, models]) => (
              <optgroup key={provider} label={
                provider === 'claude-code' ? 'Agent' :
                provider === 'claude' ? 'Chat' :
                provider === 'openai' ? 'OpenAI' : provider
              }>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </optgroup>
            ))
          )}
        </select>

        {/* Status info */}
        {status.lastRun && (
          <span className="automation-header__status-text">
            <span className="material-symbols-outlined" style={{
              fontSize: 14,
              color: status.lastRunStatus === 'success' ? 'var(--nim-success, #4ade80)' :
                     status.lastRunStatus === 'error' ? 'var(--nim-error, #ef4444)' :
                     'var(--nim-text-faint, #808080)',
            }}>
              {status.lastRunStatus === 'success' ? 'check_circle' : status.lastRunStatus === 'error' ? 'error' : 'schedule'}
            </span>
            {formatRelativeTime(status.lastRun)}
          </span>
        )}

        {/* Outputs dropdown */}
        {(status.runCount > 0 || outputFiles.length > 0) && (
          <div className="automation-header__outputs" ref={outputsRef}>
            <button className="automation-header__outputs-btn" onClick={handleToggleOutputs}>
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>folder_open</span>
              {outputFiles.length > 0 ? `${outputFiles.length} outputs` : `${status.runCount} runs`}
              <span className="material-symbols-outlined" style={{ fontSize: 12 }}>
                {showOutputs ? 'expand_less' : 'expand_more'}
              </span>
            </button>
            {showOutputs && outputFiles.length > 0 && (
              <div className="automation-header__outputs-dropdown">
                {outputFiles.map((f) => {
                  const name = f.split('/').pop() || f;
                  return (
                    <button
                      key={f}
                      className="automation-header__output-item"
                      onClick={() => { openOutputFile(f); setShowOutputs(false); }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 14 }}>description</span>
                      {name}
                    </button>
                  );
                })}
              </div>
            )}
            {showOutputs && outputFiles.length === 0 && (
              <div className="automation-header__outputs-dropdown">
                <div className="automation-header__output-empty">No output files yet</div>
              </div>
            )}
          </div>
        )}

        {/* Run Now */}
        <button className="automation-header__run-btn" onClick={handleRunNow}>
          <span className="material-symbols-outlined" style={{ fontSize: 15 }}>play_arrow</span>
          Run
        </button>
      </div>
    </div>
  );
};
