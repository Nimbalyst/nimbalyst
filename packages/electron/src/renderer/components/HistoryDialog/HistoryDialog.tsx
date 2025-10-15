import React, { useEffect, useState } from 'react';
import { useHistory } from '../../hooks/useHistory';
import { DiffPreviewEditor } from './DiffPreviewEditor';
import { TextDiffViewer } from './TextDiffViewer';
import './HistoryDialog.css';

interface HistoryDialogProps {
  isOpen: boolean;
  onClose: () => void;
  filePath: string | null;
  onRestore?: (content: string) => void;
}

type VersionSelection = {
  timestamp: string;
  label: 'A' | 'B';
};

export function HistoryDialog({ isOpen, onClose, filePath, onRestore }: HistoryDialogProps) {
  const { snapshots, loading, refreshSnapshots, loadSnapshot, deleteSnapshot } = useHistory(filePath);
  const [selectedVersions, setSelectedVersions] = useState<VersionSelection[]>([]);
  const [previewContent, setPreviewContent] = useState<string>('');
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [diffMode, setDiffMode] = useState(false);
  const [diffViewMode, setDiffViewMode] = useState<'rich' | 'text'>('rich');
  const [versionAContent, setVersionAContent] = useState<string>('');
  const [versionBContent, setVersionBContent] = useState<string>('');

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

  const handleSnapshotSelect = async (timestamp: string, isCommandClick: boolean) => {
    // Check if this version is already selected
    const existingIndex = selectedVersions.findIndex(v => v.timestamp === timestamp);

    if (existingIndex >= 0) {
      // Deselect this version
      const newSelections = selectedVersions.filter(v => v.timestamp !== timestamp);
      setSelectedVersions(newSelections);
      setDiffMode(false);

      // If we still have one selection, show its preview
      if (newSelections.length === 1) {
        setLoadingPreview(true);
        try {
          const content = await loadSnapshot(newSelections[0].timestamp);
          if (content) {
            setPreviewContent(content);
          }
        } catch (error) {
          console.error('Failed to load snapshot:', error);
          setPreviewContent('Failed to load snapshot');
        } finally {
          setLoadingPreview(false);
        }
      } else {
        setPreviewContent('');
      }
      return;
    }

    // If not a command-click and we have selections, replace with this one
    if (!isCommandClick && selectedVersions.length > 0) {
      setSelectedVersions([{ timestamp, label: 'A' }]);
      setDiffMode(false);

      // Load preview for the new single selection
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
      return;
    }

    // Add new selection (command-click or first selection)
    if (selectedVersions.length < 2) {
      const label: 'A' | 'B' = selectedVersions.length === 0 ? 'A' : 'B';
      const newSelections = [...selectedVersions, { timestamp, label }];
      setSelectedVersions(newSelections);

      if (newSelections.length === 1) {
        // Single selection - show normal preview
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
      } else if (newSelections.length === 2) {
        // Two selections - load both and enter diff mode
        setLoadingPreview(true);
        try {
          const [versionA, versionB] = newSelections;

          // Determine which is older (A should be older)
          const indexA = snapshots.findIndex(s => s.timestamp === versionA.timestamp);
          const indexB = snapshots.findIndex(s => s.timestamp === versionB.timestamp);

          let olderVersion = versionA;
          let newerVersion = versionB;

          // In the snapshots list, newer versions come first (index 0 is newest)
          // So higher index means older
          if (indexA < indexB) {
            olderVersion = versionB;
            newerVersion = versionA;
          }

          const [contentA, contentB] = await Promise.all([
            loadSnapshot(olderVersion.timestamp),
            loadSnapshot(newerVersion.timestamp),
          ]);

          if (contentA && contentB) {
            setVersionAContent(contentA);
            setVersionBContent(contentB);
            setDiffMode(true);
            // Keep loading overlay visible longer to allow DiffPreviewEditor to render
            setTimeout(() => setLoadingPreview(false), 1200);
          }
        } catch (error) {
          console.error('Failed to load snapshots for diff:', error);
          setLoadingPreview(false);
        }
      }
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

  const handleDelete = async (timestamp: string) => {
    if (window.confirm('Are you sure you want to delete this snapshot?')) {
      await deleteSnapshot(timestamp);
      // Remove from selections if selected
      const newSelections = selectedVersions.filter(v => v.timestamp !== timestamp);
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
      case 'external-change':
        return 'sync_alt';
      case 'auto':
        return 'schedule';
      default:
        return 'description';
    }
  };

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
              <h3>Snapshots ({snapshots.length})</h3>
              {loading && <span className="history-loading">Loading...</span>}
            </div>
            
            {snapshots.length === 0 ? (
              <div className="history-empty">
                No history available for this document
              </div>
            ) : (
              <div className="history-items">
                {snapshots.map((snapshot, index) => {
                  const isSelected = selectedVersions.some(v => v.timestamp === snapshot.timestamp);

                  return (
                  <div
                    key={`${snapshot.timestamp}-${snapshot.type}-${index}`}
                    className={`history-item ${isSelected ? 'selected' : ''}`}
                    onClick={(e) => handleSnapshotSelect(snapshot.timestamp, e.metaKey || e.ctrlKey)}
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
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(snapshot.timestamp);
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
                {diffMode && (
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
                {diffViewMode === 'rich' ? (
                  <DiffPreviewEditor
                    oldMarkdown={versionAContent}
                    newMarkdown={versionBContent}
                  />
                ) : (
                  <TextDiffViewer
                    oldText={versionAContent}
                    newText={versionBContent}
                  />
                )}
              </div>
            ) : selectedVersions.length === 1 ? (
              <div className="history-preview-content">
                <pre>{previewContent}</pre>
              </div>
            ) : (
              <div className="history-preview-empty">
                {selectedVersions.length === 0
                  ? 'Select a snapshot to preview, or Cmd+Click a second snapshot to compare'
                  : 'Cmd+Click another snapshot to see diff comparison'
                }
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