import React, { useState } from 'react';
import './ToolCallBlock.css';

interface ToolCallBlockProps {
  toolName: string;
  arguments?: any;
  result?: any;
  isLoading?: boolean;
  onReapply?: (args: any) => void;
}

export function ToolCallBlock({ toolName, arguments: args, result, isLoading, onReapply }: ToolCallBlockProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Extract the actual tool name from MCP format (e.g., "mcp__stravu-editor__applyDiff" -> "applyDiff")
  const displayName = toolName.includes('__')
    ? toolName.split('__').pop() || toolName
    : toolName;

  // Get a user-friendly description based on the tool name and arguments
  const getToolDescription = (name: string, args?: any) => {
    // Check both the display name and the full tool name for matches
    const checkName = (n: string) => name === n || toolName === n || toolName.endsWith(`__${n}`);

    // For file operations, include the file path in the description
    if (args && (args.file_path || args.path)) {
      const filePath = args.file_path || args.path;
      const fileName = filePath.split('/').pop() || filePath;

      if (checkName('Read')) {
        return `Reading ${fileName}`;
      } else if (checkName('Edit') || checkName('MultiEdit')) {
        return `Editing ${fileName}`;
      } else if (checkName('Write')) {
        return `Writing ${fileName}`;
      } else if (checkName('LS')) {
        const dirName = filePath.split('/').pop() || filePath;
        return `Listing ${dirName}/`;
      }
    }

    // For Bash commands, show the command being run
    if (checkName('Bash') && args?.command) {
      const cmd = args.command;
      const shortCmd = cmd.length > 50 ? cmd.substring(0, 47) + '...' : cmd;
      return `Running: ${shortCmd}`;
    }

    // For Grep, show the pattern
    if (checkName('Grep') && args?.pattern) {
      const pattern = args.pattern;
      const shortPattern = pattern.length > 30 ? pattern.substring(0, 27) + '...' : pattern;
      return `Searching for: "${shortPattern}"`;
    }

    // For getDocument, indicate current document
    if (checkName('getDocument')) {
      return 'Reading current document';
    }

    // For applyDiff with MCP prefix
    if (checkName('applyDiff')) {
      return 'Applying changes to document';
    }

    // Default descriptions
    const descriptions: Record<string, string> = {
      'applyDiff': 'Applying changes to document',
      'streamContent': 'Streaming content to document',
      'getSelection': 'Getting current selection',
      'navigateTo': 'Navigating to position',
      'getOutline': 'Getting document outline',
      'searchInDocument': 'Searching in document',
      'WebSearch': 'Searching the web',
      'WebFetch': 'Fetching web content',
      'Task': 'Running task',
      'Glob': 'Finding files'
    };

    return descriptions[name] || `Using ${name}`;
  };

  // Format the arguments for display
  const formatArguments = (args: any) => {
    if (!args) return null;

    // Special formatting for applyDiff
    if (displayName === 'applyDiff' && args.replacements) {
      return (
        <div className="ai-chat-tool-replacements">
          {args.replacements.map((replacement: any, repIndex: number) => {
            const oldText = replacement.oldText || replacement.from || '';
            const newText = replacement.newText || replacement.to || '';

            // Coalesce the diff - if newText starts with oldText, only show the added part
            let displayOldText = oldText;
            let displayNewText = newText;
            let isCoalesced = false;

            // if (oldText && newText && newText.startsWith(oldText)) {
            //   // Only show the part that was actually added
            //   displayNewText = newText.slice(oldText.length);
            //   displayOldText = ''; // Don't show the remove section
            //   isCoalesced = true;
            // }

            return (
              <div key={repIndex} className="ai-chat-tool-replacement">
                {displayOldText && (
                  <div className="ai-chat-tool-old">
                    <span className="ai-chat-tool-label">Remove:</span>
                    <pre className="ai-chat-tool-content ai-chat-tool-content--remove">
                      {displayOldText}
                    </pre>
                  </div>
                )}
                {displayNewText && (
                  <div className="ai-chat-tool-new">
                    <span className="ai-chat-tool-label">
                      {isCoalesced ? 'Add:' : (displayOldText ? 'Replace with:' : 'Add:')}
                    </span>
                    <pre className="ai-chat-tool-content ai-chat-tool-content--add">
                      {displayNewText}
                    </pre>
                  </div>
                )}
                {!displayOldText && !displayNewText && newText && (
                  // Edge case: if coalescing resulted in empty diff, show the full replacement
                  <div className="ai-chat-tool-new">
                    <span className="ai-chat-tool-label">Replace with:</span>
                    <pre className="ai-chat-tool-content ai-chat-tool-content--add">
                      {newText}
                    </pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      );
    }

    // Special formatting for file operations
    if (args.file_path || args.path) {
      return (
        <div className="ai-chat-tool-file">
          <span className="ai-chat-tool-label">File:</span>
          <code className="ai-chat-tool-file-path">{args.file_path || args.path}</code>
        </div>
      );
    }

    // Default JSON display for other tools
    try {
      const formatted = JSON.stringify(args, null, 2);
      if (formatted !== '{}') {
        return (
          <div className="ai-chat-tool-args">
            <span className="ai-chat-tool-label">Arguments:</span>
            <pre className="ai-chat-tool-args-content">{formatted}</pre>
          </div>
        );
      }
    } catch {
      return null;
    }

    return null;
  };

  return (
    <div className="ai-chat-tool-box">
      <div
        className="ai-chat-tool-header"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <span className="ai-chat-tool-toggle">
          {isExpanded ? '▼' : '▶'}
        </span>
        <span className="ai-chat-tool-title">
          {getToolDescription(displayName, args)}
        </span>
        {isLoading && (
          <span className="ai-chat-tool-badge ai-chat-tool-badge--loading">Running...</span>
        )}
        {result && !isLoading && (
          <span className="ai-chat-tool-badge ai-chat-tool-badge--success">Complete</span>
        )}
      </div>

      {isExpanded && (
        <div className="ai-chat-tool-content-wrapper">
          <div className="ai-chat-tool-metadata">
            <span className="ai-chat-tool-type">TOOL</span>
            <span className="ai-chat-tool-location">
              {displayName}
            </span>
          </div>

          {formatArguments(args)}

          {result && (
            <div className="ai-chat-tool-result">
              <span className="ai-chat-tool-label">Result:</span>
              <pre className="ai-chat-tool-result-content">
                {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
              </pre>
            </div>
          )}

          {isLoading && (
            <div className="ai-chat-tool-status ai-chat-tool-status--pending">
              <span className="ai-chat-tool-status-text">
                <span className="ai-chat-loading-indicator">⟳</span> Running tool...
              </span>
            </div>
          )}

          {/* Show reapply button for applyDiff tool calls */}
          {(displayName === 'applyDiff' || toolName.endsWith('__applyDiff')) && !isLoading && onReapply && (
            <div className="ai-chat-tool-status">
              <button
                className="ai-chat-tool-reapply"
                onClick={() => onReapply(args)}
                title="Reapply this diff"
              >
                Reapply
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
