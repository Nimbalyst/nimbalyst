/**
 * FormulaBar Component
 *
 * Displays the current cell reference and allows editing cell values/formulas.
 * Uses imperative updates to avoid parent re-renders on selection change.
 */

import { useCallback, useRef, useState, useImperativeHandle, forwardRef } from 'react';

interface FormulaBarProps {
  /** Called when the value changes */
  onChange: (value: string) => void;
}

export interface FormulaBarHandle {
  /** Update the displayed cell reference and value */
  update: (cellRef: string, value: string, isFormula: boolean) => void;
}

export const FormulaBar = forwardRef<FormulaBarHandle, FormulaBarProps>(
  function FormulaBar({ onChange }, ref) {
    const [cellRef, setCellRef] = useState('');
    const [displayValue, setDisplayValue] = useState('');
    const [localValue, setLocalValue] = useState('');
    const [isFormula, setIsFormula] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    // Expose imperative update method
    useImperativeHandle(ref, () => ({
      update: (newCellRef: string, newValue: string, newIsFormula: boolean) => {
        setCellRef(newCellRef);
        setDisplayValue(newValue);
        setLocalValue(newValue);
        setIsFormula(newIsFormula);
      },
    }), []);

    const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
      setLocalValue(e.target.value);
    }, []);

    const handleBlur = useCallback(() => {
      if (localValue !== displayValue) {
        onChange(localValue);
      }
    }, [localValue, displayValue, onChange]);

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
          if (localValue !== displayValue) {
            onChange(localValue);
          }
          inputRef.current?.blur();
        } else if (e.key === 'Escape') {
          setLocalValue(displayValue);
          inputRef.current?.blur();
        }
      },
      [localValue, displayValue, onChange]
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
);
