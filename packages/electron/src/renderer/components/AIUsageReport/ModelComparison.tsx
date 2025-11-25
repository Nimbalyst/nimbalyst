import React, { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import './ModelComparison.css';

interface ModelComparisonProps {
  workspaceId?: string;
}

interface ProviderUsageStats {
  provider: string;
  model: string | null;
  sessionCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
}

export const ModelComparison: React.FC<ModelComparisonProps> = ({ workspaceId }) => {
  const [data, setData] = useState<ProviderUsageStats[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        const providers = await window.electronAPI.invoke('usage-analytics:get-usage-by-provider', workspaceId);
        setData(providers);
      } catch (error) {
        console.error('Failed to load model comparison data:', error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [workspaceId]);

  if (loading) {
    return <div className="model-comparison-loading">Loading...</div>;
  }

  const chartData = data.map((item) => ({
    name: `${item.provider}${item.model ? ` (${item.model})` : ''}`,
    'Total Tokens': item.totalTokens,
    Sessions: item.sessionCount,
  }));

  return (
    <div className="model-comparison">
      <h3>Usage by Model</h3>

      {chartData.length > 0 ? (
        <ResponsiveContainer width="100%" height={400}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-primary)" />
            <XAxis dataKey="name" stroke="var(--text-secondary)" />
            <YAxis stroke="var(--text-secondary)" />
            <Tooltip
              contentStyle={{
                background: 'var(--surface-secondary)',
                border: '1px solid var(--border-primary)',
                borderRadius: '6px',
                color: 'var(--text-primary)',
              }}
            />
            <Legend />
            <Bar dataKey="Total Tokens" fill="var(--primary-color)" />
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <div className="no-data">No model usage data available</div>
      )}
    </div>
  );
};
