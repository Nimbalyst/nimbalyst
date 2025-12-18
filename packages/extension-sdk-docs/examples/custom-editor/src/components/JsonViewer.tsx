import React, { useState, useEffect, useCallback } from 'react';

interface JsonViewerProps {
  content: string;
  filePath: string;
  onChange: (content: string) => void;
}

interface JsonNodeProps {
  keyName: string | null;
  value: unknown;
  depth: number;
  onValueChange: (path: string[], newValue: unknown) => void;
  path: string[];
}

/**
 * Renders a single JSON node with expand/collapse for objects and arrays.
 */
function JsonNode({ keyName, value, depth, onValueChange, path }: JsonNodeProps) {
  const [expanded, setExpanded] = useState(depth < 2);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');

  const isObject = value !== null && typeof value === 'object';
  const isArray = Array.isArray(value);
  const entries = isObject ? Object.entries(value as object) : [];

  const handleDoubleClick = () => {
    if (!isObject) {
      setEditing(true);
      setEditValue(JSON.stringify(value));
    }
  };

  const handleEditComplete = () => {
    setEditing(false);
    try {
      const parsed = JSON.parse(editValue);
      onValueChange(path, parsed);
    } catch {
      // Invalid JSON, revert
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleEditComplete();
    } else if (e.key === 'Escape') {
      setEditing(false);
    }
  };

  const renderValue = () => {
    if (editing) {
      return (
        <input
          className="json-viewer-edit-input"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleEditComplete}
          onKeyDown={handleKeyDown}
          autoFocus
        />
      );
    }

    if (value === null) {
      return <span className="json-viewer-null">null</span>;
    }
    if (typeof value === 'boolean') {
      return <span className="json-viewer-boolean">{value.toString()}</span>;
    }
    if (typeof value === 'number') {
      return <span className="json-viewer-number">{value}</span>;
    }
    if (typeof value === 'string') {
      return <span className="json-viewer-string">"{value}"</span>;
    }
    if (isArray) {
      return expanded ? null : <span className="json-viewer-preview">[{entries.length} items]</span>;
    }
    if (isObject) {
      return expanded ? null : <span className="json-viewer-preview">{'{...}'}</span>;
    }
    return null;
  };

  return (
    <div className="json-viewer-node" style={{ paddingLeft: depth * 16 }}>
      <div className="json-viewer-row" onDoubleClick={handleDoubleClick}>
        {isObject && (
          <button
            className="json-viewer-toggle"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? '▼' : '▶'}
          </button>
        )}
        {keyName !== null && (
          <span className="json-viewer-key">"{keyName}": </span>
        )}
        {renderValue()}
      </div>
      {isObject && expanded && (
        <div className="json-viewer-children">
          {entries.map(([k, v], i) => (
            <JsonNode
              key={k}
              keyName={k}
              value={v}
              depth={depth + 1}
              path={[...path, k]}
              onValueChange={onValueChange}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Main JSON Viewer component.
 */
export function JsonViewer({ content, filePath, onChange }: JsonViewerProps) {
  const [data, setData] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);

  // Parse JSON content
  useEffect(() => {
    try {
      const parsed = JSON.parse(content || '{}');
      setData(parsed);
      setError(null);
    } catch (e) {
      setError(`Invalid JSON: ${(e as Error).message}`);
      setData(null);
    }
  }, [content]);

  // Handle value changes from nodes
  const handleValueChange = useCallback((path: string[], newValue: unknown) => {
    if (data === null) return;

    // Deep clone and update
    const newData = JSON.parse(JSON.stringify(data));
    let current: any = newData;

    for (let i = 0; i < path.length - 1; i++) {
      current = current[path[i]];
    }

    if (path.length > 0) {
      current[path[path.length - 1]] = newValue;
    }

    setData(newData);
    onChange(JSON.stringify(newData, null, 2));
  }, [data, onChange]);

  // Toolbar actions
  const handleFormat = () => {
    try {
      const parsed = JSON.parse(content);
      onChange(JSON.stringify(parsed, null, 2));
    } catch {
      // Already invalid
    }
  };

  const handleMinify = () => {
    try {
      const parsed = JSON.parse(content);
      onChange(JSON.stringify(parsed));
    } catch {
      // Already invalid
    }
  };

  return (
    <div className="json-viewer">
      <div className="json-viewer-toolbar">
        <span className="json-viewer-title">JSON Viewer</span>
        <div className="json-viewer-actions">
          <button onClick={handleFormat} title="Format JSON">
            Format
          </button>
          <button onClick={handleMinify} title="Minify JSON">
            Minify
          </button>
        </div>
      </div>

      <div className="json-viewer-content">
        {error ? (
          <div className="json-viewer-error">{error}</div>
        ) : data !== null ? (
          <JsonNode
            keyName={null}
            value={data}
            depth={0}
            path={[]}
            onValueChange={handleValueChange}
          />
        ) : null}
      </div>
    </div>
  );
}
