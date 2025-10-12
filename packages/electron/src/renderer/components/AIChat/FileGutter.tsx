import React, { useState, useEffect } from 'react';
import './FileGutter.css';

interface FileGutterProps {
  sessionId: string | null;
  workspacePath?: string;
  type: 'referenced' | 'edited';
  onFileClick?: (filePath: string) => void;
}

export function FileGutter({ sessionId, workspacePath, type, onFileClick }: FileGutterProps) {
  const [files, setFiles] = useState<string[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    // console.log('[FileGutter] useEffect triggered:', { sessionId, type });
    if (!sessionId) {
      console.log('[FileGutter] No sessionId, clearing files');
      setFiles([]);
      return;
    }

    const fetchFiles = async () => {
      try {
        // console.log('[FileGutter] Fetching files for session:', sessionId, 'type:', type);
        if (typeof window !== 'undefined' && (window as any).electronAPI) {
          const result = await (window as any).electronAPI.invoke(
            'session-files:get-by-session',
            sessionId,
            type
          );
          // console.log('[FileGutter] Fetch result:', result);
          if (result.success && result.files) {
            // Extract unique file paths
            const uniquePaths = Array.from(new Set(result.files.map((f: any) => f.filePath)));
            // console.log('[FileGutter] Setting files:', uniquePaths);
            setFiles(uniquePaths);
          } else {
            console.log('[FileGutter] No files in result or failed');
          }
        } else {
          console.log('[FileGutter] electronAPI not available');
        }
      } catch (error) {
        console.error('[FileGutter] Failed to fetch file links:', error);
      }
    };

    fetchFiles();
  }, [sessionId, type]);

  // Listen for file tracking updates and refresh
  useEffect(() => {
    if (!sessionId || typeof window === 'undefined' || !(window as any).electronAPI) {
      return;
    }

    const handleFileUpdate = async (updatedSessionId: string) => {
      // Only refresh if the update is for this session
      if (updatedSessionId === sessionId) {
        // console.log('[FileGutter] Files updated, refreshing...');
        try {
          const result = await (window as any).electronAPI.invoke(
            'session-files:get-by-session',
            sessionId,
            type
          );
          if (result.success && result.files) {
            const uniquePaths = Array.from(new Set(result.files.map((f: any) => f.filePath)));
            setFiles(uniquePaths);
          }
        } catch (error) {
          console.error('[FileGutter] Failed to refresh file links:', error);
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
  }, [sessionId, type]);

  if (files.length === 0) {
    return null;
  }

  const handleFileClick = (filePath: string) => {
    if (onFileClick) {
      onFileClick(filePath);
    } else if (window.electronAPI && workspacePath) {
      window.electronAPI.invoke('workspace:open-file', { workspacePath, filePath });
    }
  };

  const icon = type === 'referenced' ? (
    <svg style={{ width: '14px', height: '14px' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
    </svg>
  ) : (
    <svg style={{ width: '14px', height: '14px' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
    </svg>
  );

  const label = type === 'referenced' ? 'Referenced' : 'Edited';

  // If only one file, show it directly
  if (files.length === 1) {
    const fileName = files[0].split('/').pop() || files[0];
    return (
      <div className={`file-gutter file-gutter-${type}`}>
        <button
          className="file-gutter-single"
          onClick={() => handleFileClick(files[0])}
          title={files[0]}
        >
          {icon}
          <span className="file-gutter-label">{label}:</span>
          <span className="file-gutter-filename">{fileName}</span>
        </button>
      </div>
    );
  }

  // Multiple files - show count with expansion
  return (
    <div className={`file-gutter file-gutter-${type}`}>
      <button
        className="file-gutter-toggle"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {icon}
        <span className="file-gutter-label">{label}:</span>
        <span className="file-gutter-count">{files.length} files</span>
        <svg
          className={`file-gutter-chevron ${isExpanded ? 'expanded' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          style={{ width: '14px', height: '14px' }}
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isExpanded && (
        <div className="file-gutter-list">
          {files.map((filePath, index) => {
            const fileName = filePath.split('/').pop() || filePath;
            return (
              <button
                key={index}
                className="file-gutter-item"
                onClick={() => handleFileClick(filePath)}
                title={filePath}
              >
                <span className="file-gutter-filename">{fileName}</span>
                <span className="file-gutter-path">{filePath}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
