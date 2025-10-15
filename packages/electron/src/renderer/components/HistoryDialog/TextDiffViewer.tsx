import React, { useMemo, useRef, useCallback } from 'react';
import { diffLines } from 'diff';
import './TextDiffViewer.css';

interface TextDiffViewerProps {
  oldText: string;
  newText: string;
}

interface DiffLine {
  content: string;
  type: 'added' | 'removed' | 'unchanged';
  lineNumber?: number;
}

export function TextDiffViewer({ oldText, newText }: TextDiffViewerProps) {
  const oldContentRef = useRef<HTMLDivElement>(null);
  const newContentRef = useRef<HTMLDivElement>(null);
  const syncingRef = useRef(false);

  const { oldLines, newLines } = useMemo(() => {
    const changes = diffLines(oldText, newText);
    const oldLines: DiffLine[] = [];
    const newLines: DiffLine[] = [];
    let oldLineNum = 1;
    let newLineNum = 1;

    changes.forEach((change) => {
      const lines = change.value.split('\n');
      // Remove last empty line if present
      if (lines[lines.length - 1] === '') {
        lines.pop();
      }

      if (change.added) {
        lines.forEach((line) => {
          newLines.push({ content: line, type: 'added', lineNumber: newLineNum++ });
        });
      } else if (change.removed) {
        lines.forEach((line) => {
          oldLines.push({ content: line, type: 'removed', lineNumber: oldLineNum++ });
        });
      } else {
        lines.forEach((line) => {
          oldLines.push({ content: line, type: 'unchanged', lineNumber: oldLineNum++ });
          newLines.push({ content: line, type: 'unchanged', lineNumber: newLineNum++ });
        });
      }
    });

    return { oldLines, newLines };
  }, [oldText, newText]);

  const handleScroll = useCallback((source: 'old' | 'new') => {
    if (syncingRef.current) return;

    const sourceEl = source === 'old' ? oldContentRef.current : newContentRef.current;
    const targetEl = source === 'old' ? newContentRef.current : oldContentRef.current;

    if (!sourceEl || !targetEl) return;

    syncingRef.current = true;
    targetEl.scrollTop = sourceEl.scrollTop;
    targetEl.scrollLeft = sourceEl.scrollLeft;

    requestAnimationFrame(() => {
      syncingRef.current = false;
    });
  }, []);

  return (
    <div className="text-diff-viewer">
      <div className="text-diff-panel text-diff-old">
        <div className="text-diff-header">Old Version</div>
        <div
          className="text-diff-content"
          ref={oldContentRef}
          onScroll={() => handleScroll('old')}
        >
          <div className="text-diff-lines">
            {oldLines.map((line, index) => (
              <div key={index} className={`text-diff-line text-diff-line-${line.type}`}>
                <span className="text-diff-line-number">{line.lineNumber}</span>
                <span className="text-diff-line-content">{line.content || ' '}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="text-diff-panel text-diff-new">
        <div className="text-diff-header">New Version</div>
        <div
          className="text-diff-content"
          ref={newContentRef}
          onScroll={() => handleScroll('new')}
        >
          <div className="text-diff-lines">
            {newLines.map((line, index) => (
              <div key={index} className={`text-diff-line text-diff-line-${line.type}`}>
                <span className="text-diff-line-number">{line.lineNumber}</span>
                <span className="text-diff-line-content">{line.content || ' '}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
