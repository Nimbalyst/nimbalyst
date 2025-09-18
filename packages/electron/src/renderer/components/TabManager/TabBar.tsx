import React, { useCallback, useRef, useState } from 'react';
import { Tab } from './TabManager';

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string | null;
  onTabSelect: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onNewTab: () => void;
  onTogglePin: (tabId: string) => void;
  onViewHistory?: (tabId: string) => void;
}

export const TabBar: React.FC<TabBarProps> = ({
  tabs,
  activeTabId,
  onTabSelect,
  onTabClose,
  onNewTab,
  onTogglePin,
  onViewHistory
}) => {
  const [contextMenuTab, setContextMenuTab] = useState<string | null>(null);
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });
  const [showTabMenu, setShowTabMenu] = useState(false);
  const [menuSelectedIndex, setMenuSelectedIndex] = useState<number>(-1);
  const tabBarRef = useRef<HTMLDivElement>(null);
  const tabMenuRef = useRef<HTMLDivElement>(null);

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

  const handleViewHistory = useCallback(() => {
    if (contextMenuTab && onViewHistory) {
      onViewHistory(contextMenuTab);
    }
    closeContextMenu();
  }, [contextMenuTab, onViewHistory, closeContextMenu]);

  // Toggle tab menu
  const toggleTabMenu = useCallback(() => {
    setShowTabMenu(!showTabMenu);
    setMenuSelectedIndex(-1);
  }, [showTabMenu]);

  // Handle tab menu item click
  const handleTabMenuSelect = useCallback((tabId: string) => {
    onTabSelect(tabId);
    setShowTabMenu(false);
    setMenuSelectedIndex(-1);
  }, [onTabSelect]);

  // Close all tabs from menu
  const handleCloseAllFromMenu = useCallback(() => {
    tabs.forEach(tab => {
      onTabClose(tab.id);
    });
    setShowTabMenu(false);
    setMenuSelectedIndex(-1);
  }, [tabs, onTabClose]);


  // Click outside to close context menu
  React.useEffect(() => {
    if (contextMenuTab) {
      const handleClickOutside = () => closeContextMenu();
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [contextMenuTab, closeContextMenu]);

  // Click outside to close tab menu
  React.useEffect(() => {
    if (showTabMenu) {
      const handleClickOutside = (e: MouseEvent) => {
        if (tabMenuRef.current && !tabMenuRef.current.contains(e.target as Node)) {
          setShowTabMenu(false);
          setMenuSelectedIndex(-1);
        }
      };
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [showTabMenu]);

  // Keyboard navigation for dropdown menu
  React.useEffect(() => {
    if (!showTabMenu) return;

    const handleMenuKeyDown = (e: KeyboardEvent) => {
      const totalItems = tabs.length + 1; // 1 for "Close All"
      
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setMenuSelectedIndex(prev => {
            const next = prev + 1;
            return next >= totalItems ? 0 : next;
          });
          break;
          
        case 'ArrowUp':
          e.preventDefault();
          setMenuSelectedIndex(prev => {
            const next = prev - 1;
            return next < 0 ? totalItems - 1 : next;
          });
          break;
          
        case 'Enter':
        case ' ':
          e.preventDefault();
          if (menuSelectedIndex === 0) {
            handleCloseAllFromMenu();
          } else if (menuSelectedIndex >= 1 && menuSelectedIndex < totalItems) {
            const tabIndex = menuSelectedIndex - 1;
            handleTabMenuSelect(tabs[tabIndex].id);
          }
          break;
          
        case 'Escape':
          e.preventDefault();
          setShowTabMenu(false);
          setMenuSelectedIndex(-1);
          break;
          
        default:
          // Number keys 1-9 for quick tab selection
          if (e.key >= '1' && e.key <= '9') {
            e.preventDefault();
            const index = parseInt(e.key) - 1;
            if (index < tabs.length) {
              handleTabMenuSelect(tabs[index].id);
            }
          }
          break;
      }
    };

    window.addEventListener('keydown', handleMenuKeyDown);
    return () => window.removeEventListener('keydown', handleMenuKeyDown);
  }, [showTabMenu, menuSelectedIndex, tabs, handleCloseAllFromMenu, handleTabMenuSelect]);

  // Keyboard shortcuts
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle shortcuts if menu is open
      if (showTabMenu) return;
      
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
  }, [tabs, activeTabId, onTabSelect, onTabClose, onNewTab, showTabMenu]);

  if (tabs.length === 0) {
    return null;
  }

  return (
    <>
      <div className="tab-bar-container">
        <div className="tab-bar-scrollable" ref={tabBarRef}>
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
        </div>
        
        <div className="tab-bar-actions">
          <div className="tab-menu-container" ref={tabMenuRef}>
            <button
              className="tab-menu-button"
              onClick={toggleTabMenu}
              title="Tab menu"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                <path d="M6 8L2 4h8z"/>
              </svg>
            </button>
            
            {showTabMenu && (
              <div className="tab-menu-dropdown" role="menu" aria-label="Tab menu">
                <div className="tab-menu-section">
                  <div 
                    className={`tab-menu-item tab-menu-action ${menuSelectedIndex === 0 ? 'selected' : ''}`}
                    onClick={handleCloseAllFromMenu}
                    role="menuitem"
                    tabIndex={0}
                  >
                    Close All Tabs
                  </div>
                </div>
                {tabs.length > 0 && (
                  <>
                    <div className="tab-menu-separator" />
                    <div className="tab-menu-section tab-menu-list">
                      {tabs.map((tab, index) => (
                        <div
                          key={tab.id}
                          className={`tab-menu-item ${tab.id === activeTabId ? 'active' : ''} ${menuSelectedIndex === index + 1 ? 'selected' : ''}`}
                          onClick={() => handleTabMenuSelect(tab.id)}
                          role="menuitem"
                          tabIndex={0}
                        >
                          <span className="tab-menu-index">{index + 1}</span>
                          <span className="tab-menu-title">
                            {tab.isPinned && '📌 '}
                            {tab.fileName}
                            {tab.isDirty && ' •'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
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
          {onViewHistory && (
            <>
              <div className="context-menu-separator" />
              <div className="context-menu-item" onClick={handleViewHistory}>
                View History...
              </div>
            </>
          )}
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