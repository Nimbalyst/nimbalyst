import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { SessionData } from '../../../ai/server/types';
import type { TranscriptSettings, PromptMarker, FileEditSummary } from '../types';
import { RichTranscriptView } from './RichTranscriptView';
import { TranscriptSidebar } from './TranscriptSidebar';
import { FileEditsSidebar } from './FileEditsSidebar';
import { formatISO } from '../../../utils/dateUtils';

type SidebarTab = 'prompts' | 'files';

interface AgentTranscriptPanelProps {
  sessionId: string;
  sessionData: SessionData;
  onSettingsChange?: (settings: TranscriptSettings) => void;
  showSettings?: boolean;
  initialSettings?: TranscriptSettings;
  onFileClick?: (filePath: string) => void;
  hideSidebar?: boolean;  // Hide the prompts/files sidebar
}

export const AgentTranscriptPanel: React.FC<AgentTranscriptPanelProps> = ({
  sessionId,
  sessionData,
  onSettingsChange,
  showSettings,
  initialSettings,
  onFileClick,
  hideSidebar = false
}) => {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    const stored = localStorage.getItem(`agent-transcript-sidebar-${sessionId}`);
    return stored === 'true';
  });

  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const stored = localStorage.getItem(`agent-transcript-sidebar-width-${sessionId}`);
    return stored ? parseInt(stored, 10) : 256; // 16rem = 256px
  });

  const [activeTab, setActiveTab] = useState<SidebarTab>(() => {
    const stored = localStorage.getItem(`agent-transcript-tab-${sessionId}`);
    return (stored as SidebarTab) || 'prompts';
  });

  const [prompts, setPrompts] = useState<PromptMarker[]>([]);
  const [fileEdits, setFileEdits] = useState<FileEditSummary[]>([]);
  const transcriptRef = useRef<{ scrollToMessage: (index: number) => void }>(null);

  // Resize logic
  const [isDragging, setIsDragging] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(sidebarWidth);

  // Save sidebar state
  useEffect(() => {
    localStorage.setItem(`agent-transcript-sidebar-${sessionId}`, String(isSidebarCollapsed));
  }, [isSidebarCollapsed, sessionId]);

  // Save sidebar width
  useEffect(() => {
    localStorage.setItem(`agent-transcript-sidebar-width-${sessionId}`, String(sidebarWidth));
  }, [sidebarWidth, sessionId]);

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
      timestamp: formatISO(msg.timestamp) || new Date().toISOString(),
      completionTimestamp: undefined
    }));

    setPrompts(markers);
  }, [sessionData.messages, sessionId]);

  // Extract file edits from database
  useEffect(() => {
    // Fetch file links from database via IPC
    const fetchFileLinks = async () => {
      try {
        if (typeof window !== 'undefined' && (window as any).electronAPI) {
          const result = await (window as any).electronAPI.invoke('session-files:get-by-session', sessionId);
          if (result.success && result.files) {
            // Transform FileLink[] to FileEditSummary[]
            const fileEditsFromDb: FileEditSummary[] = result.files.map((file: any) => ({
              filePath: file.filePath,
              linkType: file.linkType,
              operation: file.metadata?.operation,
              linesAdded: file.metadata?.linesAdded,
              linesRemoved: file.metadata?.linesRemoved,
              timestamp: new Date(file.timestamp).toISOString(),
              metadata: file.metadata
            }));
            setFileEdits(fileEditsFromDb);
          }
        }
      } catch (error) {
        console.error('Failed to fetch file links:', error);
      }
    };

    fetchFileLinks();
  }, [sessionData.metadata, sessionId]);

  // Listen for file tracking updates and refresh
  useEffect(() => {
    if (typeof window === 'undefined' || !(window as any).electronAPI) {
      return;
    }

    const handleFileUpdate = async (updatedSessionId: string) => {
      // Only refresh if the update is for this session
      if (updatedSessionId === sessionId) {
        console.log('[AgentTranscriptPanel] Files updated, refreshing...');
        try {
          const result = await (window as any).electronAPI.invoke('session-files:get-by-session', sessionId);
          if (result.success && result.files) {
            const fileEditsFromDb: FileEditSummary[] = result.files.map((file: any) => ({
              filePath: file.filePath,
              linkType: file.linkType,
              operation: file.metadata?.operation,
              linesAdded: file.metadata?.linesAdded,
              linesRemoved: file.metadata?.linesRemoved,
              timestamp: new Date(file.timestamp).toISOString(),
              metadata: file.metadata
            }));
            setFileEdits(fileEditsFromDb);
          }
        } catch (error) {
          console.error('Failed to refresh file links:', error);
        }
      }
    };

    // Register listener
    (window as any).electronAPI.on('session-files:updated', handleFileUpdate);

    // Cleanup
    return () => {
      if ((window as any).electronAPI?.off) {
        (window as any).electronAPI.off('session-files:updated', handleFileUpdate);
      }
    };
  }, [sessionId]);

  const handleNavigateToPrompt = useCallback((marker: PromptMarker) => {
    transcriptRef.current?.scrollToMessage(marker.outputIndex);
  }, []);

  // Handle resize drag
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    startXRef.current = e.clientX;
    startWidthRef.current = sidebarWidth;
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  }, [sidebarWidth]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = startXRef.current - e.clientX; // Note: reversed because sidebar is on right
      const newWidth = Math.max(200, Math.min(600, startWidthRef.current + deltaX));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  return (
    <div style={{ display: 'flex', height: '100%', position: 'relative' }}>
      {/* Main Content */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <RichTranscriptView
          ref={transcriptRef}
          sessionId={sessionId}
          sessionStatus={sessionData.metadata?.sessionStatus as string}
          messages={sessionData.messages}
          provider={sessionData.provider}
          settings={initialSettings}
          onSettingsChange={onSettingsChange}
          showSettings={showSettings}
          documentContext={sessionData.documentContext}
        />
      </div>

      {/* Toggle Button - hidden if hideSidebar is true */}
      {!hideSidebar && <button
        onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        style={{
          position: 'absolute',
          top: '1rem',
          right: isSidebarCollapsed ? '0' : `${sidebarWidth}px`,
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
      </button>}

      {/* Sidebar with tabs - hidden if hideSidebar is true */}
      {!hideSidebar && (
        <>
          {/* Draggable Divider */}
          {!isSidebarCollapsed && (
            <div
              onMouseDown={handleMouseDown}
              style={{
                width: '4px',
                cursor: 'ew-resize',
                background: isDragging ? 'var(--border-focus)' : 'var(--border-primary)',
                transition: isDragging ? 'none' : 'background-color 0.15s ease',
                flexShrink: 0,
                position: 'relative'
              }}
            >
              <div style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                width: '8px',
                height: '40px',
                pointerEvents: 'none'
              }} />
            </div>
          )}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              width: isSidebarCollapsed ? '0' : `${sidebarWidth}px`,
              transition: isSidebarCollapsed ? 'all 0.3s ease-in-out' : 'none',
              flexShrink: 0
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
                  borderBottom: activeTab === 'prompts' ? '2px solid var(--primary-color)' : '2px solid transparent'
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
                  borderBottom: activeTab === 'files' ? '2px solid var(--primary-color)' : '2px solid transparent'
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
                  workspacePath={sessionData.workspacePath}
                />
              )}
            </div>
          </>
        )}
          </div>
        </>
      )}
    </div>
  );
};
