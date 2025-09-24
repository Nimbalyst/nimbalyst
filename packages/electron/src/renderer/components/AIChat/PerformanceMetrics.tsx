import React, { useState, useEffect } from 'react';
import './PerformanceMetrics.css';

interface MetricData {
  phase: 'start' | 'firstChunk' | 'complete' | 'error';
  provider?: string;
  model?: string;
  messageLength?: number;
  contextMessages?: number;
  timeToFirstChunk?: number;
  totalTime?: number;
  streamTime?: number;
  chunkCount?: number;
  textChunks?: number;
  toolCallCount?: number;
  responseLength?: number;
  errorTime?: number;
  error?: string;
  tokenUsage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
}

interface PerformanceMetricsProps {
  show: boolean;
}

export function PerformanceMetrics({ show }: PerformanceMetricsProps) {
  const [metrics, setMetrics] = useState<MetricData | null>(null);
  const [history, setHistory] = useState<MetricData[]>([]);

  useEffect(() => {
    const handleMetrics = (data: MetricData) => {
      console.log('[PerformanceMetrics] Received metrics:', data);
      
      if (data.phase === 'start') {
        // Reset for new request
        setMetrics(data);
      } else if (data.phase === 'complete' || data.phase === 'error') {
        // Add to history and update current
        setMetrics(prev => ({ ...prev, ...data }));
        setHistory(prev => {
          const newEntry = { ...metrics, ...data };
          // Keep only last 10 entries
          return [...prev.slice(-9), newEntry];
        });
      } else {
        // Update current metrics
        setMetrics(prev => ({ ...prev, ...data }));
      }
    };

    const unsubscribe = window.electronAPI.onAIPerformanceMetrics(handleMetrics);

    return () => {
      unsubscribe();
    };
  }, [metrics]);

  if (!show || !metrics) return null;

  const formatTime = (ms?: number) => {
    if (ms === undefined) return '-';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const formatSize = (bytes?: number) => {
    if (bytes === undefined) return '-';
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  };

  const getStatusColor = () => {
    if (metrics.phase === 'error') return 'var(--error-color)';
    if (metrics.phase === 'complete') return 'var(--success-color)';
    if (metrics.timeToFirstChunk) return 'var(--warning-color)';
    return 'var(--text-secondary)';
  };

  const avgTimeToFirstChunk = history.length > 0
    ? history.reduce((acc, m) => acc + (m.timeToFirstChunk || 0), 0) / history.filter(m => m.timeToFirstChunk).length
    : 0;

  const avgTotalTime = history.length > 0
    ? history.reduce((acc, m) => acc + (m.totalTime || 0), 0) / history.filter(m => m.totalTime).length
    : 0;

  const totalTokens = history.reduce((acc, m) => acc + (m.tokenUsage?.total_tokens || 0), 0);
  const avgTokensPerRequest = history.filter(m => m.tokenUsage).length > 0
    ? totalTokens / history.filter(m => m.tokenUsage).length
    : 0;

  return (
    <div className="performance-metrics">
      <div className="metrics-header">
        <span className="metrics-title">Performance</span>
        <span className="metrics-status" style={{ color: getStatusColor() }}>
          {metrics.phase === 'start' && '⏳ Starting...'}
          {metrics.phase === 'firstChunk' && '📡 Streaming...'}
          {metrics.phase === 'complete' && '✅ Complete'}
          {metrics.phase === 'error' && '❌ Error'}
        </span>
      </div>

      <div className="metrics-grid">
        <div className="metric-item">
          <span className="metric-label">Provider</span>
          <span className="metric-value">{metrics.provider || '-'}</span>
        </div>

        <div className="metric-item">
          <span className="metric-label">Model</span>
          <span className="metric-value">{metrics.model || '-'}</span>
        </div>

        <div className="metric-item">
          <span className="metric-label">Time to First</span>
          <span className="metric-value">{formatTime(metrics.timeToFirstChunk)}</span>
        </div>

        <div className="metric-item">
          <span className="metric-label">Total Time</span>
          <span className="metric-value">{formatTime(metrics.totalTime)}</span>
        </div>

        <div className="metric-item">
          <span className="metric-label">Chunks</span>
          <span className="metric-value">
            {metrics.chunkCount || '-'} ({metrics.textChunks || 0} text)
          </span>
        </div>

        <div className="metric-item">
          <span className="metric-label">Tool Calls</span>
          <span className="metric-value">{metrics.toolCallCount || 0}</span>
        </div>

        <div className="metric-item">
          <span className="metric-label">Input</span>
          <span className="metric-value">{formatSize(metrics.messageLength)}</span>
        </div>

        <div className="metric-item">
          <span className="metric-label">Output</span>
          <span className="metric-value">{formatSize(metrics.responseLength)}</span>
        </div>

        <div className="metric-item">
          <span className="metric-label">Context</span>
          <span className="metric-value">{metrics.contextMessages || 0} msgs</span>
        </div>

        {metrics.tokenUsage && (metrics.tokenUsage.input_tokens !== undefined || metrics.tokenUsage.output_tokens !== undefined) && (
          <>
            <div className="metric-item">
              <span className="metric-label">Input Tokens</span>
              <span className="metric-value">{(metrics.tokenUsage.input_tokens || 0).toLocaleString()}</span>
            </div>

            <div className="metric-item">
              <span className="metric-label">Output Tokens</span>
              <span className="metric-value">{(metrics.tokenUsage.output_tokens || 0).toLocaleString()}</span>
            </div>

            <div className="metric-item">
              <span className="metric-label">Total Tokens</span>
              <span className="metric-value">{(metrics.tokenUsage.total_tokens || 0).toLocaleString()}</span>
            </div>
          </>
        )}
      </div>

      {history.length > 0 && (
        <div className="metrics-history">
          <div className="history-header">Recent Average ({history.length} requests)</div>
          <div className="history-stats">
            <span>First chunk: {formatTime(avgTimeToFirstChunk)}</span>
            <span>Total: {formatTime(avgTotalTime)}</span>
            {totalTokens > 0 && (
              <>
                <span>Tokens/req: {Math.round(avgTokensPerRequest).toLocaleString()}</span>
                <span>Total tokens: {totalTokens.toLocaleString()}</span>
              </>
            )}
          </div>
        </div>
      )}

      {metrics.error && (
        <div className="metrics-error">
          Error: {metrics.error}
        </div>
      )}
    </div>
  );
}