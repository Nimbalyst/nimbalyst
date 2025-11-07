import React, { useCallback, useRef, useState } from 'react';
import { Tab } from './TabManager';

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string | null;
  onTabSelect: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onNewTab: () => void;
  onTogglePin: (tabId: string) => void;
  onTabReorder: (fromIndex: number, toIndex: number) => void;
  onViewHistory?: (tabId: string) => void;
  onReopenLastClosed?: () => void;
  hasClosedTabs?: boolean;
  onTabRename?: (tabId: string, newName: string) => void;
  allowRename?: boolean;
  isActive?: boolean; // Whether this TabBar should handle keyboard shortcuts
  onToggleAIChat?: () => void; // Toggle AI Chat panel
  isAIChatCollapsed?: boolean; // Whether AI Chat is collapsed
}

export const TabBar: React.FC<TabBarProps> = ({
  tabs,
  activeTabId,
  onTabSelect,
  onTabClose,
  onNewTab,
  onTogglePin,
  onTabReorder,
  onViewHistory,
  onReopenLastClosed,
  hasClosedTabs = false,
  onTabRename,
  allowRename = false,
  isActive = true,
  onToggleAIChat,
  isAIChatCollapsed = false
}) => {
  const [contextMenuTab, setContextMenuTab] = useState<string | null>(null);
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });
  const [showTabMenu, setShowTabMenu] = useState(false);
  const [menuSelectedIndex, setMenuSelectedIndex] = useState<number>(-1);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState<string>('');
  const isDraggingRef = useRef(false);
  const tabBarRef = useRef<HTMLDivElement>(null);
  const tabMenuRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const editInputRef = useRef<HTMLInputElement>(null);
  const clickCountRef = useRef<Map<string, number>>(new Map());
  const clickTimerRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  // Handle tab click (including double-click for rename)
  const handleTabClick = useCallback((e: React.MouseEvent, tabId: string) => {
    // Don't handle clicks if we're dragging or editing
    if (isDraggingRef.current || editingTabId) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    // Middle click to close
    if (e.button === 1) {
      onTabClose(tabId);
      return;
    }

    // Left click handling
    if (e.button === 0) {
      // Only handle double-click for rename if allowRename is true and onTabRename exists
      if (allowRename && onTabRename) {
        const clickCount = (clickCountRef.current.get(tabId) || 0) + 1;
        clickCountRef.current.set(tabId, clickCount);

        // Clear existing timer
        const existingTimer = clickTimerRef.current.get(tabId);
        if (existingTimer) {
          clearTimeout(existingTimer);
        }

        // Set new timer to reset click count
        const timer = setTimeout(() => {
          clickCountRef.current.set(tabId, 0);
        }, 300); // 300ms double-click window
        clickTimerRef.current.set(tabId, timer);

        // Double-click detected - enter edit mode
        if (clickCount === 2) {
          const tab = tabs.find(t => t.id === tabId);
          if (tab) {
            setEditingTabId(tabId);
            setEditingValue(tab.fileName);
            // Focus input on next tick
            setTimeout(() => {
              editInputRef.current?.focus();
              editInputRef.current?.select();
            }, 0);
          }
          clickCountRef.current.set(tabId, 0);
          return;
        }
      }

      // Single click to select - only if not already active
      if (tabId !== activeTabId) {
        onTabSelect(tabId);
      }
    }
  }, [onTabSelect, onTabClose, activeTabId, editingTabId, allowRename, onTabRename, tabs]);

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

  // Drag and drop handlers
  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    isDraggingRef.current = true;
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index.toString());
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    if (draggedIndex !== null && draggedIndex !== index) {
      setDragOverIndex(index);
    }
  }, [draggedIndex]);

  const handleDragLeave = useCallback(() => {
    setDragOverIndex(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();

    if (draggedIndex !== null && draggedIndex !== dropIndex) {
      onTabReorder(draggedIndex, dropIndex);
    }

    setDraggedIndex(null);
    setDragOverIndex(null);

    // Reset drag flag after a short delay to prevent click from firing
    setTimeout(() => {
      isDraggingRef.current = false;
    }, 100);
  }, [draggedIndex, onTabReorder]);

  const handleDragEnd = useCallback(() => {
    setDraggedIndex(null);
    setDragOverIndex(null);

    // Reset drag flag after a short delay to prevent click from firing
    setTimeout(() => {
      isDraggingRef.current = false;
    }, 100);
  }, []);

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

  // Handle rename completion
  const completeRename = useCallback((save: boolean) => {
    if (editingTabId && save && onTabRename && editingValue.trim()) {
      onTabRename(editingTabId, editingValue.trim());
    }
    setEditingTabId(null);
    setEditingValue('');
  }, [editingTabId, editingValue, onTabRename]);

  // Handle rename input key down
  const handleRenameKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      completeRename(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      completeRename(false);
    }
  }, [completeRename]);

  // Handle rename input blur
  const handleRenameBlur = useCallback(() => {
    completeRename(true);
  }, [completeRename]);


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

  // Auto-scroll active tab into view
  React.useEffect(() => {
    if (!activeTabId) return;

    const activeTabElement = tabRefs.current.get(activeTabId);
    if (activeTabElement && tabBarRef.current) {
      activeTabElement.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'nearest'
      });
    }
  }, [activeTabId]);

  // Keyboard shortcuts
  React.useEffect(() => {
    // Only handle keyboard shortcuts if this TabBar is active
    if (!isActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle shortcuts if menu is open
      if (showTabMenu) return;

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
  }, [tabs, activeTabId, onTabSelect, onTabClose, onNewTab, showTabMenu, isActive]);

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
              ref={(el) => {
                if (el) {
                  tabRefs.current.set(tab.id, el);
                } else {
                  tabRefs.current.delete(tab.id);
                }
              }}
              className={`tab ${tab.id === activeTabId ? 'active' : ''} ${tab.isDirty ? 'dirty' : ''} ${tab.isPinned ? 'pinned' : ''} ${draggedIndex === index ? 'dragging' : ''} ${dragOverIndex === index ? 'drag-over' : ''}`}
              data-tab-type={tab.isVirtual ? 'session' : 'document'}
              data-tab-id={tab.id}
              data-filename={tab.fileName}
              draggable={true}
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, index)}
              onDragEnd={handleDragEnd}
              onClick={(e) => {
                // Only handle left clicks
                if (e.button === 0) {
                  handleTabClick(e, tab.id);
                }
              }}
              onMouseDown={(e) => {
                // Handle middle mouse button for close
                if (e.button === 1) {
                  handleTabClick(e, tab.id);
                }
              }}
              onContextMenu={(e) => handleContextMenu(e, tab.id)}
              title={tab.filePath}
            >
              {tab.isPinned && <span className="tab-pin-icon">📌</span>}
              {tab.isProcessing && (
                <span className="tab-processing-indicator" title="Processing...">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="32 16" strokeLinecap="round">
                      <animateTransform
                        attributeName="transform"
                        type="rotate"
                        from="0 12 12"
                        to="360 12 12"
                        dur="1s"
                        repeatCount="indefinite"
                      />
                    </circle>
                  </svg>
                </span>
              )}
              {tab.hasUnread && !tab.isProcessing && (
                <span className="tab-unread-indicator" title="Unread response"></span>
              )}
              {editingTabId === tab.id ? (
                <input
                  ref={editInputRef}
                  type="text"
                  value={editingValue}
                  onChange={(e) => setEditingValue(e.target.value)}
                  onKeyDown={handleRenameKeyDown}
                  onBlur={handleRenameBlur}
                  onClick={(e) => e.stopPropagation()}
                  className="tab-rename-input"
                  style={{
                    flex: 1,
                    fontSize: '13px',
                    padding: '2px 4px',
                    border: '1px solid var(--primary-color)',
                    borderRadius: '2px',
                    backgroundColor: 'var(--surface-primary)',
                    color: 'var(--text-primary)',
                    outline: 'none'
                  }}
                />
              ) : (
                <span className="tab-title">
                  {tab.fileName}
                  {tab.isDirty && <span className="tab-dirty-indicator">•</span>}
                </span>
              )}
              {!tab.isPinned && (
                <button
                  className="tab-close-button"
                  data-testid={`tab-close-button-${tab.id}`}
                  data-filename={tab.fileName}
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
          {onToggleAIChat && (
            <button
              className="ai-chat-toggle-button"
              onClick={onToggleAIChat}
              title={isAIChatCollapsed ? "Open AI Assistant (⌘⇧A)" : "Close AI Assistant (⌘⇧A)"}
              aria-label={isAIChatCollapsed ? "Open AI Assistant" : "Close AI Assistant"}
            >
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M10 2L11.5 7.5L17 9L11.5 10.5L10 16L8.5 10.5L3 9L8.5 7.5L10 2Z" fill="currentColor"/>
                <path d="M4 3L4.5 4.5L6 5L4.5 5.5L4 7L3.5 5.5L2 5L3.5 4.5L4 3Z" fill="currentColor" opacity="0.6"/>
                <path d="M16 13L16.5 14.5L18 15L16.5 15.5L16 17L15.5 15.5L14 15L15.5 14.5L16 13Z" fill="currentColor" opacity="0.6"/>
              </svg>
            </button>
          )}
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
          {onReopenLastClosed && hasClosedTabs && (
            <>
              <div className="context-menu-separator" />
              <div
                className="context-menu-item"
                onClick={() => {
                  onReopenLastClosed();
                  closeContextMenu();
                }}
              >
                Reopen Closed Tab
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
};