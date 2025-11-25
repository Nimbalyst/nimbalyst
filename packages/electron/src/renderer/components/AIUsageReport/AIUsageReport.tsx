import React, { useState } from 'react';
import './AIUsageReport.css';
import { OverviewDashboard } from './OverviewDashboard';
import { HistoricalGraph } from './HistoricalGraph';
import { ModelComparison } from './ModelComparison';
import { ProjectInsights } from './ProjectInsights';
import { ActivityHeatmap } from './ActivityHeatmap';

interface AIUsageReportProps {
  onClose?: () => void;
}

export const AIUsageReport: React.FC<AIUsageReportProps> = ({ onClose }) => {
  const [workspaceFilter, setWorkspaceFilter] = useState<string | undefined>(undefined);

  return (
    <div className="ai-usage-report">
      <div className="ai-usage-report-content">
        <OverviewDashboard workspaceId={workspaceFilter} />

        <div className="dashboard-row">
          <div className="dashboard-section">
            <ActivityHeatmap workspaceId={workspaceFilter} />
          </div>
        </div>


        <div className="dashboard-row">
          <div className="dashboard-section">
            <HistoricalGraph workspaceId={workspaceFilter} />
          </div>
          {/*<div className="dashboard-section">*/}
          {/*  <ModelComparison workspaceId={workspaceFilter} />*/}
          {/*</div>*/}
        </div>


        <div className="dashboard-row">
          <div className="dashboard-section">
            <ProjectInsights />
          </div>
        </div>
      </div>
    </div>
  );
};
