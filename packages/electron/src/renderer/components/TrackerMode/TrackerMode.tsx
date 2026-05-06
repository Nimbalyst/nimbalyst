import React, { useEffect, useMemo, useCallback, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { globalRegistry, loadBuiltinTrackers } from '@nimbalyst/runtime/plugins/TrackerPlugin/models';
import { TrackerSidebar } from './TrackerSidebar';
import { TrackerMainView, type ViewMode } from './TrackerMainView';
import { ResizablePanel } from '../AgenticCoding/ResizablePanel';
import type { TrackerItemType } from '@nimbalyst/runtime';
import {
  trackerModeLayoutAtom,
  setTrackerModeLayoutAtom,
  type TrackerFilterChip,
} from '../../store/atoms/trackers';
import {
  computeFieldLoss,
  buildNewTypeTags,
  regenerateKey,
  migrateData,
  type DraggedTrackerItem,
} from './trackerItemDnd';
import { TrackerItemMoveConfirm } from './TrackerItemMoveConfirm';

// Ensure built-in trackers are loaded
loadBuiltinTrackers();

interface TrackerModeProps {
  workspacePath: string | null;
  workspaceName?: string;
  isActive: boolean;
  onSwitchToFilesMode?: () => void;
}

export const TrackerMode: React.FC<TrackerModeProps> = ({
  workspacePath,
  workspaceName,
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
  const sidebarWidth = modeLayout.sidebarWidth;

  const handleSelectType = useCallback((type: string | 'all') => {
    setModeLayout({ selectedType: type, selectedItemId: null });
  }, [setModeLayout]);

  const handleToggleFilter = useCallback((filter: TrackerFilterChip) => {
    let current = modeLayout.activeFilters;

    // "Mine" and "Unassigned" are mutually exclusive
    if (filter === 'mine') current = current.filter(f => f !== 'unassigned');
    if (filter === 'unassigned') current = current.filter(f => f !== 'mine');

    const next = current.includes(filter)
      ? current.filter(f => f !== filter)
      : [...current, filter];
    setModeLayout({ activeFilters: next });
  }, [modeLayout.activeFilters, setModeLayout]);

  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setModeLayout({ viewMode: mode });
  }, [setModeLayout]);

  const handleSidebarWidthChange = useCallback((width: number) => {
    setModeLayout({ sidebarWidth: width });
  }, [setModeLayout]);

  const filterType = selectedType as TrackerItemType | 'all';

  // ── Cross-type drag-and-drop move ──────────────────────────────────────────
  const [moveConfirm, setMoveConfirm] = useState<{
    payload: DraggedTrackerItem;
    targetType: string;
    lostFields: string[];
  } | null>(null);

  const handleItemMove = useCallback((payload: DraggedTrackerItem, targetType: string) => {
    if (payload.primaryType === targetType) return;
    const { lostFields } = computeFieldLoss(payload.currentDataKeys, targetType);
    setMoveConfirm({ payload, targetType, lostFields });
  }, []);

  const performMove = useCallback(async () => {
    if (!moveConfirm) return;
    const { payload, targetType } = moveConfirm;
    const targetModel = globalRegistry.get(targetType);
    if (!targetModel) {
      setMoveConfirm(null);
      return;
    }
    const newTypeTags = buildNewTypeTags(payload.typeTags, payload.primaryType, targetType);
    const newKey = payload.key ? regenerateKey(payload.key, targetModel.idPrefix) : undefined;
    const newData = migrateData(payload.data, targetType);
    try {
      const updates: Record<string, any> = { typeTags: newTypeTags, ...newData };
      for (const lostKey of moveConfirm.lostFields) {
        updates[lostKey] = null;
      }
      if (newKey) updates.issueKey = newKey;
      await (window as any).electronAPI.documentService.updateTrackerItem({
        itemId: payload.itemId,
        updates,
        syncMode: undefined,
      });
    } catch (err) {
      console.error('[TrackerMode] move failed', err);
    }
    setMoveConfirm(null);
  }, [moveConfirm]);

  const sidebarContent = (
    <TrackerSidebar
      workspacePath={workspacePath || undefined}
      workspaceName={workspaceName}
      trackerTypes={trackerTypes}
      selectedType={selectedType}
      activeFilters={activeFilters}
      viewMode={viewMode}
      onSelectType={handleSelectType}
      onToggleFilter={handleToggleFilter}
      onViewModeChange={handleViewModeChange}
      onItemMove={handleItemMove}
    />
  );

  const mainContent = (
    <TrackerMainView
      filterType={filterType}
      activeFilters={activeFilters}
      viewMode={viewMode}
      onViewModeChange={handleViewModeChange}
      onSwitchToFilesMode={onSwitchToFilesMode}
      workspacePath={workspacePath || undefined}
      trackerTypes={trackerTypes}
    />
  );

  return (
    <div className="tracker-mode flex-1 flex flex-row overflow-hidden min-h-0">
      <ResizablePanel
        leftPanel={sidebarContent}
        rightPanel={mainContent}
        leftWidth={sidebarWidth}
        minWidth={160}
        maxWidth={350}
        onWidthChange={handleSidebarWidthChange}
      />
      {moveConfirm && (
        <TrackerItemMoveConfirm
          itemKey={moveConfirm.payload.key}
          sourceTypeId={moveConfirm.payload.primaryType}
          targetTypeId={moveConfirm.targetType}
          lostFields={moveConfirm.lostFields}
          onCancel={() => setMoveConfirm(null)}
          onConfirm={performMove}
        />
      )}
    </div>
  );
};
