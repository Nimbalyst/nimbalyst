import React, { useState, useEffect } from 'react';
import { MaterialSymbol } from '../components/MaterialSymbol';
import './HistoryWindow.css';

interface Snapshot {
  timestamp: string;
  type: 'auto-save' | 'manual' | 'ai-diff' | 'pre-apply';
  size: number;
  baseMarkdownHash: string;
}

export function HistoryWindow() {
  const [filePath, setFilePath] = useState<string>('');
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [selectedSnapshot, setSelectedSnapshot] = useState<Snapshot | null>(null);
  const [previewContent, setPreviewContent] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadHistory = async () => {
      try {
        setLoading(true);
        setError(null);
        
        // Get file path from URL params
        const params = new URLSearchParams(window.location.search);
        const path = params.get('filePath');
        
        if (!path) {
          throw new Error('No file path provided');
        }
        
        setFilePath(path);
        
        // Load snapshots
        const snapshotList = await window.electronAPI.history.listSnapshots(path);
        setSnapshots(snapshotList);
        
        // Select the most recent snapshot by default
        if (snapshotList.length > 0) {
          setSelectedSnapshot(snapshotList[0]);
          loadSnapshot(path, snapshotList[0].timestamp);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load history');
      } finally {
        setLoading(false);
      }
    };
    
    loadHistory();
  }, []);

  const loadSnapshot = async (path: string, timestamp: string) => {
    try {
      const content = await window.electronAPI.history.loadSnapshot(path, timestamp);
      setPreviewContent(content);
    } catch (err) {
      console.error('Failed to load snapshot:', err);
      setPreviewContent('Failed to load snapshot content');
    }
  };

  const handleSnapshotSelect = (snapshot: Snapshot) => {
    setSelectedSnapshot(snapshot);
    loadSnapshot(filePath, snapshot.timestamp);
  };

  const handleRestore = async () => {
    if (!selectedSnapshot || !previewContent) return;
    
    const confirmed = window.confirm(
      `Are you sure you want to restore this version from ${formatDate(selectedSnapshot.timestamp)}? This will replace the current file content.`
    );
    
    if (confirmed) {
      try {
        // Send the content back to the main window via IPC
        // The main window will handle actually updating the editor content
        if (window.electronAPI.sendToMainWindow) {
          await window.electronAPI.sendToMainWindow('restore-from-history', {
            filePath,
            content: previewContent,
            timestamp: selectedSnapshot.timestamp
          });
        }
        window.close();
      } catch (err) {
        alert('Failed to restore snapshot');
      }
    }
  };

  const handleDelete = async (snapshot: Snapshot) => {
    const confirmed = window.confirm(
      `Are you sure you want to delete this snapshot from ${formatDate(snapshot.timestamp)}?`
    );
    
    if (confirmed) {
      try {
        await window.electronAPI.history.deleteSnapshot(filePath, snapshot.timestamp);
        
        // Reload snapshots
        const snapshotList = await window.electronAPI.history.listSnapshots(filePath);
        setSnapshots(snapshotList);
        
        // Clear selection if deleted snapshot was selected
        if (selectedSnapshot?.timestamp === snapshot.timestamp) {
          setSelectedSnapshot(null);
          setPreviewContent('');
        }
      } catch (err) {
        alert('Failed to delete snapshot');
      }
    }
  };

  const formatDate = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleString();
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'auto-save':
        return 'save';
      case 'manual':
        return 'bookmark';
      case 'ai-diff':
        return 'smart_toy';
      case 'pre-apply':
        return 'backup';
      default:
        return 'history';
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'auto-save':
        return 'Auto-save';
      case 'manual':
        return 'Manual';
      case 'ai-diff':
        return 'AI Edit';
      case 'pre-apply':
        return 'Pre-apply';
      default:
        return type;
    }
  };

  if (loading) {
    return (
      <div className="history-window loading">
        <MaterialSymbol icon="hourglass_empty" size={48} />
        <p>Loading history...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="history-window error">
        <MaterialSymbol icon="error" size={48} />
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className="history-window">
      <div className="history-header">
        <h1>File History</h1>
        <p className="file-path">{filePath}</p>
      </div>
      
      <div className="history-content">
        <div className="snapshots-list">
          <div className="snapshots-header">
            <h2>Snapshots ({snapshots.length})</h2>
          </div>
          
          {snapshots.length === 0 ? (
            <div className="no-snapshots">
              <MaterialSymbol icon="history_toggle_off" size={48} />
              <p>No snapshots available</p>
            </div>
          ) : (
            <div className="snapshots">
              {snapshots.map((snapshot) => (
                <div
                  key={snapshot.timestamp}
                  className={`snapshot-item ${selectedSnapshot?.timestamp === snapshot.timestamp ? 'selected' : ''}`}
                  onClick={() => handleSnapshotSelect(snapshot)}
                >
                  <div className="snapshot-icon">
                    <MaterialSymbol icon={getTypeIcon(snapshot.type)} size={20} />
                  </div>
                  <div className="snapshot-info">
                    <div className="snapshot-date">{formatDate(snapshot.timestamp)}</div>
                    <div className="snapshot-meta">
                      <span className="snapshot-type">{getTypeLabel(snapshot.type)}</span>
                      <span className="snapshot-size">{formatSize(snapshot.size)}</span>
                    </div>
                  </div>
                  <button
                    className="snapshot-delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(snapshot);
                    }}
                    title="Delete snapshot"
                  >
                    <MaterialSymbol icon="delete" size={18} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        
        <div className="snapshot-preview">
          <div className="preview-header">
            <h2>Preview</h2>
            {selectedSnapshot && (
              <div className="preview-actions">
                <button className="btn-restore" onClick={handleRestore}>
                  <MaterialSymbol icon="restore" size={18} />
                  Restore This Version
                </button>
              </div>
            )}
          </div>
          
          {selectedSnapshot ? (
            <div className="preview-content">
              <pre>{previewContent}</pre>
            </div>
          ) : (
            <div className="no-preview">
              <MaterialSymbol icon="preview_off" size={48} />
              <p>Select a snapshot to preview</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}