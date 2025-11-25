/**
 * Custom Select component that supports rendering icons in options
 */

import React, { useState, useRef, useEffect } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';
import './CustomSelect.css';

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
  }, [isOpen]);

  const handleSelect = (optionValue: string) => {
    onChange(optionValue);
    setIsOpen(false);
  };

  return (
    <div className="custom-select" ref={containerRef}>
      <button
        type="button"
        className="custom-select-trigger"
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        {selectedOption ? (
          <span className="custom-select-value">
            {selectedOption.icon && (
              <MaterialSymbol icon={selectedOption.icon} size={16} />
            )}
            <span>{selectedOption.label}</span>
          </span>
        ) : (
          <span className="custom-select-placeholder">{placeholder}</span>
        )}
        <MaterialSymbol icon={isOpen ? 'expand_less' : 'expand_more'} size={16} />
      </button>

      {isOpen && (
        <div className="custom-select-dropdown">
          {!required && (
            <button
              type="button"
              className="custom-select-option"
              onClick={() => handleSelect('')}
            >
              <span className="custom-select-option-label">None</span>
            </button>
          )}
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`custom-select-option ${option.value === value ? 'selected' : ''}`}
              onClick={() => handleSelect(option.value)}
            >
              {option.icon && (
                <MaterialSymbol icon={option.icon} size={16} />
              )}
              <span className="custom-select-option-label">{option.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
