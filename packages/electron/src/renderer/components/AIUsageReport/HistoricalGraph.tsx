import React, { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import './HistoricalGraph.css';

interface HistoricalGraphProps {
  workspaceId?: string;
}

interface TimeSeriesDataPoint {
  timestamp: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  sessionCount: number;
}

export const HistoricalGraph: React.FC<HistoricalGraphProps> = ({ workspaceId }) => {
  const [data, setData] = useState<TimeSeriesDataPoint[]>([]);
  const [timeRange, setTimeRange] = useState<'week' | 'month' | 'quarter' | 'year'>('month');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        const now = Date.now();
        const ranges = {
          week: 7 * 24 * 60 * 60 * 1000,
          month: 30 * 24 * 60 * 60 * 1000,
          quarter: 90 * 24 * 60 * 60 * 1000,
          year: 365 * 24 * 60 * 60 * 1000,
        };
        const startDate = now - ranges[timeRange];

        const timeSeries = await window.electronAPI.invoke(
          'usage-analytics:get-time-series',
          startDate,
          now,
          'day',
          workspaceId
        );
        setData(timeSeries);
      } catch (error) {
        console.error('Failed to load time series data:', error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [timeRange, workspaceId]);

  if (loading) {
    return <div className="historical-graph-loading">Loading...</div>;
  }

  const chartData = data.map((point) => ({
    date: new Date(point.timestamp).toLocaleDateString(),
    'Input Tokens': point.inputTokens,
    'Output Tokens': point.outputTokens,
    Sessions: point.sessionCount,
  }));

  return (
    <div className="historical-graph">
      <div className="historical-graph-controls">
        <h3>Token Usage Over Time</h3>
        <div className="time-range-selector">
          {(['week', 'month', 'quarter', 'year'] as const).map((range) => (
            <button
              key={range}
              className={timeRange === range ? 'active' : ''}
              onClick={() => setTimeRange(range)}
            >
              {range.charAt(0).toUpperCase() + range.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {chartData.length > 0 ? (
        <ResponsiveContainer width="100%" height={400}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-primary)" />
            <XAxis dataKey="date" stroke="var(--text-secondary)" />
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
            <Line type="monotone" dataKey="Input Tokens" stroke="#8884d8" strokeWidth={2} />
            <Line type="monotone" dataKey="Output Tokens" stroke="#82ca9d" strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <div className="no-data">No data available for this time range</div>
      )}
    </div>
  );
};
