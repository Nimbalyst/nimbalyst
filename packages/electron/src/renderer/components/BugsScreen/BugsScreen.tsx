/**
 * BugsScreen - Full-screen view for displaying tracker items table
 *
 * Displays bugs, tasks, and ideas with filtering controls in a dedicated tab view
 */

import React, { useState } from 'react';
import { TrackerTable } from '../../../../../runtime/src/plugins/ItemTrackerPlugin/TrackerTable';
import './BugsScreen.css';

export const BugsScreen: React.FC = () => {
  return (
    <div className="bugs-screen">

      <div className="bugs-screen-content">
        <TrackerTable />
      </div>
    </div>
  );
};
