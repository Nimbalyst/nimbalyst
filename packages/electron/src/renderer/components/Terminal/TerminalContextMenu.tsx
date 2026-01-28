import React, { useEffect, useRef, useState } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';

interface TerminalContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  onClear: () => void;
}

export function TerminalContextMenu({
  x,
  y,
  onClose,
  onClear,
}: TerminalContextMenuProps) {
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

  // Adjust position after menu is mounted to keep it within viewport
  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const padding = 10;

      let newX = x;
      let newY = y;

      if (x + rect.width > viewportWidth - padding) {
        newX = x - rect.width;
      }
      if (newX < padding) {
        newX = padding;
      }

      if (y + rect.height > viewportHeight - padding) {
        newY = Math.max(padding, viewportHeight - rect.height - padding);
      }
      if (newY < padding) {
        newY = padding;
      }

      if (newX !== x || newY !== y) {
        setAdjustedPosition({ x: newX, y: newY });
      }
    }
  }, [x, y]);

  const handleClear = () => {
    onClear();
    onClose();
  };

  const menuItemClasses =
    'flex items-center gap-2.5 px-3 py-1.5 rounded cursor-pointer transition-colors text-[var(--nim-text)] hover:bg-[var(--nim-bg-hover)]';

  return (
    <div
      ref={menuRef}
      className="fixed p-1 min-w-[140px] rounded-md z-[10000] text-[13px] backdrop-blur-[10px] shadow-[0_4px_12px_rgba(0,0,0,0.15)] dark:shadow-[0_4px_20px_rgba(0,0,0,0.5)]"
      data-testid="terminal-context-menu"
      style={{
        left: adjustedPosition.x,
        top: adjustedPosition.y,
        background: 'var(--nim-bg)',
        border: '1px solid var(--nim-border)',
      }}
    >
      <div className={menuItemClasses} onClick={handleClear}>
        <MaterialSymbol icon="backspace" size={18} />
        <span>Clear</span>
      </div>
    </div>
  );
}
