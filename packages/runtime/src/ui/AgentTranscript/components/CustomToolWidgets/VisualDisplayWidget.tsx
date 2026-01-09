/**
 * Custom widget for the display_visual MCP tool
 *
 * Renders visual content inline in the AI transcript.
 * Supports:
 * - Charts (bar, line, pie, area, scatter) using Recharts
 * - Image galleries with file path loading
 */

import React, { useState, useEffect } from 'react';
import { useAtomValue } from 'jotai';
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
import { isDarkThemeAtom } from '../../../../store/atoms/theme';
import './VisualDisplayWidget.css';

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
function getThemeColors(isDark: boolean): string[] {
  return isDark ? DARK_COLORS : LIGHT_COLORS;
}

interface ChartConfig {
  chartType: 'bar' | 'line' | 'pie' | 'area' | 'scatter';
  data: Record<string, unknown>[];
  xAxisKey: string;
  yAxisKey: string | string[];
  title?: string;
  width?: number;
  height?: number;
  colors?: string[];
}

interface ImageItem {
  path: string;
  caption?: string;
}

type ChartVisualConfig = {
  type: 'chart';
  title?: string;
  chartType: 'bar' | 'line' | 'pie' | 'area' | 'scatter';
  data: Record<string, unknown>[];
  xAxisKey: string;
  yAxisKey: string | string[];
  width?: number;
  height?: number;
  colors?: string[];
};

type ImageVisualConfig = {
  type: 'images';
  title?: string;
  images: ImageItem[];
};

type VisualConfig = ChartVisualConfig | ImageVisualConfig;

interface ToolCall {
  name: string;
  arguments?: Record<string, unknown>;
  result?: unknown;
}

/**
 * Extract visual configuration from tool arguments
 */
function extractVisualConfig(tool: ToolCall): VisualConfig | null {
  if (!tool?.arguments) return null;

  const args = tool.arguments;
  const type = args.type;

  if (type !== 'chart' && type !== 'images') {
    return null;
  }

  if (type === 'chart') {
    // Validate required chart fields
    if (!args.chartType || !args.data || !args.xAxisKey || !args.yAxisKey) {
      return null;
    }
    return {
      type: 'chart',
      title: args.title as string | undefined,
      chartType: args.chartType as 'bar' | 'line' | 'pie' | 'area' | 'scatter',
      data: args.data as Record<string, unknown>[],
      xAxisKey: args.xAxisKey as string,
      yAxisKey: args.yAxisKey as string | string[],
      width: args.width as number | undefined,
      height: args.height as number | undefined,
      colors: args.colors as string[] | undefined,
    };
  }

  // type === 'images'
  if (!args.images) {
    return null;
  }
  return {
    type: 'images',
    title: args.title as string | undefined,
    images: args.images as ImageItem[],
  };
}

/**
 * Check if the tool result indicates an error
 */
function isToolError(result: unknown, message: { isError?: boolean }): boolean {
  if (message.isError) return true;
  if (typeof result === 'object' && result !== null && 'isError' in result) {
    return (result as { isError?: boolean }).isError === true;
  }
  return false;
}

/**
 * Error boundary for visual rendering
 */
class VisualErrorBoundary extends React.Component<
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
    console.error('[VisualDisplayWidget] Rendering error:', error, errorInfo);
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

/**
 * Component for displaying a single image with loading state
 */
const ImageDisplay: React.FC<{
  image: ImageItem;
  readFile?: (path: string) => Promise<{ success: boolean; content?: string; error?: string }>;
}> = ({ image, readFile }) => {
  const [imageData, setImageData] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadImage = async () => {
      // Try to load the image via file protocol (for local files)
      // In Electron, we can use file:// protocol for local images
      try {
        // First try using readFile if available (for base64 loading)
        if (readFile) {
          const result = await readFile(image.path);
          if (result.success && result.content) {
            // Check if content is already base64 or needs conversion
            if (result.content.startsWith('data:')) {
              setImageData(result.content);
            } else {
              // Determine MIME type from extension
              const ext = image.path.split('.').pop()?.toLowerCase();
              const mimeTypes: Record<string, string> = {
                'png': 'image/png',
                'jpg': 'image/jpeg',
                'jpeg': 'image/jpeg',
                'gif': 'image/gif',
                'webp': 'image/webp',
                'svg': 'image/svg+xml',
                'bmp': 'image/bmp'
              };
              const mimeType = mimeTypes[ext || ''] || 'image/png';
              setImageData(`data:${mimeType};base64,${result.content}`);
            }
            setLoading(false);
            return;
          }
        }

        // Fall back to file:// protocol for local Electron images
        // Note: This requires proper webSecurity settings in Electron
        setImageData(`file://${image.path}`);
        setLoading(false);
      } catch (err) {
        setError('Failed to load image');
        setLoading(false);
      }
    };

    loadImage();
  }, [image.path, readFile]);

  if (loading) {
    return (
      <div className="visual-display-widget__image-item visual-display-widget__image-item--loading">
        <div className="visual-display-widget__image-loading">Loading...</div>
        {image.caption && (
          <div className="visual-display-widget__image-caption">{image.caption}</div>
        )}
      </div>
    );
  }

  if (error) {
    return (
      <div className="visual-display-widget__image-item visual-display-widget__image-item--error">
        <div className="visual-display-widget__image-error">{error}</div>
        <div className="visual-display-widget__image-path">{image.path}</div>
        {image.caption && (
          <div className="visual-display-widget__image-caption">{image.caption}</div>
        )}
      </div>
    );
  }

  return (
    <div className="visual-display-widget__image-item">
      <div className="visual-display-widget__image-wrapper">
        <img
          src={imageData || ''}
          alt={image.caption || 'Image'}
          className="visual-display-widget__image"
          onError={() => setError('Failed to load image')}
        />
      </div>
      {image.caption && (
        <div className="visual-display-widget__image-caption">{image.caption}</div>
      )}
    </div>
  );
};

/**
 * Render an image gallery
 */
const ImageGallery: React.FC<{
  images: ImageItem[];
  readFile?: (path: string) => Promise<{ success: boolean; content?: string; error?: string }>;
}> = ({ images, readFile }) => {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  return (
    <div className="visual-display-widget__gallery">
      <div className="visual-display-widget__gallery-grid">
        {images.map((image, index) => (
          <div
            key={index}
            className="visual-display-widget__gallery-item"
            onClick={() => setSelectedIndex(index)}
          >
            <ImageDisplay image={image} readFile={readFile} />
          </div>
        ))}
      </div>
      {selectedIndex !== null && (
        <div
          className="visual-display-widget__lightbox"
          onClick={() => setSelectedIndex(null)}
        >
          <div className="visual-display-widget__lightbox-content" onClick={e => e.stopPropagation()}>
            <button
              className="visual-display-widget__lightbox-close"
              onClick={() => setSelectedIndex(null)}
              aria-label="Close"
            >
              &times;
            </button>
            <ImageDisplay image={images[selectedIndex]} readFile={readFile} />
            {images.length > 1 && (
              <div className="visual-display-widget__lightbox-nav">
                <button
                  className="visual-display-widget__lightbox-prev"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedIndex((selectedIndex - 1 + images.length) % images.length);
                  }}
                  aria-label="Previous"
                >
                  &larr;
                </button>
                <span className="visual-display-widget__lightbox-counter">
                  {selectedIndex + 1} / {images.length}
                </span>
                <button
                  className="visual-display-widget__lightbox-next"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedIndex((selectedIndex + 1) % images.length);
                  }}
                  aria-label="Next"
                >
                  &rarr;
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export const VisualDisplayWidget: React.FC<CustomToolWidgetProps> = ({ message, readFile }) => {
  const tool = message.toolCall;
  const isDark = useAtomValue(isDarkThemeAtom);

  if (!tool) return null;

  const config = extractVisualConfig(tool);
  const hasError = isToolError(tool.result, message);

  if (hasError || !config) {
    return (
      <div className="visual-display-widget visual-display-widget--error" role="img" aria-label="Visual content error">
        <div className="visual-display-widget__header">
          <span className="visual-display-widget__label">Visual</span>
          <span className="visual-display-widget__status visual-display-widget__status--error">
            Error
          </span>
        </div>
        <div className="visual-display-widget__error">
          {!config ? 'Invalid visual configuration' : 'Failed to display visual content'}
        </div>
      </div>
    );
  }

  // Render chart
  if (config.type === 'chart') {
    const chartConfig: ChartConfig = {
      chartType: config.chartType,
      data: config.data,
      xAxisKey: config.xAxisKey,
      yAxisKey: config.yAxisKey,
      title: config.title,
      width: config.width,
      height: config.height,
      colors: config.colors
    };

    const colors = chartConfig.colors || getThemeColors(isDark);
    const height = chartConfig.height || 300;

    const renderChart = () => {
      switch (chartConfig.chartType) {
        case 'bar':
          return renderBarChart(chartConfig, colors);
        case 'line':
          return renderLineChart(chartConfig, colors);
        case 'pie':
          return renderPieChart(chartConfig, colors);
        case 'area':
          return renderAreaChart(chartConfig, colors);
        case 'scatter':
          return renderScatterChart(chartConfig, colors);
        default:
          return null;
      }
    };

    const chartLabel = config.title
      ? `${chartConfig.chartType} chart: ${config.title}`
      : `${chartConfig.chartType} chart`;

    const errorFallback = (
      <div className="visual-display-widget visual-display-widget--error" role="img" aria-label="Chart rendering error">
        <div className="visual-display-widget__header">
          <span className="visual-display-widget__label">Chart</span>
          <span className="visual-display-widget__status visual-display-widget__status--error">
            Error
          </span>
        </div>
        <div className="visual-display-widget__error">
          Chart rendering failed. Please check the data format.
        </div>
      </div>
    );

    return (
      <VisualErrorBoundary fallback={errorFallback}>
        <div className="visual-display-widget" role="img" aria-label={chartLabel}>
          {config.title && (
            <div className="visual-display-widget__header">
              <span className="visual-display-widget__title">{config.title}</span>
            </div>
          )}
          <div className="visual-display-widget__chart" style={{ height }}>
            <ResponsiveContainer width="100%" height="100%">
              {renderChart()}
            </ResponsiveContainer>
          </div>
        </div>
      </VisualErrorBoundary>
    );
  }

  // Render images
  if (config.type === 'images') {
    if (!config.images || config.images.length === 0) {
      return (
        <div className="visual-display-widget visual-display-widget--error" role="img" aria-label="Images error">
          <div className="visual-display-widget__header">
            <span className="visual-display-widget__label">Images</span>
            <span className="visual-display-widget__status visual-display-widget__status--error">
              Error
            </span>
          </div>
          <div className="visual-display-widget__error">
            No images provided
          </div>
        </div>
      );
    }

    const imageLabel = config.title
      ? `Images: ${config.title}`
      : `${config.images.length} image(s)`;

    const errorFallback = (
      <div className="visual-display-widget visual-display-widget--error" role="img" aria-label="Image gallery error">
        <div className="visual-display-widget__header">
          <span className="visual-display-widget__label">Images</span>
          <span className="visual-display-widget__status visual-display-widget__status--error">
            Error
          </span>
        </div>
        <div className="visual-display-widget__error">
          Failed to render image gallery.
        </div>
      </div>
    );

    return (
      <VisualErrorBoundary fallback={errorFallback}>
        <div className="visual-display-widget" role="img" aria-label={imageLabel}>
          {config.title && (
            <div className="visual-display-widget__header">
              <span className="visual-display-widget__title">{config.title}</span>
            </div>
          )}
          <ImageGallery images={config.images} readFile={readFile} />
        </div>
      </VisualErrorBoundary>
    );
  }

  // Unknown type
  return (
    <div className="visual-display-widget visual-display-widget--error" role="img" aria-label="Visual content error">
      <div className="visual-display-widget__header">
        <span className="visual-display-widget__label">Visual</span>
        <span className="visual-display-widget__status visual-display-widget__status--error">
          Error
        </span>
      </div>
      <div className="visual-display-widget__error">
        Unknown visual type: {config.type}
      </div>
    </div>
  );
};
