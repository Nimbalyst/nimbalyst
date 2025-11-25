import React, { useEffect, useState } from 'react';
import './ProjectInsights.css';

interface ProjectUsageStats {
  workspaceId: string;
  sessionCount: number;
  totalTokens: number;
  lastActivity: number;
}

export const ProjectInsights: React.FC = () => {
  const [projects, setProjects] = useState<ProjectUsageStats[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        const data = await window.electronAPI.invoke('usage-analytics:get-usage-by-project');
        setProjects(data);
      } catch (error) {
        console.error('Failed to load project insights:', error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  if (loading) {
    return <div className="project-insights-loading">Loading...</div>;
  }

  return (
    <div className="project-insights">
      <h3>Usage by Project</h3>

      {projects.length > 0 ? (
        <div className="project-list">
          {projects.map((project, index) => (
            <div key={index} className="project-card">
              <div className="project-name">{project.workspaceId.split('/').pop() || project.workspaceId}</div>
              <div className="project-stats">
                <div className="project-stat">
                  <span className="project-stat-label">Sessions:</span>
                  <span className="project-stat-value">{project.sessionCount}</span>
                </div>
                <div className="project-stat">
                  <span className="project-stat-label">Tokens:</span>
                  <span className="project-stat-value">{project.totalTokens.toLocaleString()}</span>
                </div>
                <div className="project-stat">
                  <span className="project-stat-label">Last Active:</span>
                  <span className="project-stat-value">
                    {new Date(project.lastActivity).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="no-data">No project data available</div>
      )}
    </div>
  );
};
