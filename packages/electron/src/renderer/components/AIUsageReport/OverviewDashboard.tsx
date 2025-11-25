import React, { useEffect, useState } from 'react';
import './OverviewDashboard.css';

interface OverviewDashboardProps {
  workspaceId?: string;
}

interface TokenUsageStats {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  sessionCount: number;
  messageCount: number;
}

interface ProviderUsageStats {
  provider: string;
  model: string | null;
  sessionCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
}

export const OverviewDashboard: React.FC<OverviewDashboardProps> = ({ workspaceId }) => {
  const [overallStats, setOverallStats] = useState<TokenUsageStats | null>(null);
  const [providerStats, setProviderStats] = useState<ProviderUsageStats[]>([]);
  const [allSessionCount, setAllSessionCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        const [overall, providers, totalSessions] = await Promise.all([
          window.electronAPI.invoke('usage-analytics:get-overall-stats', workspaceId),
          window.electronAPI.invoke('usage-analytics:get-usage-by-provider', workspaceId),
          window.electronAPI.invoke('usage-analytics:get-all-session-count', workspaceId),
        ]);
        setOverallStats(overall);
        setProviderStats(providers);
        setAllSessionCount(totalSessions);
      } catch (error) {
        console.error('Failed to load overview data:', error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [workspaceId]);

  if (loading) {
    return <div className="overview-loading">Loading...</div>;
  }

  if (!overallStats) {
    return <div className="overview-empty">No usage data available</div>;
  }

  // Get most used provider
  const mostUsedProvider = providerStats.length > 0 ? providerStats[0] : null;

  return (
    <div className="overview-dashboard">
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Total Sessions</div>
          <div className="stat-value">{allSessionCount.toLocaleString()}</div>
          {overallStats.sessionCount < allSessionCount && (
            <div className="stat-detail">
              {overallStats.sessionCount.toLocaleString()} with token data
            </div>
          )}
        </div>

        <div className="stat-card">
          <div className="stat-label">Total Tokens</div>
          <div className="stat-value">{overallStats.totalTokens.toLocaleString()}</div>
          <div className="stat-detail">
            {overallStats.totalInputTokens.toLocaleString()} in / {overallStats.totalOutputTokens.toLocaleString()} out
          </div>
        </div>

        {mostUsedProvider && (
          <div className="stat-card">
            <div className="stat-label">Most Used</div>
            <div className="stat-value">{mostUsedProvider.provider}</div>
            <div className="stat-detail">
              {mostUsedProvider.model || 'Default model'} - {mostUsedProvider.sessionCount} sessions
            </div>
          </div>
        )}
      </div>

      {providerStats.length > 0 && (
        <div className="provider-breakdown">
          <h3>Usage by Provider</h3>
          <div className="provider-bars">
            {providerStats.map((provider, index) => {
              const maxTokens = providerStats[0]?.totalTokens || 1;
              const percentage = (provider.totalTokens / maxTokens) * 100;
              const displayName = provider.model
                ? `${provider.provider} (${provider.model})`
                : provider.provider;
              return (
                <div key={index} className="provider-bar-item">
                  <div className="provider-bar-label">
                    <span className="provider-bar-name">{displayName}</span>
                    <span className="provider-bar-tokens">{provider.totalTokens.toLocaleString()}</span>
                  </div>
                  <div className="provider-bar-track">
                    <div
                      className="provider-bar-fill"
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
