import { useEffect, useRef } from 'react';
import type { OperationLogEntry } from '../hooks/useOperationLog';

interface OutputTabProps {
  entries: OperationLogEntry[];
  onClear: () => void;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function EntryRow({ entry }: { entry: OperationLogEntry }) {
  const borderClass =
    entry.status === 'error' ? 'git-output-entry--error' :
    entry.status === 'running' ? 'git-output-entry--running' :
    'git-output-entry--success';

  return (
    <div className={`git-output-entry ${borderClass}`}>
      <div className="git-output-entry-header">
        <span className="git-output-timestamp">{formatTime(entry.timestamp)}</span>
        <code className="git-output-command">{entry.command}</code>
      </div>

      {entry.output && (
        <div className="git-output-lines">
          {entry.output.split('\n').filter(Boolean).map((line, i) => (
            <div key={i} className="git-output-line">&gt; {line}</div>
          ))}
        </div>
      )}

      {entry.error && (
        <div className="git-output-lines git-output-lines--error">
          {entry.error.split('\n').filter(Boolean).map((line, i) => (
            <div key={i} className="git-output-line">&gt; {line}</div>
          ))}
        </div>
      )}

      {entry.status === 'success' && (
        <div className="git-output-status git-output-status--success">
          &#10003; Completed{entry.durationMs != null ? ` in ${formatDuration(entry.durationMs)}` : ''}
        </div>
      )}

      {entry.status === 'error' && (
        <div className="git-output-status git-output-status--error">
          &#10007; Failed{entry.durationMs != null ? ` after ${formatDuration(entry.durationMs)}` : ''}
        </div>
      )}

      {entry.status === 'running' && (
        <div className="git-output-status git-output-status--running">
          <span className="git-output-spinner" /> Running...
        </div>
      )}

      {entry.suggestion && (
        <div className="git-output-suggestion">
          Suggestion: {entry.suggestion}
        </div>
      )}
    </div>
  );
}

export function OutputTab({ entries, onClear }: OutputTabProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new entries appear
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries.length]);

  if (entries.length === 0) {
    return (
      <div className="git-output-empty">
        <span>No operations recorded yet.</span>
        <span className="git-output-empty-hint">Push, pull, fetch, and commit operations will appear here.</span>
      </div>
    );
  }

  return (
    <div className="git-output-tab">
      <div className="git-output-scroll" ref={scrollRef}>
        {entries.map(entry => (
          <EntryRow key={entry.id} entry={entry} />
        ))}
      </div>
      <div className="git-output-footer">
        <button className="git-output-clear-btn" onClick={onClear}>
          Clear Log
        </button>
      </div>
    </div>
  );
}
