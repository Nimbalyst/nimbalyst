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
}

interface TabManagerProps {
  tabs: Tab[];
  activeTabId: string | null;
  onTabSelect: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onTogglePin: (tabId: string) => void;
  onNewTab: () => void;
  onViewHistory?: (tabId: string) => void;
  children: React.ReactNode;
}

export const TabManager: React.FC<TabManagerProps> = ({
  tabs,
  activeTabId,
  onTabSelect,
  onTabClose,
  onTogglePin,
  onNewTab,
  onViewHistory,
  children
}) => {
  return (
    <div className="tab-manager">
      {tabs.length > 0 && (
        <TabBar
          tabs={tabs}
          activeTabId={activeTabId}
          onTabSelect={onTabSelect}
          onTabClose={onTabClose}
          onNewTab={onNewTab}
          onTogglePin={onTogglePin}
          onViewHistory={onViewHistory}
        />
      )}
      <div className="tab-content">
        {children}
      </div>
    </div>
  );
};