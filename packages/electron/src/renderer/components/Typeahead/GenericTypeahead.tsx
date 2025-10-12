import React, { useEffect, useRef, useState, useCallback } from 'react';
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

  // Calculate menu position based on cursor
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

        // Get textarea and viewport bounds
        const textareaRect = anchorElement.getBoundingClientRect();
        const viewportWidth = window.innerWidth;

        // Calculate absolute position of the menu
        const absoluteLeft = textareaRect.left + coords.left;
        const absoluteRight = absoluteLeft + menuWidth;

        // Check if menu would overflow the right side of viewport
        let left = coords.left;
        if (absoluteRight > viewportWidth) {
          // Shift menu left to fit in viewport
          const overflow = absoluteRight - viewportWidth + 10; // 10px padding
          left = coords.left - overflow;

          // Make sure we don't go negative
          if (left < -textareaRect.left) {
            left = -textareaRect.left + 10; // 10px padding from left edge
          }
        }

        // Position menu above cursor (coords are already relative to textarea)
        // Add a minimal offset (2px) above the cursor line
        const top = coords.top - menuHeight - 2;

        // console.log('[GenericTypeahead] Position calculated:', {
        //   top,
        //   left,
        //   coords,
        //   menuHeight,
        //   menuWidth,
        //   absoluteLeft,
        //   absoluteRight,
        //   viewportWidth,
        //   overflow: absoluteRight - viewportWidth
        // });
        setPosition({ top, left });
      } catch (err) {
        console.error('[GenericTypeahead] Failed to calculate position:', err);
        // Fallback to above textarea
        setPosition({
          top: -maxHeight,
          left: 0
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

  return (
    <div
      ref={menuRef}
      className={`generic-typeahead ${className}`}
      style={{
        position: 'absolute',
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
}
