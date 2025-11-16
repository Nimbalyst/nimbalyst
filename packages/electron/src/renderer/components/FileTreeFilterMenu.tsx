import React, { useEffect, useRef, useState } from 'react';
import { MaterialSymbol } from './MaterialSymbol';
import './FileTreeFilterMenu.css';

export type FileTreeFilter = 'all' | 'markdown' | 'known';

interface FileTreeFilterMenuProps {
  x: number;
  y: number;
  currentFilter: FileTreeFilter;
  showIcons: boolean;
  onFilterChange: (filter: FileTreeFilter) => void;
  onShowIconsChange: (showIcons: boolean) => void;
  onClose: () => void;
}

export function FileTreeFilterMenu({
  x,
  y,
  currentFilter,
  showIcons,
  onFilterChange,
  onShowIconsChange,
  onClose
}: FileTreeFilterMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [adjustedPosition, setAdjustedPosition] = useState({ x, y });

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  // Adjust position after menu is mounted
  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let newX = x;
      let newY = y;

      if (x + rect.width > viewportWidth) {
        newX = x - rect.width;
      }
      if (y + rect.height > viewportHeight) {
        newY = y - rect.height;
      }

      if (newX !== x || newY !== y) {
        setAdjustedPosition({ x: newX, y: newY });
      }
    }
  }, [x, y]);

  const handleFilterSelect = (filter: FileTreeFilter) => {
    onFilterChange(filter);
    onClose();
  };

  return (
    <div
      ref={menuRef}
      className="file-tree-filter-menu"
      style={{ left: adjustedPosition.x, top: adjustedPosition.y }}
    >
      <div className="filter-menu-section-label">Show Files</div>

      <div
        className={`filter-menu-item ${currentFilter === 'markdown' ? 'active' : ''}`}
        onClick={() => handleFilterSelect('markdown')}
      >
        <MaterialSymbol icon="description" size={18} />
        <span>Markdown Only</span>
        {currentFilter === 'markdown' && (
          <MaterialSymbol icon="check" size={16} className="filter-menu-check" />
        )}
      </div>

      <div
        className={`filter-menu-item ${currentFilter === 'known' ? 'active' : ''}`}
        onClick={() => handleFilterSelect('known')}
      >
        <MaterialSymbol icon="filter_list" size={18} />
        <span>Known Files</span>
        {currentFilter === 'known' && (
          <MaterialSymbol icon="check" size={16} className="filter-menu-check" />
        )}
      </div>

      <div
          className={`filter-menu-item ${currentFilter === 'all' ? 'active' : ''}`}
          onClick={() => handleFilterSelect('all')}
      >
        <MaterialSymbol icon="folder_open" size={18} />
        <span>All Files</span>
        {currentFilter === 'all' && (
            <MaterialSymbol icon="check" size={16} className="filter-menu-check" />
        )}
      </div>

      <div className="filter-menu-separator" />

      <div
        className="filter-menu-item"
        onClick={() => onShowIconsChange(!showIcons)}
      >
        <MaterialSymbol icon={showIcons ? 'check_box' : 'check_box_outline_blank'} size={18} />
        <span>Show Icons</span>
      </div>
    </div>
  );
}
