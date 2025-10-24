import React from 'react';
import { TabBar } from './TabBar';
import './TabManager.css';

export interface Tab {
  id: string;
  filePath: string;
  fileName: string;
  content: string;
  isDirty: boolean;
  isPinned: boolean;
  lastSaved?: Date;
  isVirtual?: boolean;
}

interface TabManagerProps {
  tabs: Tab[];
  activeTabId: string | null;
  onTabSelect: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onTogglePin: (tabId: string) => void;
  onTabReorder: (fromIndex: number, toIndex: number) => void;
  onNewTab: () => void;
  onViewHistory?: (tabId: string) => void;
  hideTabBar?: boolean;
  isActive?: boolean; // Whether this TabManager's keyboard shortcuts should be active
  onToggleAIChat?: () => void; // Toggle AI Chat panel
  isAIChatCollapsed?: boolean; // Whether AI Chat is collapsed
  children: React.ReactNode;
}

export const TabManager: React.FC<TabManagerProps> = ({
  tabs,
  activeTabId,
  onTabSelect,
  onTabClose,
  onTogglePin,
  onTabReorder,
  onNewTab,
  onViewHistory,
  hideTabBar = false,
  isActive = true,
  onToggleAIChat,
  isAIChatCollapsed,
  children
}) => {
  return (
    <div className="tab-manager">
      {!hideTabBar && tabs.length > 0 && (
        <TabBar
          tabs={tabs}
          activeTabId={activeTabId}
          onTabSelect={onTabSelect}
          onTabClose={onTabClose}
          onNewTab={onNewTab}
          onTogglePin={onTogglePin}
          onTabReorder={onTabReorder}
          onViewHistory={onViewHistory}
          isActive={isActive}
          onToggleAIChat={onToggleAIChat}
          isAIChatCollapsed={isAIChatCollapsed}
        />
      )}
      <div className="tab-content">
        {children}
      </div>
    </div>
  );
};