import React from 'react';

interface AlphaBadgeProps {
  /**
   * `xs` and `sm` render the lowercase word "alpha" as a pill (sidebar rows / panel headers).
   * `dot` renders just the Greek α character — for tight spots like square icon buttons.
   */
  size?: 'xs' | 'sm' | 'dot';
  className?: string;
  tooltip?: string;
}

const DEFAULT_TOOLTIP = 'Alpha feature — may change or be removed.';

const PILL_BASE = 'inline-flex items-center font-medium lowercase bg-[var(--nim-bg-tertiary)] border border-[var(--nim-border)]';

const SIZE_CLASSES: Record<NonNullable<AlphaBadgeProps['size']>, string> = {
  xs: `${PILL_BASE} px-2 py-px rounded-full text-[10px] text-[var(--nim-text-faint)]`,
  sm: `${PILL_BASE} px-2.5 py-0.5 rounded-full text-[11px] text-[var(--nim-text-muted)] align-middle`,
  dot: 'inline-flex items-center justify-center text-[10px] leading-none font-semibold text-[var(--nim-text-faint)]',
};

export const AlphaBadge: React.FC<AlphaBadgeProps> = ({
  size = 'xs',
  className = '',
  tooltip = DEFAULT_TOOLTIP,
}) => {
  return (
    <span
      data-testid="alpha-badge"
      title={tooltip}
      aria-label="Alpha feature"
      className={`${SIZE_CLASSES[size]} ${className}`.trim()}
    >
      {size === 'dot' ? 'α' : 'alpha'}
    </span>
  );
};
