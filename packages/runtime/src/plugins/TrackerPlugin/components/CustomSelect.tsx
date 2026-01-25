/**
 * Custom Select component that supports rendering icons in options
 */

import React, { useState, useRef, useEffect } from 'react';
import {MaterialSymbol} from "../../../ui";

export interface SelectOption {
  value: string;
  label: string;
  icon?: string;
  color?: string;
}

interface CustomSelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
}

export const CustomSelect: React.FC<CustomSelectProps> = ({
  value,
  options,
  onChange,
  placeholder = 'Select...',
  required = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find(opt => opt.value === value);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
    return undefined;
  }, [isOpen]);

  const handleSelect = (optionValue: string) => {
    onChange(optionValue);
    setIsOpen(false);
  };

  return (
    <div className="custom-select relative inline-block w-full" ref={containerRef}>
      <button
        type="button"
        className="custom-select-trigger flex items-center justify-between w-full py-1.5 px-2 bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] rounded text-[13px] text-[var(--nim-text)] cursor-pointer transition-all duration-150 hover:bg-[var(--nim-bg-hover)] hover:border-[var(--nim-primary)] focus:outline-none focus:border-[var(--nim-primary)] focus:shadow-[0_0_0_2px_rgba(59,130,246,0.1)]"
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        {selectedOption ? (
          <span className="custom-select-value flex items-center gap-1.5 flex-1">
            {selectedOption.icon && (
              <MaterialSymbol icon={selectedOption.icon} size={16} />
            )}
            <span>{selectedOption.label}</span>
          </span>
        ) : (
          <span className="custom-select-placeholder text-[var(--nim-text-faint)]">{placeholder}</span>
        )}
        <MaterialSymbol icon={isOpen ? 'expand_less' : 'expand_more'} size={16} />
      </button>

      {isOpen && (
        <div className="custom-select-dropdown absolute top-[calc(100%+4px)] left-0 right-0 bg-[var(--nim-bg)] border border-[var(--nim-border)] rounded shadow-[0_4px_12px_rgba(0,0,0,0.15)] max-h-[300px] overflow-y-auto z-[5]">
          {!required && (
            <button
              type="button"
              className="custom-select-option flex items-center gap-1.5 w-full py-2 px-2.5 bg-transparent border-none cursor-pointer text-[13px] text-[var(--nim-text)] text-left transition-colors duration-100 hover:bg-[var(--nim-bg-hover)]"
              onClick={() => handleSelect('')}
            >
              <span className="custom-select-option-label flex-1">None</span>
            </button>
          )}
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`custom-select-option flex items-center gap-1.5 w-full py-2 px-2.5 bg-transparent border-none cursor-pointer text-[13px] text-[var(--nim-text)] text-left transition-colors duration-100 hover:bg-[var(--nim-bg-hover)] ${option.value === value ? 'selected bg-[var(--nim-bg-tertiary)] font-medium' : ''}`}
              onClick={() => handleSelect(option.value)}
            >
              {option.icon && (
                <MaterialSymbol icon={option.icon} size={16} />
              )}
              <span className="custom-select-option-label flex-1">{option.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
