import React from 'react';

interface InstallationProgressProps {
  title: string;
  status: string;
  progress: number;
  logs: string[];
  onClose: () => void;
}

export function InstallationProgress({
  title,
  status,
  progress,
  logs,
  onClose
}: InstallationProgressProps) {
  return (
    <div className="installation-progress-modal">
      <div className="installation-progress-content">
        <div className="installation-progress-header">
          <h3 className="installation-progress-title">{title}</h3>
        </div>
        
        <div className="installation-progress-body">
          <div className="installation-progress-status">{status}</div>
          
          <div className="installation-progress-bar">
            <div
              className="installation-progress-fill"
              style={{
                width: `${Math.max(0, Math.min(100, progress))}%`,
                background: progress === 0 ? 'transparent' : '#007acc'
              }}
            />
          </div>
          
          {logs.length > 0 && (
            <div className="installation-progress-log">
              {logs.slice(-10).map((log, index) => (
                <div key={index}>{log}</div>
              ))}
            </div>
          )}
        </div>
        
        <div className="installation-progress-footer">
          <button 
            className="installation-progress-cancel"
            onClick={onClose}
          >
            {progress === 100 ? 'Close' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  );
}