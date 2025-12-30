/**
 * FormulaBar Component
 *
 * Displays the current cell reference and allows editing cell values/formulas.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

interface FormulaBarProps {
  /** Current cell reference (e.g., "A1") */
  cellRef: string;
  /** Current cell value or formula */
  value: string;
  /** Called when the value changes */
  onChange: (value: string) => void;
  /** Whether the current value is a formula */
  isFormula: boolean;
}

export function FormulaBar({ cellRef, value, onChange, isFormula }: FormulaBarProps) {
  const [localValue, setLocalValue] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync local value with prop
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalValue(e.target.value);
  }, []);

  const handleBlur = useCallback(() => {
    if (localValue !== value) {
      onChange(localValue);
    }
  }, [localValue, value, onChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        if (localValue !== value) {
          onChange(localValue);
        }
        inputRef.current?.blur();
      } else if (e.key === 'Escape') {
        setLocalValue(value);
        inputRef.current?.blur();
      }
    },
    [localValue, value, onChange]
  );

  return (
    <div className="formula-bar">
      <div className="formula-bar-cell-ref">{cellRef || '-'}</div>
      <div className="formula-bar-fx">{isFormula ? 'fx' : ''}</div>
      <input
        ref={inputRef}
        type="text"
        className="formula-bar-input"
        value={localValue}
        onChange={handleChange}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        placeholder={cellRef ? 'Enter value' : 'Select a cell'}
        disabled={!cellRef}
      />
    </div>
  );
}
