import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useHistory } from '../../hooks/useHistory';
import { DiffPreviewEditor, type DiffNavigationState } from './DiffPreviewEditor';
import { TextDiffViewer, type TextDiffNavigationState } from './TextDiffViewer';
import { MonacoDiffViewer } from './MonacoDiffViewer';
import { ImageDiffViewer } from './ImageDiffViewer';
import { getFileType, type EditorType } from '../../utils/fileTypeDetector';
import './HistoryDialog.css';

interface HistoryDialogProps {
  isOpen: boolean;
  onClose: () => void;
  filePath: string | null;
  onRestore?: (content: string) => void;
  theme?: 'light' | 'dark' | 'crystal-dark';
}

type VersionSelection = {
  snapshotId: string; // Composite ID: timestamp-hash-index
  timestamp: string; // Stored separately for loadSnapshot calls
  label: 'A' | 'B';
};

// Helper function to generate unique snapshot ID
const getSnapshotId = (snapshot: { timestamp: string; baseMarkdownHash: string }, index: number) => {
  return `${snapshot.timestamp}-${snapshot.baseMarkdownHash}-${index}`;
};

export function HistoryDialog({ isOpen, onClose, filePath, onRestore, theme = 'light' }: HistoryDialogProps) {
  const { snapshots, loading, refreshSnapshots, loadSnapshot, deleteSnapshot } = useHistory(filePath);
  const [selectedVersions, setSelectedVersions] = useState<VersionSelection[]>([]);
  const [previewContent, setPreviewContent] = useState<string>('');
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [diffMode, setDiffMode] = useState(false);
  const [diffViewMode, setDiffViewMode] = useState<'rich' | 'text'>('rich');
  const [compactView, setCompactView] = useState(true);
  const [versionAContent, setVersionAContent] = useState<string>('');
  const [versionBContent, setVersionBContent] = useState<string>('');
  const [versionAMeta, setVersionAMeta] = useState<{ type: string; timestamp: string } | null>(null);
  const [versionBMeta, setVersionBMeta] = useState<{ type: string; timestamp: string } | null>(null);
  const [navigationState, setNavigationState] = useState<DiffNavigationState | TextDiffNavigationState | null>(null);

  // Detect file type
  const fileType: EditorType = useMemo(() => {
    return filePath ? getFileType(filePath) : 'markdown';
  }, [filePath]);

  const displayedSnapshots = useMemo(() => {
    if (!compactView || snapshots.length === 0) {
      return snapshots;
    }

    const importantTypes = ['manual', 'external-change', 'ai-diff', 'pre-apply', 'pre-edit'];
    const minorTypes = ['auto-save', 'auto', 'incremental-approval'];
    const timeGroupInterval = 5 * 60 * 1000; // 5 minutes in milliseconds

    const result = [];
    const grouped: { [key: number]: typeof snapshots } = {};

    // Group minor snapshots by time interval
    for (let i = 0; i < snapshots.length; i++) {
      const snapshot = snapshots[i];
      const isFirst = i === snapshots.length - 1; // oldest (last in array)
      const isLast = i === 0; // newest (first in array)
      const isImportant = importantTypes.includes(snapshot.type);

      if (isFirst || isLast || isImportant) {
        result.push(snapshot);
      } else if (minorTypes.includes(snapshot.type)) {
        const timestamp = new Date(snapshot.timestamp).getTime();
        const groupKey = Math.floor(timestamp / timeGroupInterval);

        if (!grouped[groupKey]) {
          grouped[groupKey] = [];
        }
        grouped[groupKey].push(snapshot);
      } else {
        // Unknown types, include them
        result.push(snapshot);
      }
    }

    // Add one representative from each time group (the newest one)
    Object.values(grouped).forEach((group) => {
      if (group.length > 0) {
        result.push(group[0]); // First item is newest in the group
      }
    });

    // Sort by timestamp (newest first)
    return result.sort((a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }, [snapshots, compactView]);

  useEffect(() => {
    if (isOpen && filePath) {
      refreshSnapshots();
    }
  }, [isOpen, filePath, refreshSnapshots]);

  useEffect(() => {
    // Reset selection when dialog opens/closes
    if (!isOpen) {
      setSelectedVersions([]);
      setPreviewContent('');
      setDiffMode(false);
      setDiffViewMode('rich');
      setVersionAContent('');
      setVersionBContent('');
      setVersionAMeta(null);
      setVersionBMeta(null);
    }
  }, [isOpen]);

  useEffect(() => {
    // Handle Escape key to close dialog
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

  const handleSnapshotSelect = async (snapshotId: string, timestamp: string, clickedIndex: number, isCommandClick: boolean) => {
    // Check if this version is already selected
    const existingIndex = selectedVersions.findIndex(v => v.snapshotId === snapshotId);

    if (existingIndex >= 0) {
      // Deselect this version
      const newSelections = selectedVersions.filter(v => v.snapshotId !== snapshotId);
      setSelectedVersions(newSelections);
      setDiffMode(false);

      // If we still have one selection, load diff with previous version
      if (newSelections.length === 1) {
        const remainingSelection = newSelections[0];
        // Parse the index from the snapshotId (last segment after final dash)
        const idParts = remainingSelection.snapshotId.split('-');
        const remainingIndex = parseInt(idParts[idParts.length - 1]);
        const previousSnapshot = displayedSnapshots[remainingIndex + 1];

        if (previousSnapshot) {
          await loadDiffMode(previousSnapshot.timestamp, remainingSelection.timestamp);
        } else {
          setPreviewContent('');
        }
      } else {
        setPreviewContent('');
      }
      return;
    }

    // Command-click: add to selection for manual diff
    if (isCommandClick) {
      if (selectedVersions.length < 2) {
        const label: 'A' | 'B' = selectedVersions.length === 0 ? 'A' : 'B';
        const newSelections = [...selectedVersions, { snapshotId, timestamp, label }];
        setSelectedVersions(newSelections);

        if (newSelections.length === 2) {
          // Two selections - load both and enter diff mode
          await loadDiffMode(newSelections[0].timestamp, newSelections[1].timestamp);
        }
      }
      return;
    }

    // Regular click: ALWAYS reset to single selection and show diff with previous version
    // This ensures that even if you had command-clicked before, a regular click
    // switches back to the default "diff with previous" behavior
    const previousSnapshot = displayedSnapshots[clickedIndex + 1];

    setSelectedVersions([{ snapshotId, timestamp, label: 'A' }]);

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
      // Determine which is older (A should be older)
      const indexOlder = snapshots.findIndex(s => s.timestamp === olderTimestamp);
      const indexNewer = snapshots.findIndex(s => s.timestamp === newerTimestamp);

      let actualOlderTimestamp = olderTimestamp;
      let actualNewerTimestamp = newerTimestamp;

      // In the snapshots list, newer versions come first (index 0 is newest)
      // So higher index means older
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
        // Set preview content to the newer version for restore functionality
        setPreviewContent(contentB);
        setDiffMode(true);
        setLoadingPreview(false);
      }
    } catch (error) {
      console.error('Failed to load snapshots for diff:', error);
      setLoadingPreview(false);
    }
  };

  const handleRestore = () => {
    console.log('[HistoryDialog] handleRestore called', { 
      hasPreviewContent: !!previewContent, 
      hasOnRestore: !!onRestore,
      contentLength: previewContent?.length 
    });
    if (previewContent && onRestore) {
      onRestore(previewContent);
      onClose();
    } else {
      console.error('[HistoryDialog] Cannot restore:', {
        previewContent: previewContent ? 'exists' : 'missing',
        onRestore: onRestore ? 'exists' : 'missing'
      });
    }
  };

  const handleDelete = async (snapshotId: string, timestamp: string) => {
    if (window.confirm('Are you sure you want to delete this snapshot?')) {
      await deleteSnapshot(timestamp);
      // Remove from selections if selected
      const newSelections = selectedVersions.filter(v => v.snapshotId !== snapshotId);
      if (newSelections.length !== selectedVersions.length) {
        setSelectedVersions(newSelections);
        setPreviewContent('');
        setDiffMode(false);
      }
    }
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    // Less than 1 hour
    if (diff < 3600000) {
      const minutes = Math.floor(diff / 60000);
      return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
    }

    // Less than 24 hours
    if (diff < 86400000) {
      const hours = Math.floor(diff / 3600000);
      return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
    }

    // Less than 7 days
    if (diff < 604800000) {
      const days = Math.floor(diff / 86400000);
      return `${days} day${days !== 1 ? 's' : ''} ago`;
    }

    // Show full date
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

  // Navigation handlers
  const handleNavigatePrevious = useCallback(() => {
    if (diffViewMode === 'rich') {
      (window as any).__richDiffNavigatePrevious?.();
    } else {
      (window as any).__textDiffNavigatePrevious?.();
    }
  }, [diffViewMode]);

  const handleNavigateNext = useCallback(() => {
    if (diffViewMode === 'rich') {
      (window as any).__richDiffNavigateNext?.();
    } else {
      (window as any).__textDiffNavigateNext?.();
    }
  }, [diffViewMode]);

  const handleNavigationStateChange = useCallback((state: DiffNavigationState | TextDiffNavigationState) => {
    setNavigationState(state);
  }, []);

  if (!isOpen) return null;

  return (
    <div className="history-dialog-overlay" onClick={onClose}>
      <div className="history-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="history-dialog-header">
          <div className="history-dialog-title">
            <h2>{filePath ? filePath.split('/').pop() : 'Document History'}</h2>
            {filePath && <span className="history-dialog-path">{filePath}</span>}
          </div>
          <button className="history-dialog-close" onClick={onClose}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        
        <div className="history-dialog-content">
          <div className="history-list">
            <div className="history-list-header">
              <div className="history-list-header-left">
                <h3>Snapshots ({displayedSnapshots.length}{compactView && snapshots.length !== displayedSnapshots.length ? ` of ${snapshots.length}` : ''})</h3>
                {loading && <span className="history-loading">Loading...</span>}
              </div>
              {snapshots.length > 5 && (
                <button
                  className="history-compact-toggle"
                  onClick={() => setCompactView(!compactView)}
                  title={compactView ? 'Show all versions' : 'Hide minor auto-saves'}
                >
                  <span className="material-symbols-outlined">
                    {compactView ? 'unfold_more' : 'unfold_less'}
                  </span>
                </button>
              )}
            </div>

            {displayedSnapshots.length === 0 ? (
              <div className="history-empty">
                No history available for this document
              </div>
            ) : (
              <div className="history-items">
                {displayedSnapshots.map((snapshot, index) => {
                  const snapshotId = getSnapshotId(snapshot, index);
                  const isSelected = selectedVersions.some(v => v.snapshotId === snapshotId);

                  return (
                  <div
                    key={snapshotId}
                    data-testid={`history-item-${index}`}
                    data-snapshot-id={snapshotId}
                    data-snapshot-type={snapshot.type}
                    data-selected={isSelected}
                    className={`history-item ${isSelected ? 'selected' : ''}`}
                    onClick={(e) => handleSnapshotSelect(snapshotId, snapshot.timestamp, index, e.metaKey || e.ctrlKey)}
                  >
                    <div className="history-item-content">
                      <div className="history-item-main">
                        <span className="history-item-icon material-symbols-outlined">{getSnapshotIcon(snapshot.type)}</span>
                        <div className="history-item-info">
                          <span className="history-item-type">{snapshot.type.replace('-', ' ')}</span>
                          <span className="history-item-time">{formatTimestamp(snapshot.timestamp)}</span>
                        </div>
                      </div>
                      <div className="history-item-actions">
                        <span className="history-item-size">{(snapshot.size / 1024).toFixed(1)} KB</span>
                        <button
                          className="history-item-delete"
                          data-testid={`history-item-delete-${index}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(snapshotId, snapshot.timestamp);
                          }}
                          title="Delete snapshot"
                        >
                          <span className="material-symbols-outlined">delete</span>
                        </button>
                      </div>
                    </div>
                  </div>
                  );
                })}
              </div>
            )}
          </div>
          
          <div className="history-preview">
            <div className="history-preview-header">
              <div className="history-preview-header-left">
                <h3>{diffMode ? 'Diff Preview' : 'Preview'}</h3>
                {diffMode && versionAMeta && versionBMeta && (
                  <div className="diff-version-labels">
                    <span className="diff-version-label diff-version-old">
                      {formatVersionLabel(versionAMeta.type, versionAMeta.timestamp)}
                    </span>
                    <span className="diff-version-separator">vs</span>
                    <span className="diff-version-label diff-version-new">
                      {formatVersionLabel(versionBMeta.type, versionBMeta.timestamp)}
                    </span>
                  </div>
                )}
                {diffMode && fileType === 'markdown' && (
                  <>
                    <div className="diff-mode-toggle">
                      <button
                        className={`diff-mode-button ${diffViewMode === 'rich' ? 'active' : ''}`}
                        onClick={() => setDiffViewMode('rich')}
                      >
                        Rich
                      </button>
                      <button
                        className={`diff-mode-button ${diffViewMode === 'text' ? 'active' : ''}`}
                        onClick={() => setDiffViewMode('text')}
                      >
                        Text
                      </button>
                    </div>
                    {navigationState && navigationState.totalGroups > 0 && (
                      <div className="diff-navigation-controls">
                        <button
                          className="diff-nav-button"
                          onClick={handleNavigatePrevious}
                          disabled={!navigationState.canGoPrevious}
                          title="Previous change"
                        >
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                            <path d="M6 9L3 6L6 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </button>
                        <span className="diff-change-counter">
                          {navigationState.currentIndex + 1} / {navigationState.totalGroups}
                        </span>
                        <button
                          className="diff-nav-button"
                          onClick={handleNavigateNext}
                          disabled={!navigationState.canGoNext}
                          title="Next change"
                        >
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                            <path d="M6 3L9 6L6 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </button>
                        {diffViewMode === 'text' && 'addedLines' in navigationState && (
                          <div className="diff-stats">
                            <span className="diff-stat diff-stat-added">+{navigationState.addedLines}</span>
                            <span className="diff-stat diff-stat-removed">-{navigationState.removedLines}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
              {selectedVersions.length === 1 && (
                <button
                  className="history-restore-button"
                  onClick={handleRestore}
                  disabled={!previewContent}
                >
                  Restore This Version
                </button>
              )}
            </div>

            {diffMode ? (
              <div className="history-preview-content">
                {fileType === 'markdown' ? (
                  // Markdown files: use rich or text diff
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
                ) : fileType === 'image' ? (
                  // Image files: use image diff viewer
                  <ImageDiffViewer
                    key={`${versionAMeta?.timestamp}-${versionBMeta?.timestamp}`}
                    oldImagePath={filePath || ''}
                    newImagePath={filePath || ''}
                    filePath={filePath || ''}
                  />
                ) : (
                  // Code files: use Monaco diff viewer
                  <MonacoDiffViewer
                    key={`${versionAMeta?.timestamp}-${versionBMeta?.timestamp}`}
                    oldContent={versionAContent}
                    newContent={versionBContent}
                    filePath={filePath || ''}
                    theme={theme}
                  />
                )}
              </div>
            ) : selectedVersions.length === 1 ? (
              <div className="history-preview-content">
                {fileType === 'image' ? (
                  <div className="image-preview">
                    <img src={`file://${filePath}`} alt="Preview" />
                  </div>
                ) : (
                  <pre>{previewContent}</pre>
                )}
              </div>
            ) : (
              <div className="history-preview-empty">
                Select a snapshot to see diff with previous version, or Cmd+Click two snapshots to compare any versions
              </div>
            )}

            {loadingPreview && (diffViewMode === 'rich' || !diffMode) && (
              <div className="history-preview-loading">
                <div className="history-preview-loading-spinner" />
                <div className="history-preview-loading-text">
                  {selectedVersions.length === 2 ? 'Loading diff...' : 'Loading preview...'}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}