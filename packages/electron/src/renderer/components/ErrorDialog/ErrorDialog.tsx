import React, { useState, useCallback } from 'react';
import './ErrorDialog.css';

interface DiffErrorDetails {
  originalMarkdown: string;
  prompt: string;
  claudeResponse: string;
  replacements: Array<{
    oldText: string;
    newText: string;
  }>;
  errorMessage: string;
  timestamp: string;
  filePath?: string;
}

interface ErrorDialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  message: string;
  details?: DiffErrorDetails;
}

export function ErrorDialog({ isOpen, onClose, title, message, details }: ErrorDialogProps) {
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['error']));

  const toggleSection = useCallback((section: string) => {
    setExpandedSections(prev => {
      const newSet = new Set(prev);
      if (newSet.has(section)) {
        newSet.delete(section);
      } else {
        newSet.add(section);
      }
      return newSet;
    });
  }, []);

  const handleCopyDetails = useCallback(() => {
    if (!details) return;

    const debugInfo = {
      error: {
        message: details.errorMessage,
        timestamp: details.timestamp,
        filePath: details.filePath
      },
      prompt: details.prompt,
      claudeResponse: details.claudeResponse,
      replacements: details.replacements,
      documentContent: details.originalMarkdown
    };

    const text = `## Error Details

**Error Message:** ${details.errorMessage}
**Timestamp:** ${details.timestamp}
**File:** ${details.filePath || 'Unknown'}

## Debugging Information

\`\`\`json
${JSON.stringify(debugInfo, null, 2)}
\`\`\`

## Document Content at Time of Error

\`\`\`markdown
${details.originalMarkdown}
\`\`\`

## Prompt Sent to Claude

${details.prompt}

## Claude's Response

${details.claudeResponse}

## Attempted Replacements

${details.replacements.map((r, i) => `
### Replacement ${i + 1}
**Old Text:**
\`\`\`
${r.oldText}
\`\`\`

**New Text:**
\`\`\`
${r.newText}
\`\`\`
`).join('\n')}`;

    navigator.clipboard.writeText(text).then(() => {
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
    });
  }, [details]);

  if (!isOpen) return null;

  return (
    <div className="error-dialog-overlay" onClick={onClose}>
      <div className="error-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="error-dialog-header">
          <h2>{title}</h2>
          <button className="error-dialog-close" onClick={onClose}>×</button>
        </div>
        
        <div className="error-dialog-content">
          <div className="error-dialog-message">
            <div className="error-icon">⚠️</div>
            <p>{message}</p>
          </div>

          {details && (
            <div className="error-dialog-details">
              <div className="error-dialog-actions">
                <button 
                  className="error-dialog-copy-btn"
                  onClick={handleCopyDetails}
                >
                  {copyFeedback ? '✓ Copied!' : 'Copy Debug Info'}
                </button>
              </div>

              <div className="error-dialog-sections">
                <div className="error-section">
                  <button 
                    className={`section-header ${expandedSections.has('error') ? 'expanded' : ''}`}
                    onClick={() => toggleSection('error')}
                  >
                    <span className="section-arrow">▶</span>
                    Error Details
                  </button>
                  {expandedSections.has('error') && (
                    <div className="section-content">
                      <div className="error-field">
                        <strong>Message:</strong> {details.errorMessage}
                      </div>
                      <div className="error-field">
                        <strong>Time:</strong> {details.timestamp}
                      </div>
                      {details.filePath && (
                        <div className="error-field">
                          <strong>File:</strong> {details.filePath}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="error-section">
                  <button 
                    className={`section-header ${expandedSections.has('prompt') ? 'expanded' : ''}`}
                    onClick={() => toggleSection('prompt')}
                  >
                    <span className="section-arrow">▶</span>
                    Prompt
                  </button>
                  {expandedSections.has('prompt') && (
                    <div className="section-content">
                      <pre className="code-block">{details.prompt}</pre>
                    </div>
                  )}
                </div>

                <div className="error-section">
                  <button 
                    className={`section-header ${expandedSections.has('response') ? 'expanded' : ''}`}
                    onClick={() => toggleSection('response')}
                  >
                    <span className="section-arrow">▶</span>
                    Claude's Response
                  </button>
                  {expandedSections.has('response') && (
                    <div className="section-content">
                      <pre className="code-block">{details.claudeResponse}</pre>
                    </div>
                  )}
                </div>

                <div className="error-section">
                  <button 
                    className={`section-header ${expandedSections.has('replacements') ? 'expanded' : ''}`}
                    onClick={() => toggleSection('replacements')}
                  >
                    <span className="section-arrow">▶</span>
                    Attempted Replacements ({details.replacements.length})
                  </button>
                  {expandedSections.has('replacements') && (
                    <div className="section-content">
                      {details.replacements.map((r, i) => (
                        <div key={i} className="replacement-item">
                          <h4>Replacement {i + 1}</h4>
                          <div className="replacement-diff">
                            <div className="diff-old">
                              <strong>Old Text:</strong>
                              <pre>{r.oldText}</pre>
                            </div>
                            <div className="diff-new">
                              <strong>New Text:</strong>
                              <pre>{r.newText}</pre>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="error-section">
                  <button 
                    className={`section-header ${expandedSections.has('document') ? 'expanded' : ''}`}
                    onClick={() => toggleSection('document')}
                  >
                    <span className="section-arrow">▶</span>
                    Document Content
                  </button>
                  {expandedSections.has('document') && (
                    <div className="section-content">
                      <pre className="code-block document-content">
                        {details.originalMarkdown}
                      </pre>
                    </div>
                  )}
                </div>
              </div>

              <div className="error-dialog-help">
                <p><strong>What to do next:</strong></p>
                <ul>
                  <li>Check if the document was modified after Claude started processing</li>
                  <li>Verify that the text Claude is trying to replace exists exactly as shown</li>
                  <li>Try making the request again with the current document state</li>
                  <li>If the problem persists, copy the debug info and report the issue</li>
                </ul>
              </div>
            </div>
          )}
        </div>

        <div className="error-dialog-footer">
          <button className="error-dialog-ok-btn" onClick={onClose}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}