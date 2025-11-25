import React, { useEffect, useState } from 'react';
import './ActivityHeatmap.css';

interface ActivityHeatmapProps {
  workspaceId?: string;
}

interface ActivityHeatmapData {
  hourOfDay: number;
  dayOfWeek: number;
  activityCount: number;
}

type ActivityMetric = 'sessions' | 'messages' | 'edits';

const METRIC_LABELS: Record<ActivityMetric, { title: string; description: string }> = {
  sessions: {
    title: 'AI Sessions Created',
    description: 'When new AI chat sessions are started',
  },
  messages: {
    title: 'AI Messages Sent',
    description: 'When you send messages to AI',
  },
  edits: {
    title: 'Documents Edited',
    description: 'When documents are saved',
  },
};

export const ActivityHeatmap: React.FC<ActivityHeatmapProps> = ({ workspaceId }) => {
  const [data, setData] = useState<ActivityHeatmapData[]>([]);
  const [loading, setLoading] = useState(true);
  const [metric, setMetric] = useState<ActivityMetric>('messages');

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        // Get user's timezone offset in minutes (e.g., -300 for EST)
        const timezoneOffsetMinutes = new Date().getTimezoneOffset();

        const heatmapData = await window.electronAPI.invoke(
          'usage-analytics:get-activity-heatmap',
          workspaceId,
          metric,
          timezoneOffsetMinutes
        );
        setData(heatmapData);
      } catch (error) {
        console.error('Failed to load activity heatmap:', error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [workspaceId, metric]);

  if (loading) {
    return <div className="activity-heatmap-loading">Loading...</div>;
  }

  // Create a 2D grid: rows = days (0-6), columns = hours (0-23)
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // Find max activity for scaling
  const maxActivity = Math.max(...data.map((d) => d.activityCount), 1);

  // Create lookup map
  const activityMap = new Map<string, number>();
  data.forEach((d) => {
    const key = `${d.dayOfWeek}-${d.hourOfDay}`;
    activityMap.set(key, d.activityCount);
  });

  const getIntensity = (dayOfWeek: number, hour: number): number => {
    const key = `${dayOfWeek}-${hour}`;
    const count = activityMap.get(key) || 0;
    return count / maxActivity;
  };

  const currentMetricLabels = METRIC_LABELS[metric];

  return (
    <div className="activity-heatmap">
      <div className="heatmap-header-section">
        <div>
          <h3>{currentMetricLabels.title}</h3>
          <p className="heatmap-description">{currentMetricLabels.description}</p>
        </div>
        <div className="metric-toggle">
          {(['messages', 'edits', 'sessions'] as ActivityMetric[]).map((m) => (
            <button
              key={m}
              className={`metric-button ${metric === m ? 'active' : ''}`}
              onClick={() => setMetric(m)}
            >
              {METRIC_LABELS[m].title.replace(/^(AI |Documents )/g, '')}
            </button>
          ))}
        </div>
      </div>

      <div className="heatmap-container">
        <div className="heatmap-grid">
          {/* Header row with hour labels */}
          <div className="heatmap-header">
            <div className="day-label"></div>
            {hours.map((hour) => (
              <div key={hour} className="hour-label">
                {hour.toString().padStart(2, '0')}
              </div>
            ))}
          </div>

          {/* Data rows - one per day */}
          {days.map((day, dayIndex) => (
            <div key={dayIndex} className="heatmap-row">
              <div className="day-label">{day}</div>
              {hours.map((hour) => {
                const intensity = getIntensity(dayIndex, hour);
                const count = activityMap.get(`${dayIndex}-${hour}`) || 0;
                const tooltipText = (() => {
                  if (metric === 'messages') return `${count} message${count !== 1 ? 's' : ''} sent`;
                  if (metric === 'edits') return `${count} edit${count !== 1 ? 's' : ''} saved`;
                  return `${count} session${count !== 1 ? 's' : ''} started`;
                })();
                return (
                  <div
                    key={hour}
                    className="heatmap-cell"
                    style={{
                      backgroundColor: `rgba(var(--primary-color-rgb, 59, 130, 246), ${intensity * 0.8})`,
                    }}
                    data-tooltip={`${day} ${hour}:00 - ${tooltipText}`}
                  >
                    {count > 0 && <span className="cell-count">{count}</span>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <div className="heatmap-legend">
          <span>Less</span>
          <div className="legend-gradient"></div>
          <span>More</span>
        </div>
      </div>
    </div>
  );
};
