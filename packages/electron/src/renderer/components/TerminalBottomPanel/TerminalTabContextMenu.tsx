/**
 * TerminalTabContextMenu - Context menu for terminal tabs
 *
 * Provides options to close the tab, close other tabs, close all tabs,
 * and close tabs to the right.
 */

import React, { useEffect, useRef, useState } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';

interface TerminalTabContextMenuProps {
  x: number;
  y: number;
  terminalId: string;
  terminalCount: number;
  terminalIndex: number;
  onClose: () => void;
  onCloseTab: () => void;
  onCloseOthers: () => void;
  onCloseAll: () => void;
  onCloseToRight: () => void;
}

export function TerminalTabContextMenu({
  x,
  y,
  terminalId,
  terminalCount,
  terminalIndex,
  onClose,
  onCloseTab,
  onCloseOthers,
  onCloseAll,
  onCloseToRight,
}: TerminalTabContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [adjustedPosition, setAdjustedPosition] = useState({ x, y });

  // Calculate how many tabs are to the right
  const tabsToRight = terminalCount - terminalIndex - 1;
  const hasOtherTabs = terminalCount > 1;

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

  const handleAction = (action: () => void) => {
    action();
    onClose();
  };

  const menuItemClasses =
    'flex items-center gap-2.5 px-3 py-1.5 rounded cursor-pointer transition-colors text-[var(--nim-text)] hover:bg-[var(--nim-bg-hover)]';
  const disabledMenuItemClasses =
    'flex items-center gap-2.5 px-3 py-1.5 rounded text-[var(--nim-text-disabled)] cursor-not-allowed';

  return (
    <div
      ref={menuRef}
      className="fixed p-1 min-w-[160px] rounded-md z-[10000] text-[13px] backdrop-blur-[10px] shadow-[0_4px_12px_rgba(0,0,0,0.15)] dark:shadow-[0_4px_20px_rgba(0,0,0,0.5)]"
      data-testid="terminal-tab-context-menu"
      style={{
        left: adjustedPosition.x,
        top: adjustedPosition.y,
        background: 'var(--nim-bg)',
        border: '1px solid var(--nim-border)',
      }}
    >
      <div
        className={menuItemClasses}
        onClick={() => handleAction(onCloseTab)}
      >
        <MaterialSymbol icon="close" size={18} />
        <span>Close</span>
      </div>

      <div
        className={hasOtherTabs ? menuItemClasses : disabledMenuItemClasses}
        onClick={hasOtherTabs ? () => handleAction(onCloseOthers) : undefined}
      >
        <MaterialSymbol icon="tab_close" size={18} />
        <span>Close Others</span>
      </div>

      <div
        className={tabsToRight > 0 ? menuItemClasses : disabledMenuItemClasses}
        onClick={tabsToRight > 0 ? () => handleAction(onCloseToRight) : undefined}
      >
        <MaterialSymbol icon="tab_close_right" size={18} />
        <span>Close to the Right</span>
      </div>

      <div className="h-px my-1 bg-[var(--nim-border)]" />

      <div
        className={menuItemClasses}
        onClick={() => handleAction(onCloseAll)}
      >
        <MaterialSymbol icon="cancel" size={18} />
        <span>Close All</span>
      </div>
    </div>
  );
}
