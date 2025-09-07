import React, { useCallback, useRef, useState } from 'react';
import { Tab } from './TabManager';

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string | null;
  onTabSelect: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onNewTab: () => void;
  onTogglePin: (tabId: string) => void;
}

export const TabBar: React.FC<TabBarProps> = ({
  tabs,
  activeTabId,
  onTabSelect,
  onTabClose,
  onNewTab,
  onTogglePin
}) => {
  const [contextMenuTab, setContextMenuTab] = useState<string | null>(null);
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });
  const tabBarRef = useRef<HTMLDivElement>(null);

  // Handle tab click
  const handleTabClick = useCallback((e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Middle click to close
    if (e.button === 1) {
      onTabClose(tabId);
      return;
    }
    
    // Left click to select
    if (e.button === 0) {
      onTabSelect(tabId);
    }
  }, [onTabSelect, onTabClose]);

  // Handle close button click
  const handleCloseClick = useCallback((e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    e.stopPropagation();
    onTabClose(tabId);
  }, [onTabClose]);

  // Handle context menu
  const handleContextMenu = useCallback((e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    setContextMenuTab(tabId);
    setContextMenuPosition({ x: e.clientX, y: e.clientY });
  }, []);

  // Close context menu
  const closeContextMenu = useCallback(() => {
    setContextMenuTab(null);
  }, []);

  // Handle context menu actions
  const handleCloseOthers = useCallback(() => {
    tabs.forEach(tab => {
      if (tab.id !== contextMenuTab) {
        onTabClose(tab.id);
      }
    });
    closeContextMenu();
  }, [tabs, contextMenuTab, onTabClose, closeContextMenu]);

  const handleCloseToRight = useCallback(() => {
    const currentIndex = tabs.findIndex(tab => tab.id === contextMenuTab);
    if (currentIndex >= 0) {
      tabs.slice(currentIndex + 1).forEach(tab => {
        onTabClose(tab.id);
      });
    }
    closeContextMenu();
  }, [tabs, contextMenuTab, onTabClose, closeContextMenu]);

  const handleCloseAll = useCallback(() => {
    tabs.forEach(tab => {
      onTabClose(tab.id);
    });
    closeContextMenu();
  }, [tabs, onTabClose, closeContextMenu]);

  const handleTogglePin = useCallback(() => {
    if (contextMenuTab) {
      onTogglePin(contextMenuTab);
    }
    closeContextMenu();
  }, [contextMenuTab, onTogglePin, closeContextMenu]);

  // Click outside to close context menu
  React.useEffect(() => {
    if (contextMenuTab) {
      const handleClickOutside = () => closeContextMenu();
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [contextMenuTab, closeContextMenu]);

  // Keyboard shortcuts
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + T for new tab
      if ((e.metaKey || e.ctrlKey) && e.key === 't') {
        e.preventDefault();
        onNewTab();
      }
      
      // Cmd/Ctrl + W to close current tab
      if ((e.metaKey || e.ctrlKey) && e.key === 'w' && activeTabId) {
        e.preventDefault();
        onTabClose(activeTabId);
      }
      
      // Cmd/Ctrl + Shift + [ or ] to navigate tabs
      if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
        const currentIndex = tabs.findIndex(tab => tab.id === activeTabId);
        
        if (e.key === '[' && currentIndex > 0) {
          e.preventDefault();
          onTabSelect(tabs[currentIndex - 1].id);
        } else if (e.key === ']' && currentIndex < tabs.length - 1) {
          e.preventDefault();
          onTabSelect(tabs[currentIndex + 1].id);
        }
      }
      
      // Cmd/Ctrl + 1-9 to jump to tab
      if ((e.metaKey || e.ctrlKey) && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const index = parseInt(e.key) - 1;
        if (index < tabs.length) {
          onTabSelect(tabs[index].id);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [tabs, activeTabId, onTabSelect, onTabClose, onNewTab]);

  if (tabs.length === 0) {
    return null;
  }

  return (
    <>
      <div className="tab-bar" ref={tabBarRef}>
        {tabs.map((tab, index) => (
          <div
            key={tab.id}
            className={`tab ${tab.id === activeTabId ? 'active' : ''} ${tab.isDirty ? 'dirty' : ''} ${tab.isPinned ? 'pinned' : ''}`}
            onMouseDown={(e) => handleTabClick(e, tab.id)}
            onContextMenu={(e) => handleContextMenu(e, tab.id)}
            title={tab.filePath}
          >
            {tab.isPinned && <span className="tab-pin-icon">📌</span>}
            <span className="tab-title">
              {tab.fileName}
              {tab.isDirty && <span className="tab-dirty-indicator">•</span>}
            </span>
            {!tab.isPinned && (
              <button
                className="tab-close-button"
                onClick={(e) => handleCloseClick(e, tab.id)}
                title="Close tab"
              >
                ×
              </button>
            )}
          </div>
        ))}
        <button
          className="new-tab-button"
          onClick={onNewTab}
          title="New tab (Cmd+T)"
        >
          +
        </button>
      </div>

      {/* Context Menu */}
      {contextMenuTab && (
        <div
          className="tab-context-menu"
          style={{
            position: 'fixed',
            left: contextMenuPosition.x,
            top: contextMenuPosition.y
          }}
        >
          <div className="context-menu-item" onClick={handleTogglePin}>
            {tabs.find(t => t.id === contextMenuTab)?.isPinned ? 'Unpin' : 'Pin'} Tab
          </div>
          <div className="context-menu-separator" />
          <div className="context-menu-item" onClick={() => { onTabClose(contextMenuTab); closeContextMenu(); }}>
            Close
          </div>
          <div className="context-menu-item" onClick={handleCloseOthers}>
            Close Others
          </div>
          <div className="context-menu-item" onClick={handleCloseToRight}>
            Close to the Right
          </div>
          <div className="context-menu-item" onClick={handleCloseAll}>
            Close All
          </div>
        </div>
      )}
    </>
  );
};