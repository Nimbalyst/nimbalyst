import React, { useEffect, useMemo, useCallback } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { globalRegistry, loadBuiltinTrackers } from '@nimbalyst/runtime/plugins/TrackerPlugin/models';
import { TrackerSidebar } from './TrackerSidebar';
import { TrackerMainView, type ViewMode } from './TrackerMainView';
import type { TrackerItemType } from '@nimbalyst/runtime';
import {
  trackerModeLayoutAtom,
  setTrackerModeLayoutAtom,
  type TrackerFilterChip,
} from '../../store/atoms/trackers';

// Ensure built-in trackers are loaded
loadBuiltinTrackers();

interface TrackerModeProps {
  workspacePath: string | null;
  isActive: boolean;
  onSwitchToFilesMode?: () => void;
}

export const TrackerMode: React.FC<TrackerModeProps> = ({
  workspacePath,
  isActive,
  onSwitchToFilesMode,
}) => {
  // Track registry changes
  const [registryVersion, setRegistryVersion] = React.useState(0);
  useEffect(() => {
    return globalRegistry.onChange(() => setRegistryVersion(v => v + 1));
  }, []);

  const trackerTypes = useMemo(() => {
    return globalRegistry.getAll();
  }, [registryVersion]);

  // Persisted layout state from atoms
  const modeLayout = useAtomValue(trackerModeLayoutAtom);
  const setModeLayout = useSetAtom(setTrackerModeLayoutAtom);

  const selectedType = modeLayout.selectedType;
  const activeFilters = modeLayout.activeFilters;
  const viewMode = modeLayout.viewMode;

  const handleSelectType = useCallback((type: string | 'all') => {
    setModeLayout({ selectedType: type });
  }, [setModeLayout]);

  const handleToggleFilter = useCallback((filter: TrackerFilterChip) => {
    const current = modeLayout.activeFilters;
    const next = current.includes(filter)
      ? current.filter(f => f !== filter)
      : [...current, filter];
    setModeLayout({ activeFilters: next });
  }, [modeLayout.activeFilters, setModeLayout]);

  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setModeLayout({ viewMode: mode });
  }, [setModeLayout]);

  const filterType = selectedType as TrackerItemType | 'all';

  return (
    <div className="tracker-mode flex-1 flex flex-row overflow-hidden min-h-0">
      <TrackerSidebar
        trackerTypes={trackerTypes}
        selectedType={selectedType}
        activeFilters={activeFilters}
        onSelectType={handleSelectType}
        onToggleFilter={handleToggleFilter}
      />
      <TrackerMainView
        filterType={filterType}
        activeFilters={activeFilters}
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
        onSwitchToFilesMode={onSwitchToFilesMode}
        workspacePath={workspacePath || undefined}
        trackerTypes={trackerTypes}
      />
    </div>
  );
};
