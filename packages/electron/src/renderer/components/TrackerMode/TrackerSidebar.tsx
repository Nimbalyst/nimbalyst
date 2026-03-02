import React from 'react';
import { useAtomValue } from 'jotai';
import { MaterialSymbol } from '@nimbalyst/runtime';
import type { TrackerItemType } from '@nimbalyst/runtime';
import { trackerItemCountByTypeAtom } from '@nimbalyst/runtime/plugins/TrackerPlugin';
import type { TrackerDataModel } from '@nimbalyst/runtime/plugins/TrackerPlugin/models';
export type TrackerView = 'all' | 'high-priority' | 'recently-updated';

interface TrackerSidebarProps {
  trackerTypes: TrackerDataModel[];
  selectedType: string | 'all';
  selectedView: TrackerView;
  onSelectType: (type: string | 'all') => void;
  onSelectView: (view: TrackerView) => void;
}

const VIEWS: { id: TrackerView; label: string; icon: string }[] = [
  { id: 'all', label: 'All Items', icon: 'list' },
  { id: 'high-priority', label: 'High Priority', icon: 'priority_high' },
  { id: 'recently-updated', label: 'Recently Updated', icon: 'schedule' },
];

/** Small component so each sidebar row subscribes to its own atom */
function SidebarTypeCount({ type }: { type: TrackerItemType }) {
  const count = useAtomValue(trackerItemCountByTypeAtom(type));
  return <>{count}</>;
}

export const TrackerSidebar: React.FC<TrackerSidebarProps> = ({
  trackerTypes,
  selectedType,
  selectedView,
  onSelectType,
  onSelectView,
}) => {
  return (
    <div className="tracker-sidebar w-[220px] min-w-[180px] flex flex-col bg-nim-secondary border-r border-nim overflow-hidden" data-testid="tracker-sidebar">
      {/* Header */}
      <div className="px-3 py-2 border-b border-nim">
        <h2 className="text-xs font-semibold text-nim-muted uppercase tracking-wider m-0">
          Trackers
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Types Section */}
        <div className="px-1.5 py-2">
          <div className="text-[10px] font-semibold text-nim-faint uppercase tracking-wider px-2 mb-1">
            Types
          </div>

          {/* All */}
          <button
            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${
              selectedType === 'all' && selectedView === 'all'
                ? 'bg-nim-active text-nim'
                : 'text-nim-muted hover:bg-nim-tertiary hover:text-nim'
            }`}
            onClick={() => {
              onSelectType('all');
              onSelectView('all');
            }}
          >
            <MaterialSymbol icon="checklist" size={16} />
            <span className="flex-1 text-left truncate">All</span>
          </button>

          {/* Individual types */}
          {trackerTypes.map((tracker) => (
            <button
              key={tracker.type}
              data-testid="tracker-type-button"
              data-tracker-type={tracker.type}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${
                selectedType === tracker.type
                  ? 'bg-nim-active text-nim'
                  : 'text-nim-muted hover:bg-nim-tertiary hover:text-nim'
              }`}
              onClick={() => onSelectType(tracker.type)}
            >
              <span style={{ color: tracker.color }}>
                <MaterialSymbol icon={tracker.icon} size={16} />
              </span>
              <span className="flex-1 text-left truncate">{tracker.displayNamePlural}</span>
              <span className="text-[10px] font-semibold text-nim-faint min-w-[20px] text-right">
                <SidebarTypeCount type={tracker.type as TrackerItemType} />
              </span>
            </button>
          ))}
        </div>

        {/* Views Section */}
        <div className="px-1.5 py-2 border-t border-nim">
          <div className="text-[10px] font-semibold text-nim-faint uppercase tracking-wider px-2 mb-1">
            Views
          </div>
          {VIEWS.map((view) => (
            <button
              key={view.id}
              data-testid={`tracker-view-${view.id}`}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${
                selectedView === view.id && selectedType === 'all'
                  ? 'bg-nim-active text-nim'
                  : 'text-nim-muted hover:bg-nim-tertiary hover:text-nim'
              }`}
              onClick={() => {
                onSelectView(view.id);
                if (view.id !== 'all') {
                  onSelectType('all');
                }
              }}
            >
              <MaterialSymbol icon={view.icon} size={16} />
              <span className="flex-1 text-left truncate">{view.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
