import React from 'react';
import { TabBar } from './TabBar';
import { useTabs } from '../../contexts/TabsContext';
import { editorRegistry } from '@nimbalyst/runtime/ai/EditorRegistry';
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
  isProcessing?: boolean; // Session is actively processing AI response
  hasUnread?: boolean; // Session has unread AI response
  hasUnacceptedChanges?: boolean; // Tab has pending AI diffs that haven't been accepted
}

interface TabManagerProps {
  // NOTE: tabs, activeTabId, onTabSelect, onTogglePin, onTabReorder removed - now comes from useTabs() context
  onTabClose: (tabId: string) => void;
  onNewTab: () => void;
  onViewHistory?: (tabId: string) => void;
  hideTabBar?: boolean;
  isActive?: boolean; // Whether this TabManager's keyboard shortcuts should be active
  onToggleAIChat?: () => void; // Toggle AI Chat panel
  isAIChatCollapsed?: boolean; // Whether AI Chat is collapsed
  children: React.ReactNode;
}

export const TabManager: React.FC<TabManagerProps> = ({
  onTabClose,
  onNewTab,
  onViewHistory,
  hideTabBar = false,
  isActive = true,
  onToggleAIChat,
  isAIChatCollapsed,
  children
}) => {
  if (import.meta.env.DEV) console.log('[TabManager] render');
  // Get tabs from context - this component subscribes to tab changes
  const { tabs, activeTabId, switchTab, togglePin, reorderTabs } = useTabs();

  // Add hasUnacceptedChanges to tabs
  const tabsWithPendingDiffs = tabs.map(tab => ({
    ...tab,
    hasUnacceptedChanges: editorRegistry.getEditor(tab.filePath)?.hasPendingDiffs() || false
  }));

  return (
    <div className="tab-manager">
      {!hideTabBar && tabs.length > 0 && (
        <TabBar
          tabs={tabsWithPendingDiffs}
          activeTabId={activeTabId}
          onTabSelect={switchTab}
          onTabClose={onTabClose}
          onNewTab={onNewTab}
          onTogglePin={togglePin}
          onTabReorder={reorderTabs}
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