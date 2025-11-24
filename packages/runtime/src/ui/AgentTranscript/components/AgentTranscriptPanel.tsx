import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { SessionData } from '../../../ai/server/types';
import type { TranscriptSettings, PromptMarker, FileEditSummary } from '../types';
import { RichTranscriptView } from './RichTranscriptView';
import { TranscriptSidebar } from './TranscriptSidebar';
import { FileEditsSidebar } from './FileEditsSidebar';
import { FloatingTranscriptActions } from './FloatingTranscriptActions';
import { formatISO } from '../../../utils/dateUtils';

interface Todo {
  status: 'pending' | 'in_progress' | 'completed';
  content: string;
  activeForm: string;
}

interface AgentTranscriptPanelProps {
  sessionId: string;
  sessionData: SessionData;
  todos?: Todo[];
  onSettingsChange?: (settings: TranscriptSettings) => void;
  showSettings?: boolean;
  initialSettings?: TranscriptSettings;
  onFileClick?: (filePath: string) => void;
  hideSidebar?: boolean;  // Hide the prompts/files sidebar
  workspacePath?: string; // Explicit workspace path (falls back to sessionData.workspacePath)
}

export const AgentTranscriptPanel: React.FC<AgentTranscriptPanelProps> = ({
  sessionId,
  sessionData,
  todos = [],
  onSettingsChange,
  showSettings,
  initialSettings,
  onFileClick,
  hideSidebar = false,
  workspacePath: workspacePathProp
}) => {
  // Use prop if provided, otherwise fall back to sessionData.workspacePath
  const effectiveWorkspacePath = workspacePathProp || sessionData.workspacePath;
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    const stored = localStorage.getItem(`agent-transcript-sidebar-${sessionId}`);
    return stored === 'true';
  });

  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const stored = localStorage.getItem(`agent-transcript-sidebar-width-${sessionId}`);
    return stored ? parseInt(stored, 10) : 256; // 16rem = 256px
  });

  // Removed activeTab state - sidebar now only shows Files tab

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

  // Removed - no longer need to save active tab since sidebar only shows Files

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

  // Memoize the file update handler to prevent listener leaks
  const handleFileUpdate = useCallback(async (updatedSessionId: string) => {
    // Only refresh if the update is for this session
    if (updatedSessionId === sessionId) {
      // console.log('[AgentTranscriptPanel] Files updated, refreshing...');
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
  }, [sessionId]);

  // Listen for file tracking updates and refresh
  useEffect(() => {
    if (typeof window === 'undefined' || !(window as any).electronAPI) {
      return;
    }

    // Register listener
    (window as any).electronAPI.on('session-files:updated', handleFileUpdate);

    // Cleanup
    return () => {
      if ((window as any).electronAPI?.off) {
        (window as any).electronAPI.off('session-files:updated', handleFileUpdate);
      }
    };
  }, [handleFileUpdate]);

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
    <div className="agent-transcript-panel" style={{ display: 'flex', height: '100%', position: 'relative' }}>
      {/* Main Content */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
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
          workspacePath={effectiveWorkspacePath}
        />

        {/* Floating Actions - hidden if hideSidebar is true */}
        {!hideSidebar && (
          <FloatingTranscriptActions
            prompts={prompts}
            isSidebarCollapsed={isSidebarCollapsed}
            onToggleSidebar={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
            onNavigateToPrompt={handleNavigateToPrompt}
          />
        )}
      </div>

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
            {/* Header with Files label */}
            <div className="session-files-right-panel" style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.75rem',
              borderBottom: '1px solid var(--border-primary)',
              backgroundColor: 'var(--surface-secondary)'
            }}>
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ width: '1rem', height: '1rem', color: 'var(--text-primary)' }}>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>Files</span>
              {fileEdits.length > 0 && (
                <span style={{
                  marginLeft: 'auto',
                  padding: '0.125rem 0.375rem',
                  backgroundColor: 'var(--surface-tertiary)',
                  borderRadius: '0.25rem',
                  fontSize: '11px',
                  fontWeight: 500,
                  color: 'var(--text-tertiary)'
                }}>
                  {fileEdits.length}
                </span>
              )}
            </div>

            {/* Files Content */}
            <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <FileEditsSidebar
                  fileEdits={fileEdits}
                  onFileClick={onFileClick}
                  workspacePath={effectiveWorkspacePath}
                />
              </div>

              {/* TodoList below tab content */}
              {todos && todos.length > 0 && (
                <div style={{
                  borderTop: '1px solid var(--border-primary)',
                  backgroundColor: 'var(--surface-secondary)',
                  padding: '0.75rem',
                  maxHeight: '150px',
                  overflow: 'auto'
                }}>
                  <div style={{ marginBottom: '0.5rem', fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)' }}>
                    Tasks ({todos.filter(t => t.status === 'completed').length}/{todos.length})
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    {todos.map((todo, index) => {
                      const displayText = todo.status === 'in_progress' ? todo.activeForm : todo.content;
                      return (
                        <div key={index} style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: '0.5rem',
                          fontSize: '0.75rem',
                          color: 'var(--text-primary)',
                          opacity: todo.status === 'completed' ? 0.6 : 1
                        }}>
                          <div style={{ marginTop: '2px', flexShrink: 0 }}>
                            {todo.status === 'pending' && <span style={{ fontSize: '0.625rem' }}>○</span>}
                            {todo.status === 'in_progress' && <span style={{ fontSize: '0.625rem', animation: 'spin 1s linear infinite' }}>◐</span>}
                            {todo.status === 'completed' && <span style={{ fontSize: '0.625rem', color: 'var(--primary-color)' }}>●</span>}
                          </div>
                          <div style={{
                            flex: 1,
                            textDecoration: todo.status === 'completed' ? 'line-through' : 'none',
                            wordBreak: 'break-word'
                          }}>
                            {displayText}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
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
