import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { SessionData } from '../../../ai/server/types';
import type { TranscriptSettings, PromptMarker, FileEditSummary, TodoItem } from '../types';
import { RichTranscriptView } from './RichTranscriptView';
import { TranscriptSidebar } from './TranscriptSidebar';
import { FileEditsSidebar } from './FileEditsSidebar';
import { TodosSidebar } from './TodosSidebar';

type SidebarTab = 'prompts' | 'files' | 'todos';

interface AgentTranscriptPanelProps {
  sessionId: string;
  sessionData: SessionData;
  onSettingsChange?: (settings: TranscriptSettings) => void;
  showSettings?: boolean;
  initialSettings?: TranscriptSettings;
  onFileClick?: (filePath: string) => void;
  onTodoClick?: (todo: TodoItem) => void;
}

export const AgentTranscriptPanel: React.FC<AgentTranscriptPanelProps> = ({
  sessionId,
  sessionData,
  onSettingsChange,
  showSettings,
  initialSettings,
  onFileClick,
  onTodoClick
}) => {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    const stored = localStorage.getItem(`agent-transcript-sidebar-${sessionId}`);
    return stored === 'true';
  });

  const [activeTab, setActiveTab] = useState<SidebarTab>(() => {
    const stored = localStorage.getItem(`agent-transcript-tab-${sessionId}`);
    return (stored as SidebarTab) || 'prompts';
  });

  const [prompts, setPrompts] = useState<PromptMarker[]>([]);
  const [fileEdits, setFileEdits] = useState<FileEditSummary[]>([]);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const transcriptRef = useRef<{ scrollToMessage: (index: number) => void }>(null);

  // Save sidebar state
  useEffect(() => {
    localStorage.setItem(`agent-transcript-sidebar-${sessionId}`, String(isSidebarCollapsed));
  }, [isSidebarCollapsed, sessionId]);

  // Save active tab
  useEffect(() => {
    localStorage.setItem(`agent-transcript-tab-${sessionId}`, activeTab);
  }, [activeTab, sessionId]);

  // Extract prompts from messages
  useEffect(() => {
    const userMessages = sessionData.messages
      .map((msg, index) => ({ msg, index }))
      .filter(({ msg }) => msg.role === 'user');

    const markers: PromptMarker[] = userMessages.map(({ msg, index }, promptIndex) => ({
      id: promptIndex + 1,
      sessionId,
      promptText: msg.content,
      outputIndex: index,
      timestamp: new Date(msg.timestamp).toISOString(),
      completionTimestamp: undefined
    }));

    setPrompts(markers);
  }, [sessionData.messages, sessionId]);

  // Extract file edits and todos from metadata
  useEffect(() => {
    const metadata = sessionData.metadata;
    if (metadata) {
      setFileEdits((metadata.fileEdits as FileEditSummary[]) || []);
      setTodos((metadata.todos as TodoItem[]) || []);
    }
  }, [sessionData.metadata]);

  const handleNavigateToPrompt = useCallback((marker: PromptMarker) => {
    transcriptRef.current?.scrollToMessage(marker.outputIndex);
  }, []);

  return (
    <div style={{ display: 'flex', height: '100%', position: 'relative' }}>
      {/* Main Content */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <RichTranscriptView
          ref={transcriptRef}
          sessionId={sessionId}
          sessionStatus={sessionData.metadata?.sessionStatus as string}
          messages={sessionData.messages}
          settings={initialSettings}
          onSettingsChange={onSettingsChange}
          showSettings={showSettings}
        />
      </div>

      {/* Toggle Button */}
      <button
        onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        style={{
          position: 'absolute',
          top: '1rem',
          right: isSidebarCollapsed ? '0' : '16rem',
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          gap: '0.25rem',
          padding: '0.5rem',
          backgroundColor: 'var(--surface-secondary)',
          border: '1px solid var(--border-primary)',
          borderRadius: isSidebarCollapsed ? '0.5rem' : '0.5rem 0 0 0.5rem',
          transition: 'all 0.3s ease-in-out',
          cursor: 'pointer'
        }}
        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--surface-hover)'}
        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--surface-secondary)'}
        title={isSidebarCollapsed ? 'Show prompt history' : 'Hide prompt history'}
      >
        {isSidebarCollapsed ? (
          <>
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ width: '1rem', height: '1rem', color: 'var(--text-secondary)' }}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ width: '1rem', height: '1rem', color: 'var(--text-secondary)' }}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </>
        ) : (
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ width: '1rem', height: '1rem', color: 'var(--text-secondary)' }}>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        )}
      </button>

      {/* Sidebar with tabs */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: isSidebarCollapsed ? '0' : '16rem',
          transition: 'all 0.3s ease-in-out'
        }}
      >
        {!isSidebarCollapsed && (
          <>
            {/* Tab Navigation */}
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border-primary)', backgroundColor: 'var(--surface-secondary)' }}>
              <button
                onClick={() => setActiveTab('prompts')}
                style={{
                  flex: 1,
                  padding: '0.5rem 0.75rem',
                  fontSize: '0.75rem',
                  fontWeight: 500,
                  transition: 'colors 0.2s',
                  color: activeTab === 'prompts' ? 'var(--text-primary)' : 'var(--text-tertiary)',
                  cursor: 'pointer',
                  backgroundColor: 'transparent',
                  border: 'none',
                  borderBottom: activeTab === 'prompts' ? '2px solid var(--color-interactive)' : '2px solid transparent'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem' }}>
                  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ width: '0.875rem', height: '0.875rem' }}>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>Prompts</span>
                  {prompts.length > 0 && (
                    <span style={{ marginLeft: '0.25rem', padding: '0.125rem 0.375rem', backgroundColor: 'var(--surface-tertiary)', borderRadius: '0.25rem', fontSize: '10px' }}>
                      {prompts.length}
                    </span>
                  )}
                </div>
              </button>
              <button
                onClick={() => setActiveTab('files')}
                style={{
                  flex: 1,
                  padding: '0.5rem 0.75rem',
                  fontSize: '0.75rem',
                  fontWeight: 500,
                  transition: 'colors 0.2s',
                  color: activeTab === 'files' ? 'var(--text-primary)' : 'var(--text-tertiary)',
                  cursor: 'pointer',
                  backgroundColor: 'transparent',
                  border: 'none',
                  borderBottom: activeTab === 'files' ? '2px solid var(--color-interactive)' : '2px solid transparent'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem' }}>
                  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ width: '0.875rem', height: '0.875rem' }}>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span>Files</span>
                  {fileEdits.length > 0 && (
                    <span style={{ marginLeft: '0.25rem', padding: '0.125rem 0.375rem', backgroundColor: 'var(--surface-tertiary)', borderRadius: '0.25rem', fontSize: '10px' }}>
                      {fileEdits.length}
                    </span>
                  )}
                </div>
              </button>
              <button
                onClick={() => setActiveTab('todos')}
                style={{
                  flex: 1,
                  padding: '0.5rem 0.75rem',
                  fontSize: '0.75rem',
                  fontWeight: 500,
                  transition: 'colors 0.2s',
                  color: activeTab === 'todos' ? 'var(--text-primary)' : 'var(--text-tertiary)',
                  cursor: 'pointer',
                  backgroundColor: 'transparent',
                  border: 'none',
                  borderBottom: activeTab === 'todos' ? '2px solid var(--color-interactive)' : '2px solid transparent'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem' }}>
                  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ width: '0.875rem', height: '0.875rem' }}>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span>TODOs</span>
                  {todos.length > 0 && (
                    <span style={{ marginLeft: '0.25rem', padding: '0.125rem 0.375rem', backgroundColor: 'var(--surface-tertiary)', borderRadius: '0.25rem', fontSize: '10px' }}>
                      {todos.length}
                    </span>
                  )}
                </div>
              </button>
            </div>

            {/* Tab Content */}
            <div style={{ flex: 1, overflow: 'hidden' }}>
              {activeTab === 'prompts' && (
                <TranscriptSidebar
                  sessionId={sessionId}
                  prompts={prompts}
                  onNavigateToPrompt={handleNavigateToPrompt}
                  isCollapsed={false}
                  onToggleCollapse={() => setIsSidebarCollapsed(true)}
                />
              )}
              {activeTab === 'files' && (
                <FileEditsSidebar
                  fileEdits={fileEdits}
                  onFileClick={onFileClick}
                />
              )}
              {activeTab === 'todos' && (
                <TodosSidebar
                  todos={todos}
                  onTodoClick={onTodoClick}
                />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
