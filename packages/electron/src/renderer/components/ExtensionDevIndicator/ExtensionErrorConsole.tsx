import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';
import './ExtensionErrorConsole.css';

type LogLevel = 'error' | 'warn' | 'info' | 'debug';
type LogSource = 'renderer' | 'main' | 'build';

interface ExtensionLogEntry {
  timestamp: number;
  level: LogLevel;
  source: LogSource;
  extensionId?: string;
  message: string;
  stack?: string;
  line?: number;
  sourceFile?: string;
}

interface ExtensionErrorConsoleProps {
  isOpen: boolean;
  onClose: () => void;
}

const LOG_LEVEL_ICONS: Record<LogLevel, string> = {
  error: 'error',
  warn: 'warning',
  info: 'info',
  debug: 'bug_report',
};

const LOG_LEVEL_COLORS: Record<LogLevel, string> = {
  error: 'var(--color-error)',
  warn: 'var(--color-warning)',
  info: 'var(--color-info)',
  debug: 'var(--text-tertiary)',
};

interface InstalledExtension {
  id: string;
  name: string;
  enabled: boolean;
}

export const ExtensionErrorConsole: React.FC<ExtensionErrorConsoleProps> = ({
  isOpen,
  onClose,
}) => {
  const [logs, setLogs] = useState<ExtensionLogEntry[]>([]);
  const [installedExtensions, setInstalledExtensions] = useState<InstalledExtension[]>([]);
  const [stats, setStats] = useState<{
    totalEntries: number;
    byLevel: Record<LogLevel, number>;
  } | null>(null);
  const [filter, setFilter] = useState<{
    logLevel: LogLevel | 'all';
    source: LogSource | 'all';
    extensionId: string;
  }>({
    logLevel: 'all',
    source: 'all',
    extensionId: '',
  });
  const [expandedLogs, setExpandedLogs] = useState<Set<number>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Fetch installed extensions on open
  useEffect(() => {
    if (!isOpen) return;

    const fetchExtensions = async () => {
      try {
        const extensions = await window.electronAPI.extensions.listInstalled();
        setInstalledExtensions(extensions || []);
      } catch (error) {
        console.error('[ExtensionErrorConsole] Failed to fetch extensions:', error);
      }
    };

    fetchExtensions();
  }, [isOpen]);

  const fetchLogs = useCallback(async () => {
    if (!isOpen) return;

    setIsLoading(true);
    try {
      const result = await window.electronAPI.extensionDevTools.getLogs({
        logLevel: filter.logLevel,
        source: filter.source,
        extensionId: filter.extensionId || undefined,
        lastSeconds: 300, // 5 minutes
      });
      setLogs(result.logs);
      setStats(result.stats);
    } catch (error) {
      console.error('[ExtensionErrorConsole] Failed to fetch logs:', error);
    } finally {
      setIsLoading(false);
    }
  }, [isOpen, filter]);

  // Fetch logs on open and when filter changes
  useEffect(() => {
    if (isOpen) {
      fetchLogs();
    }
  }, [isOpen, fetchLogs]);

  // Auto-refresh every 2 seconds
  useEffect(() => {
    if (!isOpen || !autoRefresh) return;

    const interval = setInterval(fetchLogs, 2000);
    return () => clearInterval(interval);
  }, [isOpen, autoRefresh, fetchLogs]);

  const handleClearLogs = async () => {
    try {
      await window.electronAPI.extensionDevTools.clearLogs(
        filter.extensionId || undefined
      );
      await fetchLogs();
    } catch (error) {
      console.error('[ExtensionErrorConsole] Failed to clear logs:', error);
    }
  };

  const toggleExpand = (index: number) => {
    setExpandedLogs((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  // Combine installed extensions with any extension IDs found in logs
  // This ensures we show both installed extensions AND any dev extensions that have logs
  const allExtensionOptions = useMemo(() => {
    const extensionMap = new Map<string, { id: string; name: string }>();

    // Add installed extensions
    for (const ext of installedExtensions) {
      if (ext.id) {
        extensionMap.set(ext.id, { id: ext.id, name: ext.name || ext.id });
      }
    }

    // Add any extension IDs from logs that aren't already in the map
    for (const log of logs) {
      if (log.extensionId && !extensionMap.has(log.extensionId)) {
        extensionMap.set(log.extensionId, { id: log.extensionId, name: log.extensionId });
      }
    }

    return Array.from(extensionMap.values()).sort((a, b) =>
      (a.name || a.id).localeCompare(b.name || b.id)
    );
  }, [installedExtensions, logs]);

  if (!isOpen) return null;

  return (
    <div className="extension-error-console-overlay" onClick={onClose}>
      <div
        className="extension-error-console"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="extension-error-console-header">
          <h2>Extension Logs</h2>
          <div className="extension-error-console-stats">
            {stats && (
              <>
                <span className="stat stat-error">
                  <MaterialSymbol icon="error" size={14} />
                  {stats.byLevel.error}
                </span>
                <span className="stat stat-warn">
                  <MaterialSymbol icon="warning" size={14} />
                  {stats.byLevel.warn}
                </span>
                <span className="stat stat-info">
                  <MaterialSymbol icon="info" size={14} />
                  {stats.byLevel.info}
                </span>
              </>
            )}
          </div>
          <button
            className="extension-error-console-close"
            onClick={onClose}
            aria-label="Close"
          >
            <MaterialSymbol icon="close" size={20} />
          </button>
        </div>

        <div className="extension-error-console-toolbar">
          <div className="extension-error-console-filters">
            <select
              value={filter.logLevel}
              onChange={(e) =>
                setFilter((f) => ({
                  ...f,
                  logLevel: e.target.value as LogLevel | 'all',
                }))
              }
              aria-label="Filter by level"
            >
              <option value="all">All Levels</option>
              <option value="error">Errors</option>
              <option value="warn">Warnings</option>
              <option value="info">Info</option>
              <option value="debug">Debug</option>
            </select>

            <select
              value={filter.source}
              onChange={(e) =>
                setFilter((f) => ({
                  ...f,
                  source: e.target.value as LogSource | 'all',
                }))
              }
              aria-label="Filter by source"
            >
              <option value="all">All Sources</option>
              <option value="renderer">Renderer</option>
              <option value="main">Main</option>
              <option value="build">Build</option>
            </select>

            <select
              value={filter.extensionId}
              onChange={(e) =>
                setFilter((f) => ({ ...f, extensionId: e.target.value }))
              }
              aria-label="Filter by extension"
            >
              <option value="">All Extensions</option>
              {allExtensionOptions.map((ext) => (
                <option key={ext.id} value={ext.id}>
                  {ext.name}
                </option>
              ))}
            </select>
          </div>

          <div className="extension-error-console-actions">
            <label className="auto-refresh-toggle">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
              />
              Auto-refresh
            </label>
            <button
              className="toolbar-button"
              onClick={fetchLogs}
              disabled={isLoading}
              title="Refresh"
            >
              <MaterialSymbol icon="refresh" size={18} />
            </button>
            <button
              className="toolbar-button"
              onClick={handleClearLogs}
              title="Clear logs"
            >
              <MaterialSymbol icon="delete" size={18} />
            </button>
          </div>
        </div>

        <div className="extension-error-console-logs">
          {logs.length === 0 ? (
            <div className="extension-error-console-empty">
              <MaterialSymbol icon="check_circle" size={48} />
              <p>No logs to display</p>
              <p className="hint">
                Extension logs will appear here when extensions emit console
                messages or errors.
              </p>
            </div>
          ) : (
            logs.map((log, index) => (
              <div
                key={`${log.timestamp}-${index}`}
                className={`log-entry log-${log.level} ${
                  expandedLogs.has(index) ? 'expanded' : ''
                }`}
                onClick={() => log.stack && toggleExpand(index)}
              >
                <div className="log-entry-header">
                  <MaterialSymbol
                    icon={LOG_LEVEL_ICONS[log.level]}
                    size={16}
                    style={{ color: LOG_LEVEL_COLORS[log.level] }}
                  />
                  <span className="log-time">{formatTime(log.timestamp)}</span>
                  <span className="log-source">[{log.source}]</span>
                  {log.extensionId && (
                    <button
                      className="log-extension"
                      onClick={(e) => {
                        e.stopPropagation();
                        setFilter((f) => ({ ...f, extensionId: log.extensionId! }));
                      }}
                      title={`Filter by ${log.extensionId}`}
                    >
                      {log.extensionId}
                    </button>
                  )}
                  <span className="log-message">{log.message}</span>
                  {log.stack && (
                    <MaterialSymbol
                      icon={expandedLogs.has(index) ? 'expand_less' : 'expand_more'}
                      size={16}
                      className="log-expand-icon"
                    />
                  )}
                </div>
                {expandedLogs.has(index) && log.stack && (
                  <pre className="log-stack">{log.stack}</pre>
                )}
                {log.sourceFile && log.line && (
                  <div className="log-location">
                    {log.sourceFile}:{log.line}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
