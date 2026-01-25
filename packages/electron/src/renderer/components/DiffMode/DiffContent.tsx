import React, { useState, useEffect, useCallback } from 'react';

interface DiffContentProps {
  worktreePath: string;
  filePath: string;
}

interface DiffLine {
  type: 'header' | 'hunk' | 'context' | 'addition' | 'deletion';
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

function parseDiff(diff: string): DiffLine[] {
  const lines: DiffLine[] = [];
  const diffLines = diff.split('\n');

  let oldLine = 0;
  let newLine = 0;

  for (const line of diffLines) {
    if (line.startsWith('diff ') || line.startsWith('index ') ||
        line.startsWith('--- ') || line.startsWith('+++ ')) {
      lines.push({ type: 'header', content: line });
    } else if (line.startsWith('@@')) {
      // Parse hunk header: @@ -oldStart,oldCount +newStart,newCount @@
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLine = parseInt(match[1], 10);
        newLine = parseInt(match[2], 10);
      }
      lines.push({ type: 'hunk', content: line });
    } else if (line.startsWith('+')) {
      lines.push({
        type: 'addition',
        content: line.substring(1),
        newLineNumber: newLine,
      });
      newLine++;
    } else if (line.startsWith('-')) {
      lines.push({
        type: 'deletion',
        content: line.substring(1),
        oldLineNumber: oldLine,
      });
      oldLine++;
    } else if (line.startsWith(' ') || line === '') {
      lines.push({
        type: 'context',
        content: line.substring(1) || '',
        oldLineNumber: oldLine,
        newLineNumber: newLine,
      });
      oldLine++;
      newLine++;
    }
  }

  return lines;
}

export function DiffContent({ worktreePath, filePath }: DiffContentProps) {
  const [diffLines, setDiffLines] = useState<DiffLine[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Debug logging (only when DEBUG_DIFF_RENDERS is set to avoid performance issues during render storms)
  if (process.env.DEBUG_DIFF_RENDERS === 'true') {
    console.log('[DiffContent] Component render:', { worktreePath, filePath, isLoading, error, diffLinesCount: diffLines.length });
  }

  useEffect(() => {
    const loadDiff = async () => {
      if (!worktreePath || !filePath) {
        if (process.env.DEBUG_DIFF_RENDERS === 'true') {
          console.log('[DiffContent] Missing worktreePath or filePath:', { worktreePath, filePath });
        }
        return;
      }

      if (process.env.DEBUG_DIFF_RENDERS === 'true') {
        console.log('[DiffContent] Loading diff for:', { worktreePath, filePath });
      }
      setIsLoading(true);
      setError(null);

      try {
        const result = await window.electronAPI.invoke('worktree:get-file-diff', worktreePath, filePath);
        if (process.env.DEBUG_DIFF_RENDERS === 'true') {
          console.log('[DiffContent] Result:', result);
        }
        if (result?.success && result.diff) {
          if (process.env.DEBUG_DIFF_RENDERS === 'true') {
            console.log('[DiffContent] Diff string:', result.diff.diff);
          }
          const parsed = parseDiff(result.diff.diff);
          if (process.env.DEBUG_DIFF_RENDERS === 'true') {
            console.log('[DiffContent] Parsed lines:', parsed.length);
          }
          setDiffLines(parsed);
        } else {
          if (process.env.DEBUG_DIFF_RENDERS === 'true') {
            console.log('[DiffContent] No diff or error:', result);
          }
          setError(result?.error || 'Failed to load diff');
        }
      } catch (err) {
        console.error('[DiffContent] Failed to load diff:', err);
        setError('Failed to load diff');
      } finally {
        setIsLoading(false);
      }
    };

    loadDiff();
  }, [worktreePath, filePath]);

  if (isLoading) {
    return (
      <div className="diff-content diff-content--loading flex flex-1 flex-col items-center justify-center text-sm text-[var(--nim-text-muted)] bg-[var(--nim-bg)]">
        <p>Loading diff...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="diff-content diff-content--error flex flex-1 flex-col items-center justify-center text-sm text-[var(--nim-error)] bg-[var(--nim-bg)]">
        <p>{error}</p>
      </div>
    );
  }

  if (diffLines.length === 0) {
    return (
      <div className="diff-content diff-content--empty flex flex-1 flex-col items-center justify-center text-sm text-[var(--nim-text-muted)] bg-[var(--nim-bg)]">
        <p>No changes in this file</p>
      </div>
    );
  }

  const getLineClasses = (type: DiffLine['type']) => {
    const baseClasses = 'diff-line min-h-5';
    switch (type) {
      case 'header':
        return `${baseClasses} diff-line--header bg-[var(--nim-bg-secondary)] text-[var(--nim-text-faint)]`;
      case 'hunk':
        return `${baseClasses} diff-line--hunk bg-[var(--nim-info-light)] text-[var(--nim-info)]`;
      case 'addition':
        return `${baseClasses} diff-line--addition bg-[var(--nim-success-light)]`;
      case 'deletion':
        return `${baseClasses} diff-line--deletion bg-[var(--nim-error-light)]`;
      case 'context':
        return `${baseClasses} diff-line--context bg-transparent`;
      default:
        return baseClasses;
    }
  };

  const getMarkerClasses = (type: DiffLine['type']) => {
    const baseClasses = 'diff-line-marker w-5 min-w-5 px-1 text-center select-none align-top';
    switch (type) {
      case 'addition':
        return `${baseClasses} text-[var(--nim-success)]`;
      case 'deletion':
        return `${baseClasses} text-[var(--nim-error)]`;
      case 'hunk':
        return `${baseClasses} text-[var(--nim-info)]`;
      default:
        return `${baseClasses} text-[var(--nim-text-muted)]`;
    }
  };

  const getContentClasses = (type: DiffLine['type']) => {
    const baseClasses = 'diff-line-content px-2 whitespace-pre-wrap break-all';
    switch (type) {
      case 'addition':
        return `${baseClasses} text-[var(--nim-success)]`;
      case 'deletion':
        return `${baseClasses} text-[var(--nim-error)]`;
      default:
        return baseClasses;
    }
  };

  return (
    <div className="diff-content flex flex-1 flex-col bg-[var(--nim-bg)]">
      <div className="diff-content-scroll flex-1 overflow-auto">
        <table className="diff-table w-full border-collapse font-mono text-[0.8125rem] leading-normal">
          <tbody>
            {diffLines.map((line, index) => (
              <tr key={index} className={getLineClasses(line.type)}>
                <td className="diff-line-number diff-line-number--old w-12 min-w-12 px-2 text-right select-none align-top bg-[var(--nim-bg-secondary)] text-[var(--nim-text-faint)]">
                  {line.type === 'deletion' || line.type === 'context'
                    ? line.oldLineNumber
                    : ''}
                </td>
                <td className="diff-line-number diff-line-number--new w-12 min-w-12 px-2 text-right select-none align-top bg-[var(--nim-bg-secondary)] text-[var(--nim-text-faint)] border-r border-[var(--nim-border)]">
                  {line.type === 'addition' || line.type === 'context'
                    ? line.newLineNumber
                    : ''}
                </td>
                <td className={getMarkerClasses(line.type)}>
                  {line.type === 'addition' ? '+' :
                   line.type === 'deletion' ? '-' :
                   line.type === 'hunk' ? '@@' : ''}
                </td>
                <td className={getContentClasses(line.type)}>
                  <pre className="m-0 p-0 font-inherit text-inherit leading-inherit whitespace-pre-wrap break-all">{line.content}</pre>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default DiffContent;
