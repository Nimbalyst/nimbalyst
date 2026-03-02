import React, { useEffect, useMemo, useCallback } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { globalRegistry, loadBuiltinTrackers } from '@nimbalyst/runtime/plugins/TrackerPlugin/models';
import { TrackerSidebar, type TrackerView } from './TrackerSidebar';
import { TrackerMainView, type ViewMode } from './TrackerMainView';
import type { TrackerItemType } from '@nimbalyst/runtime';
import {
  trackerModeLayoutAtom,
  setTrackerModeLayoutAtom,
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
  const selectedView = modeLayout.selectedView;
  const viewMode = modeLayout.viewMode;

  // Item counts are derived from atoms directly in TrackerSidebar via SidebarTypeCount

  const handleSelectType = useCallback((type: string | 'all') => {
    setModeLayout({ selectedType: type });
  }, [setModeLayout]);

  const handleSelectView = useCallback((view: TrackerView) => {
    setModeLayout({ selectedView: view });
  }, [setModeLayout]);

  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setModeLayout({ viewMode: mode });
  }, [setModeLayout]);

  const filterType = selectedType as TrackerItemType | 'all';

  return (
    <div className="tracker-mode flex-1 flex flex-row overflow-hidden min-h-0">
      <TrackerSidebar
        trackerTypes={trackerTypes}
        selectedType={selectedType}
        selectedView={selectedView}
        onSelectType={handleSelectType}
        onSelectView={handleSelectView}
      />
      <TrackerMainView
        filterType={filterType}
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
        onSwitchToFilesMode={onSwitchToFilesMode}
        workspacePath={workspacePath || undefined}
        trackerTypes={trackerTypes}
      />
    </div>
  );
};
