import React, { useEffect, useRef, useState } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';
import './NewFileMenu.css';

export type NewFileType = 'markdown' | 'wireframe' | 'any';

interface NewFileMenuProps {
  x: number;
  y: number;
  onSelect: (fileType: NewFileType) => void;
  onClose: () => void;
  wireframeEnabled?: boolean;
}

export function NewFileMenu({
  x,
  y,
  onSelect,
  onClose,
  wireframeEnabled = false
}: NewFileMenuProps) {
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

  // Adjust position after menu is mounted to keep it in viewport
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

  const handleSelect = (fileType: NewFileType) => {
    onSelect(fileType);
    onClose();
  };

  return (
    <div
      ref={menuRef}
      className="new-file-menu"
      style={{ left: adjustedPosition.x, top: adjustedPosition.y }}
    >
      <div
        className="new-file-menu-item"
        onClick={() => handleSelect('markdown')}
      >
        <MaterialSymbol icon="description" size={18} />
        <span>New Markdown File</span>
      </div>

      {wireframeEnabled && (
        <div
          className="new-file-menu-item"
          onClick={() => handleSelect('wireframe')}
        >
          <MaterialSymbol icon="web" size={18} />
          <span>New Wireframe</span>
        </div>
      )}

      <div className="new-file-menu-separator" />

      <div
        className="new-file-menu-item"
        onClick={() => handleSelect('any')}
      >
        <MaterialSymbol icon="note_add" size={18} />
        <span>New File...</span>
      </div>
    </div>
  );
}
