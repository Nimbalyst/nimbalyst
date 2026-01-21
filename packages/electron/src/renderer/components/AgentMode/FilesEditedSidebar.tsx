/**
 * FilesEditedSidebar - Shows files edited by AI in the current workstream.
 *
 * Uses the FileEditsSidebar component from runtime with all its features:
 * - Smart folder collapse
 * - Git status indicators
 * - Pending review indicators
 * - Group by directory toggle
 * - Expand/collapse all controls
 *
 * Fetches file edits from the database for ALL sessions in the workstream.
 * Optionally allows filtering by a specific child session.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { FileEditsSidebar as FileEditsSidebarComponent, MaterialSymbol } from '@nimbalyst/runtime';
import type { FileEditSummary } from '@nimbalyst/runtime';
import { diffTreeGroupByDirectoryAtom, setDiffTreeGroupByDirectoryAtom } from '../../store/atoms/projectState';
import { PendingReviewBanner } from '../AIChat/PendingReviewBanner';
import { workstreamSessionsAtom, sessionTitleAtom } from '../../store/atoms/sessions';
import { GitOperationsPanel } from './GitOperationsPanel';
import './FilesEditedSidebar.css';

interface FilesEditedSidebarProps {
  /** The workstream ID (parent session ID) - files from all child sessions will be shown */
  workstreamId: string;
  workspacePath: string;
  onFileClick: (filePath: string) => void;
  width?: number;
}

// Extended FileEditSummary to track which session the edit came from
interface FileEditWithSession extends FileEditSummary {
  sessionId: string;
}

// Helper component to display session title in dropdown option
const SessionFilterOption: React.FC<{ sessionId: string }> = ({ sessionId }) => {
  const title = useAtomValue(sessionTitleAtom(sessionId));
  return <option value={sessionId}>{title || `Session ${sessionId.slice(0, 8)}`}</option>;
};

export const FilesEditedSidebar: React.FC<FilesEditedSidebarProps> = React.memo(({
  workstreamId,
  workspacePath,
  onFileClick,
  width = 256,
}) => {
  const [allFileEdits, setAllFileEdits] = useState<FileEditWithSession[]>([]);
  const [pendingReviewFiles, setPendingReviewFiles] = useState<Set<string>>(new Set());
  const [filterSessionId, setFilterSessionId] = useState<string | null>(null);

  // Get all session IDs in this workstream
  const workstreamSessions = useAtomValue(workstreamSessionsAtom(workstreamId));
  // Show dropdown if there are multiple sessions in the workstream
  const hasMultipleSessions = workstreamSessions.length > 1;

  // Group by directory state from Jotai
  const [groupByDirectory] = useAtom(diffTreeGroupByDirectoryAtom);
  const setDiffTreeGroupByDirectory = useSetAtom(setDiffTreeGroupByDirectoryAtom);

  const setGroupByDirectory = useCallback((value: boolean) => {
    if (workspacePath) {
      setDiffTreeGroupByDirectory({ groupByDirectory: value, workspacePath });
    }
  }, [workspacePath, setDiffTreeGroupByDirectory]);

  // Filter file edits based on selected session
  const fileEdits = useMemo(() => {
    if (!filterSessionId) {
      // Show all files, deduplicated by filePath (most recent edit wins)
      const fileMap = new Map<string, FileEditWithSession>();
      for (const edit of allFileEdits) {
        const existing = fileMap.get(edit.filePath);
        if (!existing || new Date(edit.timestamp) > new Date(existing.timestamp)) {
          fileMap.set(edit.filePath, edit);
        }
      }
      return Array.from(fileMap.values());
    }
    // Filter to specific session
    return allFileEdits.filter(edit => edit.sessionId === filterSessionId);
  }, [allFileEdits, filterSessionId]);

  // Fetch file edits from database for ALL sessions in the workstream
  useEffect(() => {
    if (!workstreamId || !workspacePath || workstreamSessions.length === 0) {
      setAllFileEdits([]);
      return;
    }

    const fetchFileEdits = async () => {
      try {
        if (typeof window !== 'undefined' && window.electronAPI) {
          const allEdits: FileEditWithSession[] = [];

          // Fetch edits from all sessions in the workstream
          await Promise.all(
            workstreamSessions.map(async (sessionId) => {
              const result = await window.electronAPI.invoke(
                'session-files:get-by-session',
                sessionId,
                'edited'
              );
              if (result.success && result.files) {
                const edits: FileEditWithSession[] = result.files.map((f: any) => ({
                  filePath: f.filePath,
                  linkType: 'edited' as const,
                  operation: f.metadata?.operation,
                  linesAdded: f.metadata?.linesAdded,
                  linesRemoved: f.metadata?.linesRemoved,
                  timestamp: f.createdAt || new Date().toISOString(),
                  sessionId,
                }));
                allEdits.push(...edits);
              }
            })
          );

          setAllFileEdits(allEdits);
        }
      } catch (error) {
        console.error('[FilesEditedSidebar] Failed to fetch file edits:', error);
      }
    };

    fetchFileEdits();
  }, [workstreamId, workspacePath, workstreamSessions]);

  // Listen for file tracking updates from any session in the workstream
  useEffect(() => {
    if (!workstreamId || workstreamSessions.length === 0 || typeof window === 'undefined' || !window.electronAPI) {
      return;
    }

    const handleFileUpdate = async (updatedSessionId: string) => {
      // Check if the update is from any session in our workstream
      if (workstreamSessions.includes(updatedSessionId)) {
        try {
          // Re-fetch just the updated session's files
          const result = await window.electronAPI.invoke(
            'session-files:get-by-session',
            updatedSessionId,
            'edited'
          );
          if (result.success && result.files) {
            const newEdits: FileEditWithSession[] = result.files.map((f: any) => ({
              filePath: f.filePath,
              linkType: 'edited' as const,
              operation: f.metadata?.operation,
              linesAdded: f.metadata?.linesAdded,
              linesRemoved: f.metadata?.linesRemoved,
              timestamp: f.createdAt || new Date().toISOString(),
              sessionId: updatedSessionId,
            }));

            // Merge with existing edits: replace edits from the updated session
            setAllFileEdits(prev => {
              const otherEdits = prev.filter(e => e.sessionId !== updatedSessionId);
              return [...otherEdits, ...newEdits];
            });
          }
        } catch (error) {
          console.error('[FilesEditedSidebar] Failed to refresh file edits:', error);
        }
      }
    };

    window.electronAPI.on('session-files:updated', handleFileUpdate);

    return () => {
      if (window.electronAPI?.off) {
        window.electronAPI.off('session-files:updated', handleFileUpdate);
      }
    };
  }, [workstreamId, workstreamSessions]);

  // Fetch pending review files from all sessions in the workstream
  useEffect(() => {
    if (!workstreamId || !workspacePath || workstreamSessions.length === 0) {
      setPendingReviewFiles(new Set());
      return;
    }

    const fetchPendingReviewFiles = async () => {
      try {
        if (typeof window !== 'undefined' && window.electronAPI) {
          const allPendingFiles = new Set<string>();

          // Fetch pending files from all sessions
          await Promise.all(
            workstreamSessions.map(async (sessionId) => {
              const pendingFiles: string[] = await window.electronAPI.invoke(
                'history:get-pending-files-for-session',
                workspacePath,
                sessionId
              );
              pendingFiles.forEach(f => allPendingFiles.add(f));
            })
          );

          setPendingReviewFiles(allPendingFiles);
        }
      } catch (error) {
        console.error('[FilesEditedSidebar] Failed to fetch pending review files:', error);
      }
    };

    fetchPendingReviewFiles();
  }, [workstreamId, workspacePath, workstreamSessions]);

  // Listen for pending diff updates
  useEffect(() => {
    if (!workstreamId || !workspacePath || workstreamSessions.length === 0 || typeof window === 'undefined' || !window.electronAPI) {
      return;
    }

    const handlePendingDiffUpdate = async () => {
      try {
        const allPendingFiles = new Set<string>();

        await Promise.all(
          workstreamSessions.map(async (sessionId) => {
            const pendingFiles: string[] = await window.electronAPI.invoke(
              'history:get-pending-files-for-session',
              workspacePath,
              sessionId
            );
            pendingFiles.forEach(f => allPendingFiles.add(f));
          })
        );

        setPendingReviewFiles(allPendingFiles);
      } catch (error) {
        console.error('[FilesEditedSidebar] Failed to refresh pending review files:', error);
      }
    };

    // Listen for pending count changes in this workspace
    window.electronAPI.on('history:pending-count-changed', handlePendingDiffUpdate);

    return () => {
      if (window.electronAPI?.off) {
        window.electronAPI.off('history:pending-count-changed', handlePendingDiffUpdate);
      }
    };
  }, [workstreamId, workspacePath, workstreamSessions]);

  return (
    <div className="files-edited-sidebar" style={{ width }}>
      {/* Header with Files label and controls */}
      <div className="files-edited-sidebar__header">
        <MaterialSymbol icon="description" size={16} />
        <span className="files-edited-sidebar__title">Files Edited</span>
        {/* Controls */}
        <div className="files-edited-sidebar__controls">
          <button
            onClick={() => setGroupByDirectory(!groupByDirectory)}
            className={`files-edited-sidebar__control-btn ${groupByDirectory ? 'active' : ''}`}
            title="Group by directory"
          >
            <MaterialSymbol icon="folder" size={16} />
          </button>
          <button
            onClick={() => {
              window.dispatchEvent(new CustomEvent('file-edits-sidebar:expand-all'));
            }}
            disabled={!groupByDirectory}
            className="files-edited-sidebar__control-btn"
            title="Expand all"
          >
            <MaterialSymbol icon="unfold_more" size={16} />
          </button>
          <button
            onClick={() => {
              window.dispatchEvent(new CustomEvent('file-edits-sidebar:collapse-all'));
            }}
            disabled={!groupByDirectory}
            className="files-edited-sidebar__control-btn"
            title="Collapse all"
          >
            <MaterialSymbol icon="unfold_less" size={16} />
          </button>
        </div>
      </div>

      {/* Session filter dropdown - only show if there are multiple sessions */}
      {hasMultipleSessions && (
        <div className="files-edited-sidebar__filter">
          <select
            value={filterSessionId || ''}
            onChange={(e) => setFilterSessionId(e.target.value || null)}
            className="files-edited-sidebar__filter-select"
          >
            <option value="">All Sessions</option>
            {workstreamSessions.map((sessionId) => (
              <SessionFilterOption key={sessionId} sessionId={sessionId} />
            ))}
          </select>
        </div>
      )}

      {/* Pending review banner */}
      <PendingReviewBanner workspacePath={workspacePath} sessionId={workstreamId} />

      {/* Files Content */}
      <div className="files-edited-sidebar__content">
        <FileEditsSidebarComponent
          fileEdits={fileEdits}
          onFileClick={onFileClick}
          workspacePath={workspacePath}
          pendingReviewFiles={pendingReviewFiles}
          groupByDirectory={groupByDirectory}
          onGroupByDirectoryChange={setGroupByDirectory}
          hideControls
        />
      </div>

      {/* Git Operations Panel */}
      <GitOperationsPanel
        workspacePath={workspacePath}
        sessionId={workstreamId}
        editedFiles={fileEdits.map((f) => f.filePath)}
      />
    </div>
  );
});

FilesEditedSidebar.displayName = 'FilesEditedSidebar';
