import React, { useEffect, useRef, useState } from 'react';
import { MaterialSymbol, type NewFileMenuContribution } from '@nimbalyst/runtime';
import './NewFileMenu.css';

// Built-in file types
export type BuiltInFileType = 'markdown' | 'mockup' | 'any';

// File type can be built-in or an extension-provided type (by extension string)
export type NewFileType = BuiltInFileType | string;

export interface ExtensionFileType {
  extension: string;
  displayName: string;
  icon: string;
  defaultContent: string;
}

interface NewFileMenuProps {
  x: number;
  y: number;
  onSelect: (fileType: NewFileType) => void;
  onClose: () => void;
  mockupEnabled?: boolean;
  /** Extension-contributed file types */
  extensionFileTypes?: ExtensionFileType[];
}

export function NewFileMenu({
  x,
  y,
  onSelect,
  onClose,
  mockupEnabled = false,
  extensionFileTypes = []
}: NewFileMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [adjustedPosition, setAdjustedPosition] = useState({ x, y });

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  // Adjust position after menu is mounted to keep it in viewport
  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let newX = x;
      let newY = y;

      if (x + rect.width > viewportWidth) {
        newX = x - rect.width;
      }
      if (y + rect.height > viewportHeight) {
        newY = y - rect.height;
      }

      if (newX !== x || newY !== y) {
        setAdjustedPosition({ x: newX, y: newY });
      }
    }
  }, [x, y]);

  const handleSelect = (fileType: NewFileType) => {
    onSelect(fileType);
    onClose();
  };

  return (
    <div
      ref={menuRef}
      className="new-file-menu"
      style={{ left: adjustedPosition.x, top: adjustedPosition.y }}
    >
      <div
        className="new-file-menu-item"
        onClick={() => handleSelect('markdown')}
      >
        <MaterialSymbol icon="description" size={18} />
        <span>New Markdown File</span>
      </div>

      {mockupEnabled && (
        <div
          className="new-file-menu-item"
          onClick={() => handleSelect('mockup')}
        >
          <MaterialSymbol icon="web" size={18} />
          <span>New Mockup</span>
        </div>
      )}

      {/* Extension-contributed file types */}
      {extensionFileTypes.map((extType) => (
        <div
          key={extType.extension}
          className="new-file-menu-item"
          onClick={() => handleSelect(`ext:${extType.extension}`)}
        >
          <MaterialSymbol icon={extType.icon} size={18} />
          <span>New {extType.displayName}</span>
        </div>
      ))}

      <div className="new-file-menu-separator" />

      <div
        className="new-file-menu-item"
        onClick={() => handleSelect('any')}
      >
        <MaterialSymbol icon="note_add" size={18} />
        <span>New File...</span>
      </div>
    </div>
  );
}

/**
 * Convert NewFileMenuContribution from extension to ExtensionFileType
 */
export function contributionToExtensionFileType(
  contribution: NewFileMenuContribution
): ExtensionFileType {
  return {
    extension: contribution.extension,
    displayName: contribution.displayName,
    icon: contribution.icon,
    defaultContent: contribution.defaultContent,
  };
}
