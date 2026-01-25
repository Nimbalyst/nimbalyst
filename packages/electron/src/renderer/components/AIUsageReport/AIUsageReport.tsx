import React, { useState } from 'react';
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
    <div className="ai-usage-report flex flex-col h-full bg-nim text-nim overflow-hidden">
      <div className="ai-usage-report-content flex-1 overflow-y-auto p-4 flex flex-col gap-4 scrollbar-nim">
        <OverviewDashboard workspaceId={workspaceFilter} />

        <div className="dashboard-row grid grid-cols-[repeat(auto-fit,minmax(500px,1fr))] gap-4">
          <div className="dashboard-section bg-nim-secondary border border-nim rounded-md p-4">
            <ActivityHeatmap workspaceId={workspaceFilter} />
          </div>
        </div>


        <div className="dashboard-row grid grid-cols-[repeat(auto-fit,minmax(500px,1fr))] gap-4">
          <div className="dashboard-section bg-nim-secondary border border-nim rounded-md p-4">
            <HistoricalGraph workspaceId={workspaceFilter} />
          </div>
          {/*<div className="dashboard-section bg-nim-secondary border border-nim rounded-md p-4">*/}
          {/*  <ModelComparison workspaceId={workspaceFilter} />*/}
          {/*</div>*/}
        </div>


        <div className="dashboard-row grid grid-cols-[repeat(auto-fit,minmax(500px,1fr))] gap-4">
          <div className="dashboard-section bg-nim-secondary border border-nim rounded-md p-4">
            <ProjectInsights />
          </div>
        </div>
      </div>
    </div>
  );
};
