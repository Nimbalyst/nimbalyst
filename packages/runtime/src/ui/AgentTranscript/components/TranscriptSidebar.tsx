import React, { useState, useEffect } from 'react';
import type { PromptMarker } from '../types';
import { formatTimeAgo, formatDuration } from '../../../utils/dateUtils';

interface TranscriptSidebarProps {
  sessionId: string;
  prompts: PromptMarker[];
  onNavigateToPrompt: (marker: PromptMarker) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

export const TranscriptSidebar: React.FC<TranscriptSidebarProps> = ({
  sessionId,
  prompts,
  onNavigateToPrompt,
  isCollapsed,
  onToggleCollapse
}) => {
  const [selectedPromptId, setSelectedPromptId] = useState<number | null>(null);

  const handlePromptClick = (marker: PromptMarker) => {
    setSelectedPromptId(marker.id);
    onNavigateToPrompt(marker);
  };

  return (
    <div style={{
      display: 'flex',
      transition: 'all 0.3s ease-in-out',
      width: isCollapsed ? '0' : '16rem'
    }}>
      {!isCollapsed && (
        <div style={{
          width: '16rem',
          backgroundColor: 'var(--surface-secondary)',
          borderLeft: '1px solid var(--border-primary)',
          display: 'flex',
          flexDirection: 'column',
          height: '100%'
        }}>
          <div style={{
            padding: '0.75rem 1rem',
            borderBottom: '1px solid var(--border-primary)'
          }}>
            <h3 style={{
              fontWeight: 600,
              color: 'var(--text-primary)',
              fontSize: '0.875rem',
              margin: 0
            }}>
              Prompt History
            </h3>
            <p style={{
              fontSize: '0.75rem',
              color: 'var(--text-tertiary)',
              margin: '0.25rem 0 0 0'
            }}>
              Click to navigate
            </p>
          </div>

          <div style={{
            flex: 1,
            overflowY: 'auto'
          }}>
            {prompts.length === 0 ? (
              <div style={{
                padding: '1rem',
                color: 'var(--text-tertiary)',
                fontSize: '0.875rem'
              }}>
                No prompts yet. Start by entering a prompt.
              </div>
            ) : (
              <div style={{ padding: '0.5rem' }}>
                {prompts.map((marker, index) => (
                  <button
                    key={marker.id}
                    onClick={() => handlePromptClick(marker)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '0.75rem',
                      borderRadius: '0.375rem',
                      marginBottom: '0.25rem',
                      transition: 'background-color 0.2s',
                      backgroundColor: selectedPromptId === marker.id
                        ? 'color-mix(in srgb, var(--primary-color) 15%, transparent)'
                        : 'transparent',
                      border: selectedPromptId === marker.id
                        ? '1px solid var(--primary-color)'
                        : '1px solid transparent',
                      cursor: 'pointer',
                      color: 'inherit'
                    }}
                    onMouseEnter={(e) => {
                      if (selectedPromptId !== marker.id) {
                        e.currentTarget.style.backgroundColor = 'var(--surface-hover)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (selectedPromptId !== marker.id) {
                        e.currentTarget.style.backgroundColor = 'transparent';
                      }
                    }}
                  >
                    <div style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '0.5rem'
                    }}>
                      <span style={{
                        color: 'var(--primary-color)',
                        fontFamily: 'monospace',
                        fontSize: '0.75rem',
                        marginTop: '0.125rem',
                        fontWeight: 600
                      }}>
                        #{index + 1}
                      </span>
                      <div style={{
                        flex: 1,
                        minWidth: 0
                      }}>
                        <div style={{
                          fontSize: '0.8125rem',
                          color: 'var(--text-primary)',
                          lineHeight: '1.4',
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden'
                        }}>
                          {marker.promptText}
                        </div>
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem',
                          fontSize: '0.6875rem',
                          color: 'var(--text-tertiary)',
                          marginTop: '0.375rem'
                        }}>
                          <span>{formatTimeAgo(marker.timestamp)}</span>
                          {marker.completionTimestamp && (
                            <>
                              <span>•</span>
                              <span style={{
                                fontWeight: 500,
                                color: 'var(--text-secondary)'
                              }}>
                                {formatDuration(marker.timestamp, marker.completionTimestamp)}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
