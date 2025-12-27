/**
 * FloatingEditorActions - Floating action buttons for custom editors
 *
 * Provides consistent floating buttons (like "View Source") for custom editors.
 * Positioned in the top-right corner of the editor area.
 *
 * Usage:
 * ```tsx
 * <FloatingEditorActions>
 *   <FloatingEditorButton
 *     icon="code"
 *     label="View Source"
 *     onClick={() => host.toggleSourceMode?.()}
 *   />
 * </FloatingEditorActions>
 * ```
 */

import React from 'react';
import './FloatingEditorActions.css';

interface FloatingEditorActionsProps {
  children: React.ReactNode;
}

/**
 * Container for floating action buttons in custom editors.
 * Positioned in the top-right corner with proper z-index.
 */
export const FloatingEditorActions: React.FC<FloatingEditorActionsProps> = ({
  children,
}) => {
  return <div className="floating-editor-actions">{children}</div>;
};

interface FloatingEditorButtonProps {
  /** Icon name (uses Material Symbols) or custom icon element */
  icon?: string | React.ReactNode;
  /** Button label (shown in tooltip) */
  label: string;
  /** Click handler */
  onClick: () => void;
  /** Whether button is active/pressed */
  isActive?: boolean;
  /** Whether button is disabled */
  disabled?: boolean;
}

/**
 * A floating action button for custom editors.
 * Consistent with rexical's FloatingDocumentActionsPlugin styling.
 */
export const FloatingEditorButton: React.FC<FloatingEditorButtonProps> = ({
  icon,
  label,
  onClick,
  isActive = false,
  disabled = false,
}) => {
  return (
    <button
      className={`floating-editor-button ${isActive ? 'active' : ''}`}
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
    >
      {typeof icon === 'string' ? (
        <span className="material-symbols-outlined">{icon}</span>
      ) : (
        icon
      )}
    </button>
  );
};

/**
 * A dropdown menu that appears when clicking a floating button.
 */
interface FloatingEditorMenuProps {
  children: React.ReactNode;
  isOpen: boolean;
  onClose: () => void;
}

export const FloatingEditorMenu: React.FC<FloatingEditorMenuProps> = ({
  children,
  isOpen,
  onClose,
}) => {
  if (!isOpen) return null;

  return (
    <>
      <div className="floating-editor-menu-backdrop" onClick={onClose} />
      <div className="floating-editor-menu">{children}</div>
    </>
  );
};

interface FloatingEditorMenuItemProps {
  label: string;
  onClick: () => void;
  icon?: string;
  isActive?: boolean;
}

export const FloatingEditorMenuItem: React.FC<FloatingEditorMenuItemProps> = ({
  label,
  onClick,
  icon,
  isActive = false,
}) => {
  return (
    <button
      className={`floating-editor-menu-item ${isActive ? 'active' : ''}`}
      onClick={onClick}
    >
      {icon && <span className="material-symbols-outlined">{icon}</span>}
      <span>{label}</span>
      {isActive && <span className="checkmark">✓</span>}
    </button>
  );
};
