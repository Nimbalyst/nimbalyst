/**
 * Custom widget for the display_chart MCP tool
 *
 * Renders charts inline in the AI transcript using Recharts.
 * Supports bar, line, pie, area, and scatter charts.
 */

import React from 'react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  AreaChart,
  Area,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell
} from 'recharts';
import type { CustomToolWidgetProps } from './index';
import './ChartDisplayWidget.css';

// Theme-aware color palettes
const LIGHT_COLORS = [
  '#6366f1', // indigo
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#f97316'  // orange
];

const DARK_COLORS = [
  '#818cf8', // lighter indigo
  '#34d399', // lighter emerald
  '#fbbf24', // lighter amber
  '#f87171', // lighter red
  '#a78bfa', // lighter violet
  '#f472b6', // lighter pink
  '#22d3ee', // lighter cyan
  '#fb923c'  // lighter orange
];

/**
 * Get the appropriate color palette based on current theme
 */
function getThemeColors(): string[] {
  // Check if dark mode is active by checking computed background color
  const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  return isDark ? DARK_COLORS : LIGHT_COLORS;
}

interface ChartConfig {
  chartType: 'bar' | 'line' | 'pie' | 'area' | 'scatter';
  data: Record<string, any>[];
  xAxisKey: string;
  yAxisKey: string | string[];
  title?: string;
  width?: number;
  height?: number;
  colors?: string[];
}

/**
 * Extract chart configuration from tool arguments
 */
function extractChartConfig(tool: any): ChartConfig | null {
  if (!tool?.arguments) return null;

  const args = tool.arguments;

  if (!args.chartType || !args.data || !args.xAxisKey || !args.yAxisKey) {
    return null;
  }

  return {
    chartType: args.chartType,
    data: args.data,
    xAxisKey: args.xAxisKey,
    yAxisKey: args.yAxisKey,
    title: args.title,
    width: args.width,
    height: args.height,
    colors: args.colors
  };
}

/**
 * Check if the tool result indicates an error
 */
function isToolError(result: any, message: any): boolean {
  if (message.isError) return true;
  if (result?.isError === true) return true;
  return false;
}

/**
 * Error boundary for chart rendering
 */
class ChartErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ChartDisplayWidget] Chart rendering error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

/**
 * Render a bar chart
 */
function renderBarChart(config: ChartConfig, colors: string[]) {
  const yKeys = Array.isArray(config.yAxisKey) ? config.yAxisKey : [config.yAxisKey];

  return (
    <BarChart data={config.data}>
      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-primary)" />
      <XAxis dataKey={config.xAxisKey} stroke="var(--text-secondary)" tick={{ fontSize: 12 }} />
      <YAxis stroke="var(--text-secondary)" tick={{ fontSize: 12 }} />
      <Tooltip
        contentStyle={{
          background: 'var(--surface-secondary)',
          border: '1px solid var(--border-primary)',
          borderRadius: '6px',
          color: 'var(--text-primary)'
        }}
      />
      {yKeys.length > 1 && <Legend />}
      {yKeys.map((key, index) => (
        <Bar key={key} dataKey={key} fill={colors[index % colors.length]} isAnimationActive={false} />
      ))}
    </BarChart>
  );
}

/**
 * Render a line chart
 */
function renderLineChart(config: ChartConfig, colors: string[]) {
  const yKeys = Array.isArray(config.yAxisKey) ? config.yAxisKey : [config.yAxisKey];

  return (
    <LineChart data={config.data}>
      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-primary)" />
      <XAxis dataKey={config.xAxisKey} stroke="var(--text-secondary)" tick={{ fontSize: 12 }} />
      <YAxis stroke="var(--text-secondary)" tick={{ fontSize: 12 }} />
      <Tooltip
        contentStyle={{
          background: 'var(--surface-secondary)',
          border: '1px solid var(--border-primary)',
          borderRadius: '6px',
          color: 'var(--text-primary)'
        }}
      />
      {yKeys.length > 1 && <Legend />}
      {yKeys.map((key, index) => (
        <Line
          key={key}
          type="monotone"
          dataKey={key}
          stroke={colors[index % colors.length]}
          strokeWidth={2}
          dot={{ fill: colors[index % colors.length], strokeWidth: 0, r: 3 }}
          isAnimationActive={false}
        />
      ))}
    </LineChart>
  );
}

/**
 * Render a pie chart
 */
function renderPieChart(config: ChartConfig, colors: string[]) {
  const yKey = Array.isArray(config.yAxisKey) ? config.yAxisKey[0] : config.yAxisKey;

  return (
    <PieChart>
      <Pie
        data={config.data}
        dataKey={yKey}
        nameKey={config.xAxisKey}
        cx="50%"
        cy="50%"
        outerRadius="70%"
        label={({ name, percent }) => `${name}: ${((percent ?? 0) * 100).toFixed(0)}%`}
        labelLine={{ stroke: 'var(--text-secondary)' }}
        isAnimationActive={false}
      >
        {config.data.map((_, index) => (
          <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
        ))}
      </Pie>
      <Tooltip
        contentStyle={{
          background: 'var(--surface-secondary)',
          border: '1px solid var(--border-primary)',
          borderRadius: '6px',
          color: 'var(--text-primary)'
        }}
      />
    </PieChart>
  );
}

/**
 * Render an area chart
 */
function renderAreaChart(config: ChartConfig, colors: string[]) {
  const yKeys = Array.isArray(config.yAxisKey) ? config.yAxisKey : [config.yAxisKey];

  return (
    <AreaChart data={config.data}>
      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-primary)" />
      <XAxis dataKey={config.xAxisKey} stroke="var(--text-secondary)" tick={{ fontSize: 12 }} />
      <YAxis stroke="var(--text-secondary)" tick={{ fontSize: 12 }} />
      <Tooltip
        contentStyle={{
          background: 'var(--surface-secondary)',
          border: '1px solid var(--border-primary)',
          borderRadius: '6px',
          color: 'var(--text-primary)'
        }}
      />
      {yKeys.length > 1 && <Legend />}
      {yKeys.map((key, index) => (
        <Area
          key={key}
          type="monotone"
          dataKey={key}
          stroke={colors[index % colors.length]}
          fill={colors[index % colors.length]}
          fillOpacity={0.3}
          isAnimationActive={false}
        />
      ))}
    </AreaChart>
  );
}

/**
 * Render a scatter chart
 */
function renderScatterChart(config: ChartConfig, colors: string[]) {
  const yKey = Array.isArray(config.yAxisKey) ? config.yAxisKey[0] : config.yAxisKey;

  return (
    <ScatterChart>
      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-primary)" />
      <XAxis dataKey={config.xAxisKey} stroke="var(--text-secondary)" tick={{ fontSize: 12 }} name={config.xAxisKey} />
      <YAxis dataKey={yKey} stroke="var(--text-secondary)" tick={{ fontSize: 12 }} name={yKey} />
      <Tooltip
        contentStyle={{
          background: 'var(--surface-secondary)',
          border: '1px solid var(--border-primary)',
          borderRadius: '6px',
          color: 'var(--text-primary)'
        }}
        cursor={{ strokeDasharray: '3 3' }}
      />
      <Scatter data={config.data} fill={colors[0]} isAnimationActive={false}>
        {config.data.map((_, index) => (
          <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
        ))}
      </Scatter>
    </ScatterChart>
  );
}

export const ChartDisplayWidget: React.FC<CustomToolWidgetProps> = ({ message }) => {
  const tool = message.toolCall;

  if (!tool) return null;

  const config = extractChartConfig(tool);
  const hasError = isToolError(tool.result, message);

  if (hasError || !config) {
    return (
      <div className="chart-display-widget chart-display-widget--error" role="img" aria-label="Chart error">
        <div className="chart-display-widget__header">
          <span className="chart-display-widget__label">Chart</span>
          <span className="chart-display-widget__status chart-display-widget__status--error">
            Error
          </span>
        </div>
        <div className="chart-display-widget__error">
          {!config ? 'Invalid chart configuration' : 'Failed to display chart'}
        </div>
      </div>
    );
  }

  const colors = config.colors || getThemeColors();
  const height = config.height || 300;

  const renderChart = () => {
    switch (config.chartType) {
      case 'bar':
        return renderBarChart(config, colors);
      case 'line':
        return renderLineChart(config, colors);
      case 'pie':
        return renderPieChart(config, colors);
      case 'area':
        return renderAreaChart(config, colors);
      case 'scatter':
        return renderScatterChart(config, colors);
      default:
        return null;
    }
  };

  const chartLabel = config.title
    ? `${config.chartType} chart: ${config.title}`
    : `${config.chartType} chart`;

  const errorFallback = (
    <div className="chart-display-widget chart-display-widget--error" role="img" aria-label="Chart rendering error">
      <div className="chart-display-widget__header">
        <span className="chart-display-widget__label">Chart</span>
        <span className="chart-display-widget__status chart-display-widget__status--error">
          Error
        </span>
      </div>
      <div className="chart-display-widget__error">
        Chart rendering failed. Please check the data format.
      </div>
    </div>
  );

  return (
    <ChartErrorBoundary fallback={errorFallback}>
      <div className="chart-display-widget" role="img" aria-label={chartLabel}>
        {config.title && (
          <div className="chart-display-widget__header">
            <span className="chart-display-widget__title">{config.title}</span>
          </div>
        )}
        <div className="chart-display-widget__chart" style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            {renderChart()}
          </ResponsiveContainer>
        </div>
      </div>
    </ChartErrorBoundary>
  );
};
