import { useEffect, useMemo } from 'react';
import {
  useFloating,
  offset,
  flip,
  shift,
  size,
  FloatingPortal,
  autoUpdate,
  useDismiss,
  useRole,
  useInteractions,
} from '@floating-ui/react';
import { UnifiedDiffView, diffStats } from './UnifiedDiffView';

export type PopoverMode = 'peek' | 'pinned';

interface DiffPeekPopoverProps {
  anchorRect: DOMRect;
  filePath: string;
  mode: PopoverMode;
  diff: string;
  isBinary: boolean;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onPin: () => void;
  onOpenInEditor: () => void;
}

export function DiffPeekPopover({
  anchorRect,
  filePath,
  mode,
  diff,
  isBinary,
  loading,
  error,
  onClose,
  onPin,
  onOpenInEditor,
}: DiffPeekPopoverProps) {
  const virtualRef = useMemo(() => ({
    getBoundingClientRect: () => anchorRect,
  }), [anchorRect]);

  const { refs, floatingStyles, context } = useFloating({
    open: true,
    onOpenChange: (open) => {
      if (!open) onClose();
    },
    elements: { reference: virtualRef as unknown as Element },
    placement: 'right-start',
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(8),
      flip({ fallbackPlacements: ['left-start', 'top-start', 'bottom-start'], padding: 8 }),
      shift({ padding: 8 }),
      size({
        padding: 8,
        apply({ availableHeight, elements }) {
          Object.assign(elements.floating.style, {
            maxHeight: `${Math.min(380, Math.max(140, availableHeight))}px`,
          });
        },
      }),
    ],
  });

  const dismiss = useDismiss(context, {
    outsidePress: true,
    escapeKey: true,
  });
  const role = useRole(context, { role: 'dialog' });
  const { getFloatingProps } = useInteractions([dismiss, role]);

  const stats = useMemo(() => diffStats(diff), [diff]);
  const filename = filePath.split('/').pop() ?? filePath;
  const dir = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : '';

  // Promote a peek to pinned on Enter, regardless of focus inside the popover.
  useEffect(() => {
    if (mode !== 'peek') return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        onPin();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [mode, onPin]);

  return (
    <FloatingPortal>
      <div
        ref={refs.setFloating}
        style={floatingStyles}
        className={`git-diff-popover git-diff-popover--${mode}`}
        {...getFloatingProps()}
      >
        <div className="git-diff-popover-header">
          <span className="git-diff-popover-filename" title={filePath}>
            {dir && <span className="git-diff-popover-dir">{dir}/</span>}
            <span className="git-diff-popover-name">{filename}</span>
          </span>
          <span className="git-diff-popover-stats">
            {stats.added > 0 && <span className="git-diff-stat-added">+{stats.added}</span>}
            {stats.removed > 0 && <span className="git-diff-stat-removed">−{stats.removed}</span>}
          </span>
          {mode === 'peek' && <span className="git-diff-popover-mode-badge">Peeking</span>}
          {mode === 'pinned' && <span className="git-diff-popover-mode-badge git-diff-popover-mode-badge--pinned">Pinned</span>}
          <button
            type="button"
            className="git-diff-popover-open-link"
            onClick={(e) => { e.stopPropagation(); onOpenInEditor(); }}
          >
            Open in editor
          </button>
        </div>

        <div className="git-diff-popover-scroll">
          <UnifiedDiffView diff={diff} isBinary={isBinary} loading={loading} error={error} />
        </div>

        <div className="git-diff-popover-footer">
          <span><kbd>Esc</kbd> close</span>
          {mode === 'peek' && <span><kbd>Enter</kbd> pin</span>}
        </div>
      </div>
    </FloatingPortal>
  );
}
