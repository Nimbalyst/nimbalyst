import React, { useState, useEffect } from 'react';
import type { EditorHostProps } from '@nimbalyst/extension-sdk';

/**
 * A minimal custom editor component.
 *
 * This demonstrates the basic structure every custom editor needs:
 * - Load content from the host on mount
 * - Mark the tab dirty when the user edits
 * - Save when the host requests it
 * - Reload when the file changes on disk
 */
export function MinimalEditor({ host }: EditorHostProps) {
  const [text, setText] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    host.loadContent().then((content) => {
      if (!mounted) return;
      setText(content);
      setIsLoading(false);
    }).catch(() => {
      if (!mounted) return;
      setText('');
      setIsLoading(false);
    });

    return () => {
      mounted = false;
    };
  }, [host]);

  useEffect(() => {
    return host.onSaveRequested(async () => {
      await host.saveContent(text);
      host.setDirty(false);
    });
  }, [host, text]);

  useEffect(() => {
    return host.onFileChanged((newContent) => {
      setText(newContent);
      host.setDirty(false);
    });
  }, [host]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value;
    setText(newText);
    host.setDirty(true);
  };

  if (isLoading) {
    return <div style={{ padding: '16px' }}>Loading...</div>;
  }

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
          color: 'var(--nim-text-muted)',
          fontSize: '12px',
        }}
      >
        Editing: {host.filePath}
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
          backgroundColor: 'var(--nim-bg-secondary)',
          color: 'var(--nim-text)',
          border: '1px solid var(--nim-border)',
          borderRadius: '4px',
          resize: 'none',
          outline: 'none',
        }}
      />
    </div>
  );
}
