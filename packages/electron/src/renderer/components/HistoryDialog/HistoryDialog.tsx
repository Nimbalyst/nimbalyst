import React, { useEffect, useState } from 'react';
import { useHistory } from '../../hooks/useHistory';
import './HistoryDialog.css';

interface HistoryDialogProps {
  isOpen: boolean;
  onClose: () => void;
  filePath: string | null;
  onRestore?: (content: string) => void;
}

export function HistoryDialog({ isOpen, onClose, filePath, onRestore }: HistoryDialogProps) {
  const { snapshots, loading, refreshSnapshots, loadSnapshot, deleteSnapshot } = useHistory(filePath);
  const [selectedSnapshot, setSelectedSnapshot] = useState<string | null>(null);
  const [previewContent, setPreviewContent] = useState<string>('');
  const [loadingPreview, setLoadingPreview] = useState(false);

  useEffect(() => {
    if (isOpen && filePath) {
      refreshSnapshots();
    }
  }, [isOpen, filePath, refreshSnapshots]);

  useEffect(() => {
    // Reset selection when dialog opens/closes
    if (!isOpen) {
      setSelectedSnapshot(null);
      setPreviewContent('');
    }
  }, [isOpen]);

  const handleSnapshotSelect = async (timestamp: string) => {
    setSelectedSnapshot(timestamp);
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
      if (selectedSnapshot === timestamp) {
        setSelectedSnapshot(null);
        setPreviewContent('');
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
                {snapshots.map((snapshot, index) => (
                  <div
                    key={`${snapshot.timestamp}-${snapshot.type}-${index}`}
                    className={`history-item ${selectedSnapshot === snapshot.timestamp ? 'selected' : ''}`}
                    onClick={() => handleSnapshotSelect(snapshot.timestamp)}
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
                ))}
              </div>
            )}
          </div>
          
          <div className="history-preview">
            <div className="history-preview-header">
              <h3>Preview</h3>
              {selectedSnapshot && (
                <button 
                  className="history-restore-button"
                  onClick={handleRestore}
                  disabled={!previewContent}
                >
                  Restore This Version
                </button>
              )}
            </div>
            
            {loadingPreview ? (
              <div className="history-preview-loading">Loading preview...</div>
            ) : selectedSnapshot ? (
              <div className="history-preview-content">
                <pre>{previewContent}</pre>
              </div>
            ) : (
              <div className="history-preview-empty">
                Select a snapshot to preview
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}