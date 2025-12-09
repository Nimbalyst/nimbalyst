import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useHistory } from '../../hooks/useHistory';
import { DiffPreviewEditor, type DiffNavigationState } from '../HistoryDialog/DiffPreviewEditor';
import { TextDiffViewer, type TextDiffNavigationState } from '../HistoryDialog/TextDiffViewer';
import { MonacoDiffViewer } from '../HistoryDialog/MonacoDiffViewer';
import { getFileType, type EditorType } from '../../utils/fileTypeDetector';
import { getFileName } from '../../utils/pathUtils';
import { WorkspaceHistoryFileTree } from './WorkspaceHistoryFileTree';
import './WorkspaceHistoryDialog.css';

interface WorkspaceFile {
  path: string;
  latestTimestamp: number;
  snapshotCount: number;
  exists: boolean;
}

interface WorkspaceHistoryDialogProps {
  isOpen: boolean;
  onClose: () => void;
  workspacePath: string;
  onFileRestored?: () => void;
  theme?: 'light' | 'dark' | 'crystal-dark';
}

export function WorkspaceHistoryDialog({
  isOpen,
  onClose,
  workspacePath,
  onFileRestored,
  theme = 'light'
}: WorkspaceHistoryDialogProps) {
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [selectedDeletedFiles, setSelectedDeletedFiles] = useState<Set<string>>(new Set());
  const [isRestoring, setIsRestoring] = useState(false);

  // History for selected file
  const { snapshots, loading: snapshotsLoading, refreshSnapshots, loadSnapshot, deleteSnapshot } = useHistory(selectedFilePath);

  // Snapshot selection state
  const [selectedSnapshotTimestamp, setSelectedSnapshotTimestamp] = useState<string | null>(null);
  const [previewContent, setPreviewContent] = useState<string>('');
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [diffMode, setDiffMode] = useState(false);
  const [diffViewMode, setDiffViewMode] = useState<'rich' | 'text'>('rich');
  const [versionAContent, setVersionAContent] = useState<string>('');
  const [versionBContent, setVersionBContent] = useState<string>('');
  const [versionAMeta, setVersionAMeta] = useState<{ type: string; timestamp: string } | null>(null);
  const [versionBMeta, setVersionBMeta] = useState<{ type: string; timestamp: string } | null>(null);
  const [navigationState, setNavigationState] = useState<DiffNavigationState | TextDiffNavigationState | null>(null);

  const fileType: EditorType = useMemo(() => {
    return selectedFilePath ? getFileType(selectedFilePath) : 'markdown';
  }, [selectedFilePath]);

  // Load workspace files on open
  useEffect(() => {
    if (isOpen && workspacePath) {
      loadWorkspaceFiles();
    }
  }, [isOpen, workspacePath]);

  // Reset state when dialog closes
  useEffect(() => {
    if (!isOpen) {
      setFiles([]);
      setSelectedFilePath(null);
      setSelectedDeletedFiles(new Set());
      setSelectedSnapshotTimestamp(null);
      setPreviewContent('');
      setDiffMode(false);
    }
  }, [isOpen]);

  // Handle Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  // Load snapshots when file is selected
  useEffect(() => {
    if (selectedFilePath) {
      refreshSnapshots();
      setSelectedSnapshotTimestamp(null);
      setPreviewContent('');
      setDiffMode(false);
    }
  }, [selectedFilePath, refreshSnapshots]);

  const loadWorkspaceFiles = async () => {
    setLoading(true);
    try {
      // Get all files with history
      const filesWithHistory = await window.electronAPI.invoke('history:list-workspace-files', workspacePath);

      if (filesWithHistory.length === 0) {
        setFiles([]);
        setLoading(false);
        return;
      }

      // Check which files exist
      const filePaths = filesWithHistory.map((f: any) => f.path);
      const existsMap = await window.electronAPI.invoke('history:check-files-exist', filePaths);

      // Combine data
      const filesWithExistence: WorkspaceFile[] = filesWithHistory.map((f: any) => ({
        path: f.path,
        latestTimestamp: f.latestTimestamp,
        snapshotCount: f.snapshotCount,
        exists: existsMap[f.path] ?? false
      }));

      setFiles(filesWithExistence);
    } catch (error) {
      console.error('[WorkspaceHistoryDialog] Failed to load workspace files:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleFileSelect = (filePath: string) => {
    setSelectedFilePath(filePath);
  };

  const handleDeletedFileToggle = (filePath: string, checked: boolean) => {
    setSelectedDeletedFiles(prev => {
      const next = new Set(prev);
      if (checked) {
        next.add(filePath);
      } else {
        next.delete(filePath);
      }
      return next;
    });
  };

  const handleSnapshotSelect = async (timestamp: string, index: number) => {
    setSelectedSnapshotTimestamp(timestamp);

    const previousSnapshot = snapshots[index + 1];

    if (previousSnapshot) {
      await loadDiffMode(previousSnapshot.timestamp, timestamp);
    } else {
      // No previous version - just show the content
      setDiffMode(false);
      setLoadingPreview(true);
      try {
        const content = await loadSnapshot(timestamp);
        if (content) {
          setPreviewContent(content);
        }
      } catch (error) {
        console.error('Failed to load snapshot:', error);
        setPreviewContent('Failed to load snapshot');
      } finally {
        setLoadingPreview(false);
      }
    }
  };

  const loadDiffMode = async (olderTimestamp: string, newerTimestamp: string) => {
    setLoadingPreview(true);
    try {
      const indexOlder = snapshots.findIndex(s => s.timestamp === olderTimestamp);
      const indexNewer = snapshots.findIndex(s => s.timestamp === newerTimestamp);

      let actualOlderTimestamp = olderTimestamp;
      let actualNewerTimestamp = newerTimestamp;

      if (indexOlder < indexNewer) {
        actualOlderTimestamp = newerTimestamp;
        actualNewerTimestamp = olderTimestamp;
      }

      const snapshotA = snapshots.find(s => s.timestamp === actualOlderTimestamp);
      const snapshotB = snapshots.find(s => s.timestamp === actualNewerTimestamp);

      const [contentA, contentB] = await Promise.all([
        loadSnapshot(actualOlderTimestamp),
        loadSnapshot(actualNewerTimestamp),
      ]);

      if (contentA && contentB && snapshotA && snapshotB) {
        setVersionAContent(contentA);
        setVersionBContent(contentB);
        setVersionAMeta({ type: snapshotA.type, timestamp: snapshotA.timestamp });
        setVersionBMeta({ type: snapshotB.type, timestamp: snapshotB.timestamp });
        setPreviewContent(contentB);
        setDiffMode(true);
        setLoadingPreview(false);
      }
    } catch (error) {
      console.error('Failed to load snapshots for diff:', error);
      setLoadingPreview(false);
    }
  };

  const handleRestoreVersion = async () => {
    if (!selectedFilePath || !selectedSnapshotTimestamp) return;

    const selectedFile = files.find(f => f.path === selectedFilePath);
    const isDeleted = selectedFile && !selectedFile.exists;

    if (isDeleted) {
      const confirmed = window.confirm(
        'This file has been deleted. Restoring will recreate the file on disk. Continue?'
      );
      if (!confirmed) return;
    }

    setIsRestoring(true);
    try {
      const result = await window.electronAPI.invoke(
        'history:restore-deleted-file',
        selectedFilePath,
        selectedSnapshotTimestamp
      );

      if (result.success) {
        // Refresh file list to update exists status
        await loadWorkspaceFiles();
        onFileRestored?.();
      } else {
        alert(`Failed to restore file: ${result.error}`);
      }
    } catch (error: any) {
      console.error('Failed to restore file:', error);
      alert(`Failed to restore file: ${error.message}`);
    } finally {
      setIsRestoring(false);
    }
  };

  const handleBatchRestore = async () => {
    if (selectedDeletedFiles.size === 0) return;

    const count = selectedDeletedFiles.size;
    const confirmed = window.confirm(
      `Restore ${count} deleted file${count > 1 ? 's' : ''} to their most recent versions?`
    );
    if (!confirmed) return;

    setIsRestoring(true);
    try {
      const filePaths = Array.from(selectedDeletedFiles);
      const results = await window.electronAPI.invoke('history:batch-restore-deleted-files', filePaths);

      const successful = results.filter((r: any) => r.success).length;
      const failed = results.filter((r: any) => !r.success);

      if (failed.length > 0) {
        const failedNames = failed.map((r: any) => getFileName(r.path)).join(', ');
        alert(`Restored ${successful} file${successful !== 1 ? 's' : ''}. Failed: ${failedNames}`);
      }

      // Clear selection and refresh
      setSelectedDeletedFiles(new Set());
      await loadWorkspaceFiles();
      onFileRestored?.();
    } catch (error: any) {
      console.error('Failed to batch restore:', error);
      alert(`Failed to restore files: ${error.message}`);
    } finally {
      setIsRestoring(false);
    }
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    if (diff < 3600000) {
      const minutes = Math.floor(diff / 60000);
      return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
    }

    if (diff < 86400000) {
      const hours = Math.floor(diff / 3600000);
      return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
    }

    if (diff < 604800000) {
      const days = Math.floor(diff / 86400000);
      return `${days} day${days !== 1 ? 's' : ''} ago`;
    }

    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  };

  const formatVersionLabel = (type: string, timestamp: string) => {
    const typeLabel = type === 'ai-diff' ? 'AI Edit'
      : type === 'pre-apply' ? 'Pre-edit'
      : type === 'pre-edit' ? 'AI Session Start'
      : type === 'incremental-approval' ? 'Partial Review'
      : type === 'manual' ? 'Manual Save'
      : type === 'auto-save' ? 'Auto-save'
      : type === 'external-change' ? 'External Change'
      : type;

    const timeLabel = formatTimestamp(timestamp);
    return `${typeLabel} ${timeLabel}`;
  };

  const getSnapshotIcon = (type: string) => {
    switch (type) {
      case 'auto-save':
        return 'save';
      case 'manual':
        return 'push_pin';
      case 'ai-diff':
        return 'smart_toy';
      case 'pre-apply':
        return 'bolt';
      case 'pre-edit':
        return 'flag';
      case 'incremental-approval':
        return 'task_alt';
      case 'external-change':
        return 'sync_alt';
      case 'auto':
        return 'schedule';
      default:
        return 'description';
    }
  };

  const handleNavigationStateChange = useCallback((state: DiffNavigationState | TextDiffNavigationState) => {
    setNavigationState(state);
  }, []);

  const deletedFilesCount = files.filter(f => !f.exists).length;
  const selectedFile = files.find(f => f.path === selectedFilePath);
  const isSelectedFileDeleted = selectedFile && !selectedFile.exists;

  if (!isOpen) return null;

  return (
    <div className="workspace-history-dialog-overlay" onClick={onClose}>
      <div className="workspace-history-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="workspace-history-dialog-header">
          <div className="workspace-history-dialog-title">
            <span className="material-symbols-outlined">history</span>
            <h2>Folder History</h2>
          </div>
          <button className="workspace-history-dialog-close" onClick={onClose}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="workspace-history-dialog-content">
          {/* Left Panel - File Tree */}
          <div className="workspace-history-file-panel">
            <div className="workspace-history-file-panel-header">
              <span>Files with History ({files.length} files{deletedFilesCount > 0 ? `, ${deletedFilesCount} deleted` : ''})</span>
              {loading && <span className="workspace-history-loading">Loading...</span>}
            </div>
            <WorkspaceHistoryFileTree
              files={files}
              workspacePath={workspacePath}
              selectedFilePath={selectedFilePath}
              selectedDeletedFiles={selectedDeletedFiles}
              onFileSelect={handleFileSelect}
              onDeletedFileToggle={handleDeletedFileToggle}
            />
          </div>

          {/* Right Panel - History View */}
          <div className="workspace-history-preview-panel">
            <div className="workspace-history-preview-header">
              <div className="workspace-history-preview-header-left">
                {selectedFilePath ? (
                  <>
                    <span className="material-symbols-outlined">description</span>
                    <span className="workspace-history-selected-file">
                      {selectedFilePath.replace(workspacePath + '/', '')}
                    </span>
                    <span className="workspace-history-snapshot-count">
                      ({snapshots.length} snapshot{snapshots.length !== 1 ? 's' : ''})
                    </span>
                  </>
                ) : (
                  <span className="workspace-history-no-selection">Select a file to view history</span>
                )}
              </div>
              <div className="workspace-history-header-buttons">
                {selectedDeletedFiles.size > 0 && (
                  <button
                    className="workspace-history-restore-selected-button"
                    onClick={handleBatchRestore}
                    disabled={isRestoring}
                  >
                    <span className="material-symbols-outlined">restore</span>
                    Restore Selected ({selectedDeletedFiles.size})
                  </button>
                )}
                {selectedFilePath && selectedSnapshotTimestamp && (
                  <button
                    className="workspace-history-restore-button"
                    onClick={handleRestoreVersion}
                    disabled={isRestoring || !previewContent}
                  >
                    <span className="material-symbols-outlined">restore</span>
                    {isSelectedFileDeleted ? 'Restore File' : 'Restore This Version'}
                  </button>
                )}
              </div>
            </div>

            {selectedFilePath ? (
              <div className="workspace-history-preview-content-wrapper">
                {/* Snapshot List */}
                <div className="workspace-history-snapshot-list">
                  {snapshotsLoading ? (
                    <div className="workspace-history-snapshots-loading">Loading snapshots...</div>
                  ) : snapshots.length === 0 ? (
                    <div className="workspace-history-no-snapshots">No snapshots available</div>
                  ) : (
                    snapshots.map((snapshot, index) => (
                      <div
                        key={`${snapshot.timestamp}-${index}`}
                        className={`workspace-history-snapshot-item ${selectedSnapshotTimestamp === snapshot.timestamp ? 'selected' : ''}`}
                        onClick={() => handleSnapshotSelect(snapshot.timestamp, index)}
                      >
                        <div className={`workspace-history-snapshot-icon ${snapshot.type}`}>
                          <span className="material-symbols-outlined">{getSnapshotIcon(snapshot.type)}</span>
                        </div>
                        <div className="workspace-history-snapshot-info">
                          <span className="workspace-history-snapshot-type">{snapshot.type.replace('-', ' ')}</span>
                          <span className="workspace-history-snapshot-time">{formatTimestamp(snapshot.timestamp)}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* Preview Area */}
                <div className="workspace-history-preview-area">
                  {diffMode && versionAMeta && versionBMeta && (
                    <div className="workspace-history-diff-header">
                      <span className="workspace-history-diff-label old">
                        {formatVersionLabel(versionAMeta.type, versionAMeta.timestamp)}
                      </span>
                      <span className="workspace-history-diff-separator">vs</span>
                      <span className="workspace-history-diff-label new">
                        {formatVersionLabel(versionBMeta.type, versionBMeta.timestamp)}
                      </span>
                      {fileType === 'markdown' && (
                        <div className="workspace-history-diff-mode-toggle">
                          <button
                            className={`workspace-history-diff-mode-button ${diffViewMode === 'rich' ? 'active' : ''}`}
                            onClick={() => setDiffViewMode('rich')}
                          >
                            Rich
                          </button>
                          <button
                            className={`workspace-history-diff-mode-button ${diffViewMode === 'text' ? 'active' : ''}`}
                            onClick={() => setDiffViewMode('text')}
                          >
                            Text
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {loadingPreview ? (
                    <div className="workspace-history-preview-loading">
                      <div className="workspace-history-preview-loading-spinner" />
                      Loading preview...
                    </div>
                  ) : diffMode ? (
                    <div className="workspace-history-diff-content">
                      {fileType === 'markdown' ? (
                        diffViewMode === 'rich' ? (
                          <DiffPreviewEditor
                            key={`${versionAMeta?.timestamp}-${versionBMeta?.timestamp}`}
                            oldMarkdown={versionAContent}
                            newMarkdown={versionBContent}
                            onNavigationStateChange={handleNavigationStateChange}
                            onNavigatePrevious={() => {}}
                            onNavigateNext={() => {}}
                            theme={theme}
                          />
                        ) : (
                          <TextDiffViewer
                            key={`${versionAMeta?.timestamp}-${versionBMeta?.timestamp}`}
                            oldText={versionAContent}
                            newText={versionBContent}
                            onNavigationStateChange={handleNavigationStateChange}
                            onNavigatePrevious={() => {}}
                            onNavigateNext={() => {}}
                          />
                        )
                      ) : (
                        <MonacoDiffViewer
                          key={`${versionAMeta?.timestamp}-${versionBMeta?.timestamp}`}
                          oldContent={versionAContent}
                          newContent={versionBContent}
                          filePath={selectedFilePath || ''}
                          theme={theme}
                        />
                      )}
                    </div>
                  ) : selectedSnapshotTimestamp ? (
                    <pre className="workspace-history-preview-text">{previewContent}</pre>
                  ) : (
                    <div className="workspace-history-preview-empty">
                      Select a snapshot to preview
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="workspace-history-no-file-selected">
                <span className="material-symbols-outlined">folder_open</span>
                <p>Select a file from the tree to view its history</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
