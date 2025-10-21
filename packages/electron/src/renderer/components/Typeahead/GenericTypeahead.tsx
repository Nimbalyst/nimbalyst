import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { getCursorCoordinates } from './typeaheadUtils';
import './GenericTypeahead.css';

export interface TypeaheadOption {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  section?: string;
  data?: any;
  disabled?: boolean;
}

interface GenericTypeaheadProps {
  // The textarea/input element to attach to
  anchorElement: HTMLTextAreaElement | HTMLInputElement | null;

  // Options to display
  options: TypeaheadOption[];

  // Currently selected index
  selectedIndex: number | null;
  onSelectedIndexChange: (index: number | null) => void;

  // Selection handler
  onSelect: (option: TypeaheadOption) => void;

  // Close handler
  onClose: () => void;

  // Positioning
  cursorPosition: number;

  // Styling
  className?: string;
  maxHeight?: number;
  minWidth?: number;
  maxWidth?: number;
}

export function GenericTypeahead({
  anchorElement,
  options,
  selectedIndex,
  onSelectedIndexChange,
  onSelect,
  onClose,
  cursorPosition,
  className = '',
  maxHeight = 300,
  minWidth = 250,
  maxWidth = 400
}: GenericTypeaheadProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  // Calculate menu position based on cursor (viewport coordinates for portal)
  useEffect(() => {
    if (!anchorElement) return;

    // Initial position calculation
    const calculatePosition = () => {
      try {
        const coords = getCursorCoordinates(
          anchorElement as HTMLTextAreaElement,
          cursorPosition
        );

        // Get menu dimensions
        const menuHeight = menuRef.current?.offsetHeight || maxHeight;
        const menuWidth = menuRef.current?.offsetWidth || minWidth;

        // Get textarea position in viewport
        const textareaRect = anchorElement.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        // Calculate absolute viewport position
        // coords.left and coords.top are relative to textarea, so add textarea position
        let absoluteLeft = textareaRect.left + coords.left;
        let absoluteTop = textareaRect.top + coords.top - menuHeight - 2; // 2px gap above cursor

        // Ensure menu fits horizontally in viewport
        const padding = 10;
        if (absoluteLeft + menuWidth > viewportWidth - padding) {
          // Shift left to fit
          absoluteLeft = viewportWidth - menuWidth - padding;
        }
        if (absoluteLeft < padding) {
          // Ensure minimum padding from left edge
          absoluteLeft = padding;
        }

        // Ensure menu fits vertically in viewport
        if (absoluteTop < padding) {
          // Not enough space above, position below cursor
          absoluteTop = textareaRect.top + coords.top + 20; // 20px below cursor
        }
        if (absoluteTop + menuHeight > viewportHeight - padding) {
          // Shift up to fit
          absoluteTop = viewportHeight - menuHeight - padding;
        }

        setPosition({ top: absoluteTop, left: absoluteLeft });
      } catch (err) {
        console.error('[GenericTypeahead] Failed to calculate position:', err);
        // Fallback to below textarea
        const textareaRect = anchorElement.getBoundingClientRect();
        setPosition({
          top: textareaRect.bottom + 2,
          left: textareaRect.left
        });
      }
    };

    // Calculate immediately
    calculatePosition();

    // Recalculate after menu renders to get accurate height
    const timer = setTimeout(calculatePosition, 0);
    return () => clearTimeout(timer);
  }, [anchorElement, cursorPosition, options.length, maxHeight, minWidth]);

  // Scroll selected option into view
  useEffect(() => {
    if (selectedIndex === null || !menuRef.current) return;

    const selectedElement = menuRef.current.querySelector(
      `[data-option-index="${selectedIndex}"]`
    ) as HTMLElement;

    if (selectedElement) {
      selectedElement.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth'
      });
    }
  }, [selectedIndex]);

  // Handle click outside to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        anchorElement &&
        !anchorElement.contains(e.target as Node)
      ) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [anchorElement, onClose]);

  // Handle option click
  const handleOptionClick = useCallback((option: TypeaheadOption, index: number) => {
    if (option.disabled) return;
    onSelect(option);
  }, [onSelect]);

  // Group options by section
  const groupedOptions = React.useMemo(() => {
    const hasSections = options.some(opt => opt.section);
    if (!hasSections) {
      return [{ section: null, options }];
    }

    const groups: Record<string, TypeaheadOption[]> = {};
    options.forEach(opt => {
      const section = opt.section || 'Other';
      if (!groups[section]) {
        groups[section] = [];
      }
      groups[section].push(opt);
    });

    return Object.entries(groups)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([section, opts]) => ({ section, options: opts }));
  }, [options]);

  if (options.length === 0) {
    return null;
  }

  const menuElement = (
    <div
      ref={menuRef}
      className={`generic-typeahead ${className}`}
      style={{
        position: 'fixed',
        top: `${position.top}px`,
        left: `${position.left}px`,
        maxHeight: `${maxHeight}px`,
        minWidth: `${minWidth}px`,
        maxWidth: `${maxWidth}px`
      }}
    >
      <div className="generic-typeahead-content">
        {groupedOptions.map(({ section, options: sectionOptions }, groupIndex) => (
          <div key={section || groupIndex} className="generic-typeahead-section">
            {section && (
              <div className="generic-typeahead-section-header">{section}</div>
            )}
            {sectionOptions.map((option, optionIndex) => {
              // Calculate flat index across all options
              const flatIndex = options.findIndex(opt => opt.id === option.id);
              const isSelected = selectedIndex === flatIndex;

              return (
                <div
                  key={option.id}
                  data-option-index={flatIndex}
                  className={`generic-typeahead-option ${
                    isSelected ? 'selected' : ''
                  } ${option.disabled ? 'disabled' : ''}`}
                  onClick={() => handleOptionClick(option, flatIndex)}
                  onMouseEnter={() => onSelectedIndexChange(flatIndex)}
                >
                  {option.icon && (
                    <span className="material-symbols-outlined generic-typeahead-option-icon">
                      {option.icon}
                    </span>
                  )}
                  <div className="generic-typeahead-option-label">
                    {option.label}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );

  return createPortal(menuElement, document.body);
}
