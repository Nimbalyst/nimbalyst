import React, { useMemo, useRef, useCallback, useEffect } from 'react';
import { diffLines } from 'diff';
import { generateUnifiedDiff } from 'rexical';
import './TextDiffViewer.css';

export interface TextDiffNavigationState {
  currentIndex: number;
  totalGroups: number;
  canGoPrevious: boolean;
  canGoNext: boolean;
  addedLines: number;
  removedLines: number;
}

interface TextDiffViewerProps {
  oldText: string;
  newText: string;
  onNavigationStateChange?: (state: TextDiffNavigationState) => void;
  onNavigatePrevious?: () => void;
  onNavigateNext?: () => void;
}

interface DiffLine {
  content: string;
  type: 'added' | 'removed' | 'unchanged';
  lineNumber?: number;
}

interface ChangeGroup {
  startIndex: number;
  endIndex: number;
  type: 'addition' | 'deletion' | 'modification';
}

export function TextDiffViewer({
  oldText,
  newText,
  onNavigationStateChange,
  onNavigatePrevious,
  onNavigateNext
}: TextDiffViewerProps) {
  const oldContentRef = useRef<HTMLDivElement>(null);
  const newContentRef = useRef<HTMLDivElement>(null);
  const syncingRef = useRef(false);
  const [currentChangeIndex, setCurrentChangeIndex] = React.useState(0);

  const { oldLines, newLines, stats, changeGroups } = useMemo(() => {
    const changes = diffLines(oldText, newText);
    const oldLines: DiffLine[] = [];
    const newLines: DiffLine[] = [];
    const changeGroups: ChangeGroup[] = [];
    let oldLineNum = 1;
    let newLineNum = 1;
    let addedLines = 0;
    let removedLines = 0;

    changes.forEach((change) => {
      const lines = change.value.split('\n');
      // Remove last empty line if present
      if (lines[lines.length - 1] === '') {
        lines.pop();
      }

      if (change.added) {
        const startIndex = newLines.length;
        lines.forEach((line) => {
          newLines.push({ content: line, type: 'added', lineNumber: newLineNum++ });
          addedLines++;
        });
        const endIndex = newLines.length - 1;

        // Merge with previous group if it's a modification (last group was a deletion)
        if (changeGroups.length > 0 && changeGroups[changeGroups.length - 1].type === 'deletion') {
          changeGroups[changeGroups.length - 1].type = 'modification';
        } else {
          changeGroups.push({ startIndex, endIndex, type: 'addition' });
        }
      } else if (change.removed) {
        const startIndex = oldLines.length;
        lines.forEach((line) => {
          oldLines.push({ content: line, type: 'removed', lineNumber: oldLineNum++ });
          removedLines++;
        });
        const endIndex = oldLines.length - 1;
        changeGroups.push({ startIndex, endIndex, type: 'deletion' });
      } else {
        lines.forEach((line) => {
          oldLines.push({ content: line, type: 'unchanged', lineNumber: oldLineNum++ });
          newLines.push({ content: line, type: 'unchanged', lineNumber: newLineNum++ });
        });
      }
    });

    return {
      oldLines,
      newLines,
      stats: { addedLines, removedLines },
      changeGroups
    };
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

  const handleDownloadDiff = useCallback(() => {
    try {
      const unifiedDiff = generateUnifiedDiff(oldText, newText, 'a/document.md', 'b/document.md');

      const blob = new Blob([unifiedDiff], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `diff-${Date.now()}.patch`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to generate unified diff:', error);
    }
  }, [oldText, newText]);

  const scrollToChange = useCallback((index: number) => {
    if (index < 0 || index >= changeGroups.length) return;

    const group = changeGroups[index];
    const targetRef = group.type === 'addition' ? newContentRef : oldContentRef;

    if (targetRef.current) {
      const lineElements = targetRef.current.querySelectorAll('.text-diff-line');
      const targetLine = lineElements[group.startIndex];

      if (targetLine) {
        targetLine.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }

    setCurrentChangeIndex(index);
  }, [changeGroups]);

  // Notify parent of navigation state changes
  useEffect(() => {
    if (onNavigationStateChange) {
      onNavigationStateChange({
        currentIndex: currentChangeIndex,
        totalGroups: changeGroups.length,
        canGoPrevious: currentChangeIndex > 0,
        canGoNext: currentChangeIndex < changeGroups.length - 1,
        addedLines: stats.addedLines,
        removedLines: stats.removedLines
      });
    }
  }, [currentChangeIndex, changeGroups.length, stats, onNavigationStateChange]);

  // Handle navigation requests from parent
  useEffect(() => {
    if (onNavigatePrevious) {
      // Store handler so parent can trigger it
      (window as any).__textDiffNavigatePrevious = () => {
        if (currentChangeIndex > 0) {
          scrollToChange(currentChangeIndex - 1);
        }
      };
    }
    if (onNavigateNext) {
      (window as any).__textDiffNavigateNext = () => {
        if (currentChangeIndex < changeGroups.length - 1) {
          scrollToChange(currentChangeIndex + 1);
        }
      };
    }
  }, [currentChangeIndex, changeGroups.length, scrollToChange, onNavigatePrevious, onNavigateNext]);

  const handlePreviousChange = useCallback(() => {
    if (currentChangeIndex > 0) {
      scrollToChange(currentChangeIndex - 1);
    }
  }, [currentChangeIndex, scrollToChange]);

  const handleNextChange = useCallback(() => {
    if (currentChangeIndex < changeGroups.length - 1) {
      scrollToChange(currentChangeIndex + 1);
    }
  }, [currentChangeIndex, changeGroups.length, scrollToChange]);

  return (
    <div className="text-diff-viewer">
      <div className="text-diff-panels">
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
    </div>
  );
}
