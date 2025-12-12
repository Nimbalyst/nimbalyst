/**
 * Data Model Toolbar
 *
 * Toolbar component with view mode selector, add entity button, and stats display.
 */

import type { DataModelStoreApi } from '../store';
import type { EntityViewMode } from '../types';

interface DataModelToolbarProps {
  store: DataModelStoreApi;
}

const VIEW_MODES: { value: EntityViewMode; label: string }[] = [
  { value: 'compact', label: 'Compact' },
  { value: 'standard', label: 'Standard' },
  { value: 'full', label: 'Full' },
];

// Auto-layout icon (grid/layout icon)
function AutoLayoutIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
    </svg>
  );
}

export function DataModelToolbar({ store }: DataModelToolbarProps) {
  const state = store.getState();
  const { entities, relationships, entityViewMode } = state;

  const handleAddEntity = () => {
    // Find a position that doesn't overlap with existing entities
    const positions = entities.map((e) => e.position);
    let x = 100;
    let y = 100;

    // Simple grid-based positioning
    const gridSize = 300;
    const cols = 4;
    const existingPositions = new Set(positions.map((p) => `${Math.round(p.x / gridSize)},${Math.round(p.y / gridSize)}`));

    for (let i = 0; i < 100; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const key = `${col},${row}`;
      if (!existingPositions.has(key)) {
        x = col * gridSize + 100;
        y = row * gridSize + 100;
        break;
      }
    }

    store.getState().addEntity({
      name: `Entity${entities.length + 1}`,
      fields: [
        {
          id: `field-${Date.now()}`,
          name: 'id',
          dataType: 'uuid',
          isPrimaryKey: true,
          isNullable: false,
        },
      ],
      position: { x, y },
    });
  };

  const handleViewModeChange = (mode: EntityViewMode) => {
    store.getState().setEntityViewMode(mode);
  };

  const handleAutoLayout = () => {
    store.getState().autoLayout();
  };

  return (
    <div className="datamodel-toolbar">
      <div className="datamodel-toolbar-left">
        <button
          className="datamodel-toolbar-button datamodel-toolbar-button-primary"
          onClick={handleAddEntity}
        >
          + Add Entity
        </button>
        <button
          className="datamodel-toolbar-button datamodel-toolbar-icon-button"
          onClick={handleAutoLayout}
          title="Auto-layout entities"
          disabled={entities.length === 0}
        >
          <AutoLayoutIcon />
        </button>
      </div>

      <div className="datamodel-toolbar-center">
        <span className="datamodel-toolbar-label">View:</span>
        <div className="datamodel-view-mode-group">
          {VIEW_MODES.map((mode) => (
            <button
              key={mode.value}
              className={`datamodel-view-mode-button ${entityViewMode === mode.value ? 'active' : ''}`}
              onClick={() => handleViewModeChange(mode.value)}
            >
              {mode.label}
            </button>
          ))}
        </div>
      </div>

      <div className="datamodel-toolbar-right">
        <span className="datamodel-toolbar-stats">
          {entities.length} {entities.length === 1 ? 'entity' : 'entities'} · {relationships.length}{' '}
          {relationships.length === 1 ? 'relationship' : 'relationships'}
        </span>
      </div>
    </div>
  );
}
