import React, { useEffect, useRef } from 'react';
import { MaterialSymbol, globalRegistry } from '@nimbalyst/runtime';

interface TrackerItemMoveConfirmProps {
  itemKey: string;
  sourceTypeId: string;
  targetTypeId: string;
  lostFields: string[];
  onCancel: () => void;
  onConfirm: () => void;
}

export const TrackerItemMoveConfirm: React.FC<TrackerItemMoveConfirmProps> = ({
  itemKey,
  sourceTypeId,
  targetTypeId,
  lostFields,
  onCancel,
  onConfirm,
}) => {
  const overlayRef = useRef<HTMLDivElement>(null);

  const sourceModel = globalRegistry.get(sourceTypeId);
  const targetModel = globalRegistry.get(targetTypeId);
  const sourceDisplayName = sourceModel?.displayName ?? sourceTypeId;
  const targetDisplayName = targetModel?.displayName ?? targetTypeId;
  const targetColor = targetModel?.color ?? 'var(--nim-primary)';
  const targetIcon = targetModel?.icon ?? 'label';

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onConfirm();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onCancel, onConfirm]);

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onCancel();
  };

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    >
      <div
        className="relative flex flex-col bg-[var(--nim-bg)] border border-[var(--nim-border)] rounded-xl shadow-2xl w-full max-w-[480px]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--nim-border)]">
          <div className="flex items-center gap-2">
            <span style={{ color: targetColor }}>
              <MaterialSymbol icon={targetIcon} size={18} />
            </span>
            <h2 className="text-[15px] font-semibold text-[var(--nim-text)]">
              Move item to {targetDisplayName}?
            </h2>
          </div>
          <button
            onClick={onCancel}
            className="w-7 h-7 flex items-center justify-center rounded-md text-[var(--nim-text-muted)] hover:text-[var(--nim-text)] hover:bg-[var(--nim-bg-secondary)] cursor-pointer transition-colors"
          >
            <MaterialSymbol icon="close" size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {/* Item summary */}
          <div className="flex items-center gap-3 p-3 bg-[var(--nim-bg-secondary)] rounded-lg">
            <span className="text-[11px] font-mono font-medium uppercase tracking-[0.08em] text-[var(--nim-text-faint)] shrink-0">
              {itemKey}
            </span>
            <MaterialSymbol icon="arrow_forward" size={14} className="text-[var(--nim-text-faint)] shrink-0" />
            <span className="text-[13px] text-[var(--nim-text-muted)]">
              <span className="font-medium text-[var(--nim-text)]">{sourceDisplayName}</span>
              {' '}→{' '}
              <span className="font-medium" style={{ color: targetColor }}>{targetDisplayName}</span>
            </span>
          </div>

          {/* Field loss warning or no-loss confirmation */}
          {lostFields.length > 0 ? (
            <div className="p-3 bg-[#ef444415] border border-[#ef444430] rounded-lg space-y-2">
              <div className="flex items-center gap-1.5 text-[#ef4444]">
                <MaterialSymbol icon="warning" size={15} />
                <span className="text-[12px] font-semibold">These fields will be removed:</span>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {lostFields.map((field) => (
                  <span
                    key={field}
                    className="text-[11px] font-mono px-2 py-0.5 rounded bg-[#ef444420] text-[#ef4444] border border-[#ef444430]"
                  >
                    {field}
                  </span>
                ))}
              </div>
              <p className="text-[11px] text-[#ef4444]/70 mt-1">
                These fields are not defined on {targetDisplayName} and will be deleted.
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 p-3 bg-[#22c55e15] border border-[#22c55e30] rounded-lg">
              <MaterialSymbol icon="check_circle" size={15} className="text-[#22c55e]" />
              <span className="text-[12px] text-[#22c55e]">No data will be lost.</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[var(--nim-border)]">
          <button
            onClick={onCancel}
            className="px-4 py-1.5 rounded-lg text-[13px] font-medium text-[var(--nim-text-muted)] hover:bg-[var(--nim-bg-secondary)] hover:text-[var(--nim-text)] transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-1.5 rounded-lg text-[13px] font-medium text-white transition-opacity hover:opacity-90 cursor-pointer"
            style={{ backgroundColor: targetColor }}
          >
            Move Item
          </button>
        </div>
      </div>
    </div>
  );
};
