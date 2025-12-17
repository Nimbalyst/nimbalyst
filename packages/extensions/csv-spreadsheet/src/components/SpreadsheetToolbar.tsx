/**
 * SpreadsheetToolbar Component
 *
 * Toolbar with actions for manipulating the spreadsheet data.
 */

import type { SortConfig } from '../types';

interface SpreadsheetToolbarProps {
  onAddRow: () => void;
  onDeleteRow: () => void;
  onAddColumn: () => void;
  onDeleteColumn: () => void;
  onSortAsc: () => void;
  onSortDesc: () => void;
  hasSelection: boolean;
  sortConfig: SortConfig | null;
}

export function SpreadsheetToolbar({
  onAddRow,
  onDeleteRow,
  onAddColumn,
  onDeleteColumn,
  onSortAsc,
  onSortDesc,
  hasSelection,
  sortConfig,
}: SpreadsheetToolbarProps) {
  return (
    <div className="spreadsheet-toolbar">
      <div className="toolbar-group">
        <button
          className="toolbar-button"
          onClick={onAddRow}
          title="Add Row"
        >
          + Row
        </button>
        <button
          className="toolbar-button"
          onClick={onDeleteRow}
          disabled={!hasSelection}
          title="Delete Row"
        >
          - Row
        </button>
      </div>

      <div className="toolbar-separator" />

      <div className="toolbar-group">
        <button
          className="toolbar-button"
          onClick={onAddColumn}
          title="Add Column"
        >
          + Col
        </button>
        <button
          className="toolbar-button"
          onClick={onDeleteColumn}
          disabled={!hasSelection}
          title="Delete Column"
        >
          - Col
        </button>
      </div>

      <div className="toolbar-separator" />

      <div className="toolbar-group">
        <button
          className={`toolbar-button ${sortConfig?.direction === 'asc' ? 'active' : ''}`}
          onClick={onSortAsc}
          disabled={!hasSelection}
          title="Sort Ascending"
        >
          A-Z
        </button>
        <button
          className={`toolbar-button ${sortConfig?.direction === 'desc' ? 'active' : ''}`}
          onClick={onSortDesc}
          disabled={!hasSelection}
          title="Sort Descending"
        >
          Z-A
        </button>
      </div>
    </div>
  );
}
