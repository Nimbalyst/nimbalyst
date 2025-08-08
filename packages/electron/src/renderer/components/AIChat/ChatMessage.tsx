import React, { useState } from 'react';
import { DiffPreview } from '../DiffPreview/DiffPreview';

interface EditRequest {
  type: 'diff';
  file: string;
  replacements: Array<{
    oldText: string;
    newText: string;
  }>;
}

interface ChatMessageProps {
  role: 'user' | 'assistant';
  content: string;
  edits?: EditRequest[];
  isStreaming?: boolean;
  onApplyEdit?: (edit: EditRequest) => void;
}

export function ChatMessage({ 
  role, 
  content, 
  edits,
  isStreaming,
  onApplyEdit 
}: ChatMessageProps) {
  const [expandedEdits, setExpandedEdits] = useState(false);
  const [appliedEdits, setAppliedEdits] = useState<Set<number>>(new Set());

  const handleApplyEdit = (edit: EditRequest, index: number) => {
    if (onApplyEdit) {
      onApplyEdit(edit);
      setAppliedEdits(prev => new Set(prev).add(index));
    }
  };

  const renderContent = () => {
    // Simple markdown rendering (can be enhanced)
    const lines = content.split('\n');
    return lines.map((line, index) => {
      // Code blocks
      if (line.startsWith('```')) {
        return <div key={index} className="ai-chat-code-fence">{line}</div>;
      }
      // Headers
      if (line.startsWith('#')) {
        const level = line.match(/^#+/)?.[0].length || 1;
        const text = line.replace(/^#+\s*/, '');
        return <div key={index} className={`ai-chat-heading ai-chat-heading--h${level}`}>{text}</div>;
      }
      // Lists
      if (line.match(/^[\*\-]\s+/)) {
        return <div key={index} className="ai-chat-list-item">• {line.replace(/^[\*\-]\s+/, '')}</div>;
      }
      // Regular paragraph
      return <div key={index}>{line || '\u00A0'}</div>;
    });
  };

  return (
    <div className={`ai-chat-message ai-chat-message--${role} ${isStreaming ? 'ai-chat-message--streaming' : ''}`}>
      <div className="ai-chat-message-avatar">
        {role === 'user' ? (
          'U'
        ) : (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M8 1L9 5L13 6L9 7L8 11L7 7L3 6L7 5L8 1Z" fill="currentColor"/>
            <path d="M3 2L3.5 3.5L5 4L3.5 4.5L3 6L2.5 4.5L1 4L2.5 3.5L3 2Z" fill="currentColor" opacity="0.5"/>
            <path d="M13 10L13.5 11.5L15 12L13.5 12.5L13 14L12.5 12.5L11 12L12.5 11.5L13 10Z" fill="currentColor" opacity="0.5"/>
          </svg>
        )}
      </div>
      <div className="ai-chat-message-content">
        {renderContent()}
        
        {/* Show edits if available */}
        {edits && edits.length > 0 && (
          <div className="ai-chat-edits">
            <button 
              className="ai-chat-edits-toggle"
              onClick={() => setExpandedEdits(!expandedEdits)}
            >
              {expandedEdits ? '▼' : '▶'} {edits.length} suggested edit{edits.length > 1 ? 's' : ''}
            </button>
            
            {expandedEdits && (
              <div className="ai-chat-edits-list">
                {edits.map((edit, index) => (
                  <div key={index} className="ai-chat-edit">
                    <div className="ai-chat-edit-header">
                      <span className="ai-chat-edit-type">DIFF</span>
                      <span className="ai-chat-edit-location">
                        {edit.replacements.length} replacement{edit.replacements.length > 1 ? 's' : ''}
                      </span>
                    </div>
                    {edit.replacements.map((replacement, repIndex) => (
                      <div key={repIndex} className="ai-chat-edit-replacement">
                        {replacement.oldText && (
                          <div className="ai-chat-edit-old">
                            <span className="ai-chat-edit-label">Remove:</span>
                            <pre className="ai-chat-edit-content ai-chat-edit-content--remove">
                              {replacement.oldText}
                            </pre>
                          </div>
                        )}
                        {replacement.newText && (
                          <div className="ai-chat-edit-new">
                            <span className="ai-chat-edit-label">Add:</span>
                            <pre className="ai-chat-edit-content ai-chat-edit-content--add">
                              {replacement.newText}
                            </pre>
                          </div>
                        )}
                      </div>
                    ))}
                    <div className="ai-chat-edit-status">
                      <span className="ai-chat-edit-status-text">
                        ✓ Applied to document - use the diff toolbar to approve or reject
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        
        {isStreaming && (
          <span className="ai-chat-cursor">▊</span>
        )}
      </div>
    </div>
  );
}