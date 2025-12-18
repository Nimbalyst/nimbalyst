import React, { useState, useEffect } from 'react';

interface MinimalEditorProps {
  content: string;
  filePath: string;
  onChange: (content: string) => void;
}

/**
 * A minimal custom editor component.
 *
 * This demonstrates the basic structure every custom editor needs:
 * - Receive content and filePath as props
 * - Call onChange when user edits content
 * - Sync with content prop when file is reloaded
 */
export function MinimalEditor({ content, filePath, onChange }: MinimalEditorProps) {
  const [text, setText] = useState(content);

  // Re-sync when file is reloaded from disk
  useEffect(() => {
    setText(content);
  }, [content]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value;
    setText(newText);
    onChange(newText);
  };

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        padding: '16px',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          marginBottom: '12px',
          color: 'var(--text-secondary)',
          fontSize: '12px',
        }}
      >
        Editing: {filePath}
      </div>
      <textarea
        value={text}
        onChange={handleChange}
        placeholder="Start typing..."
        style={{
          flex: 1,
          width: '100%',
          padding: '12px',
          fontSize: '14px',
          fontFamily: 'monospace',
          backgroundColor: 'var(--surface-secondary)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border-primary)',
          borderRadius: '4px',
          resize: 'none',
          outline: 'none',
        }}
      />
    </div>
  );
}
