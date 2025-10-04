/**
 * PlanScreen - Full-screen view for displaying plan status table
 *
 * Displays the plan table with filtering controls in a dedicated tab view
 */

import React, { useState, useMemo } from 'react';
import { PlanTable } from '../../../../../runtime/src/plugins/PlanStatusPlugin/PlanTable';
import type { SortColumn, SortDirection } from '../../../../../runtime/src/plugins/PlanStatusPlugin/PlanTable';
import './PlanScreen.css';

export const PlanScreen: React.FC = () => {
  const [sortBy, setSortBy] = useState<SortColumn>('lastUpdated');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  return (
    <div className="plan-screen">
      <div className="plan-screen-header">
        <h1 className="plan-screen-title">Plan Status</h1>
      </div>

      <div className="plan-screen-content">
        <PlanTable
          sortBy={sortBy}
          sortDirection={sortDirection}
          onSortChange={(column, direction) => {
            setSortBy(column);
            setSortDirection(direction);
          }}
        />
      </div>
    </div>
  );
};
