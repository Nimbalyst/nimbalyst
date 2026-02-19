/**
 * Status Bar component for full-document tracker items
 * Renders at the top of the editor based on frontmatter
 */

import React, { useState, useEffect, useCallback } from 'react';
import type { TrackerDataModel, FieldDefinition } from '../models/TrackerDataModel';
import { MaterialSymbol } from '../../../ui/icons/MaterialSymbol';
import { CustomSelect } from './CustomSelect';
import './StatusBarSlider.css';

export interface StatusBarProps {
  model: TrackerDataModel;
  data: Record<string, any>;
  onChange: (updates: Record<string, any>) => void;
  onClose?: () => void;
}

export const StatusBar: React.FC<StatusBarProps> = ({ model, data, onChange, onClose }) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [localData, setLocalData] = useState<Record<string, any>>(data);

  useEffect(() => {
    setLocalData(data);
  }, [data]);

  const handleFieldChange = useCallback((fieldName: string, value: any) => {
    const newData = { ...localData, [fieldName]: value };
    setLocalData(newData);
    onChange({ [fieldName]: value });
  }, [localData, onChange]);

  const renderField = useCallback((field: FieldDefinition, width: number | 'auto') => {
    const value = localData[field.name];
    const fieldId = `status-bar-${field.name}`;

    const fieldStyle: React.CSSProperties = {
      width: width === 'auto' ? 'auto' : `${width}px`,
      flex: width === 'auto' ? '1' : '0 0 auto',
    };

    const fieldBaseClasses = "status-bar-field flex flex-col gap-1 min-w-[120px]";
    const labelClasses = "text-[11px] font-medium text-[var(--nim-text-muted)] uppercase tracking-[0.5px]";
    const inputClasses = "py-1.5 px-2 border border-[var(--nim-border)] rounded bg-[var(--nim-bg)] text-[var(--nim-text)] text-[13px] font-inherit transition-colors duration-200 focus:outline-none focus:border-[var(--nim-primary)] focus:shadow-[0_0_0_2px_rgba(59,130,246,0.1)]";

    switch (field.type) {
      case 'select':
        return (
          <div key={field.name} className={fieldBaseClasses} style={fieldStyle}>
            <label htmlFor={fieldId} className={labelClasses}>{field.name}</label>
            <CustomSelect
              value={value || field.default || ''}
              options={field.options || []}
              onChange={(newValue) => handleFieldChange(field.name, newValue)}
              required={field.required}
            />
          </div>
        );

      case 'number':
        // Use slider for progress fields or any number field with min/max bounds
        const useSlider = field.min !== undefined && field.max !== undefined;

        if (useSlider) {
          return (
            <div key={field.name} className={`${fieldBaseClasses} status-bar-field-slider`} style={fieldStyle}>
              <div className="slider-header flex justify-between items-center gap-2 mb-1">
                <label htmlFor={fieldId} className={`${labelClasses} flex-1 mb-0`}>{field.name}</label>
                <input
                  type="number"
                  className="slider-number-input w-[60px] py-1 px-2 border border-[var(--nim-border)] rounded bg-[var(--nim-bg)] text-[var(--nim-text)] text-[13px] font-semibold font-inherit text-center transition-colors duration-200 focus:outline-none focus:border-[var(--nim-primary)] focus:shadow-[0_0_0_2px_rgba(59,130,246,0.1)]"
                  value={value ?? field.default ?? field.min}
                  min={field.min}
                  max={field.max}
                  onChange={(e) => {
                    const newValue = Number(e.target.value);
                    if (!isNaN(newValue)) {
                      handleFieldChange(field.name, newValue);
                    }
                  }}
                />
              </div>
              <input
                id={fieldId}
                type="range"
                value={value ?? field.default ?? field.min}
                min={field.min}
                max={field.max}
                onChange={(e) => handleFieldChange(field.name, Number(e.target.value))}
              />
            </div>
          );
        }

        return (
          <div key={field.name} className={fieldBaseClasses} style={fieldStyle}>
            <label htmlFor={fieldId} className={labelClasses}>{field.name}</label>
            <input
              id={fieldId}
              type="number"
              className={inputClasses}
              value={value ?? field.default ?? ''}
              min={field.min}
              max={field.max}
              onChange={(e) => handleFieldChange(field.name, Number(e.target.value))}
            />
          </div>
        );

      case 'date': {
        // Format Date objects to YYYY-MM-DD for the date input
        let dateValue = value || '';
        if (value instanceof Date && !isNaN(value.getTime())) {
          const y = value.getFullYear();
          const m = String(value.getMonth() + 1).padStart(2, '0');
          const d = String(value.getDate()).padStart(2, '0');
          dateValue = `${y}-${m}-${d}`;
        }
        return (
          <div key={field.name} className={fieldBaseClasses} style={fieldStyle}>
            <label htmlFor={fieldId} className={labelClasses}>{field.name}</label>
            <input
              id={fieldId}
              type="date"
              className={inputClasses}
              value={dateValue}
              onChange={(e) => handleFieldChange(field.name, e.target.value)}
            />
          </div>
        );
      }

      case 'string':
      case 'user':
        return (
          <div key={field.name} className={fieldBaseClasses} style={fieldStyle}>
            <label htmlFor={fieldId} className={labelClasses}>{field.name}</label>
            <input
              id={fieldId}
              type="text"
              className={inputClasses}
              value={value || ''}
              onChange={(e) => handleFieldChange(field.name, e.target.value)}
              placeholder={field.required ? 'Required' : 'Optional'}
            />
          </div>
        );

      case 'array':
        // Simple comma-separated input for arrays
        const arrayValue = Array.isArray(value) ? value.join(', ') : '';
        return (
          <div key={field.name} className={fieldBaseClasses} style={fieldStyle}>
            <label htmlFor={fieldId} className={labelClasses}>{field.name}</label>
            <input
              id={fieldId}
              type="text"
              className={inputClasses}
              value={arrayValue}
              onChange={(e) => {
                const newValue = e.target.value
                  .split(',')
                  .map(v => v.trim())
                  .filter(v => v.length > 0);
                handleFieldChange(field.name, newValue);
              }}
              placeholder="Comma-separated values"
            />
          </div>
        );

      case 'boolean':
        return (
          <div key={field.name} className="status-bar-field status-bar-field-checkbox flex flex-row items-center min-w-[120px]" style={fieldStyle}>
            <label htmlFor={fieldId} className="flex items-center gap-1.5 normal-case tracking-normal text-[13px] cursor-pointer">
              <input
                id={fieldId}
                type="checkbox"
                className="cursor-pointer w-4 h-4"
                checked={value || false}
                onChange={(e) => handleFieldChange(field.name, e.target.checked)}
              />
              {field.name}
            </label>
          </div>
        );

      default:
        return null;
    }
  }, [localData, handleFieldChange]);

  if (isCollapsed) {
    return (
      <div className="status-bar status-bar-collapsed bg-[var(--nim-bg-secondary)] py-2 px-3 shadow-[0_1px_3px_rgba(0,0,0,0.1)] relative z-[1]">
        <button
          className="status-bar-toggle bg-transparent border-none p-1.5 px-3 cursor-pointer rounded text-[var(--nim-text-muted)] flex items-center gap-1 transition-all duration-200 w-full justify-between text-[13px] hover:bg-[var(--nim-bg-tertiary)] hover:text-[var(--nim-text)]"
          onClick={() => setIsCollapsed(false)}
          aria-label="Expand status bar"
        >
          <div className="flex items-center gap-2">
            <MaterialSymbol icon={model.icon} size={18} />
            <span>{model.displayName}</span>
          </div>
          {/*<MaterialSymbol icon="expand_more" size={18} />*/}
        </button>
      </div>
    );
  }

  return (
    <div className="status-bar bg-[var(--nim-bg-secondary)] p-3 shadow-[0_1px_3px_rgba(0,0,0,0.1)] relative z-[1]">
      <div
        className="status-bar-header flex justify-between items-center mb-3 p-1 px-2 -m-1 -mx-2 rounded transition-colors duration-150 cursor-pointer hover:bg-[var(--nim-bg-hover)]"
        onClick={() => setIsCollapsed(true)}
      >
        <div className="status-bar-title flex items-center gap-2 font-semibold text-[var(--nim-text)] text-sm">
          <MaterialSymbol icon={model.icon} size={20} />
          <span>{model.displayName}</span>
        </div>
        <div className="status-bar-actions flex gap-1">
          {onClose && (
            <button
              className="status-bar-close-btn bg-transparent border-none p-1 cursor-pointer rounded text-[var(--nim-text-muted)] flex items-center gap-1 transition-all duration-200 relative z-[1] hover:bg-[var(--nim-bg-tertiary)] hover:text-[var(--nim-text)]"
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              aria-label="Remove tracker"
            >
              <MaterialSymbol icon="close" size={18} />
            </button>
          )}
        </div>
      </div>

      <div className="status-bar-content flex flex-col gap-3">
        {model.statusBarLayout ? (
          // Render based on configured layout
          model.statusBarLayout.map((rowConfig, rowIndex) => (
            <div key={rowIndex} className="status-bar-row flex gap-4 items-start flex-wrap">
              {rowConfig.row.map((fieldConfig) => {
                const field = model.fields.find(f => f.name === fieldConfig.field);
                if (!field) return null;
                return renderField(field, fieldConfig.width);
              })}
            </div>
          ))
        ) : (
          // Default layout: one row with all fields
          <div className="status-bar-row flex gap-4 items-start flex-wrap">
            {model.fields
              .filter(f => f.displayInline !== false)
              .map(field => renderField(field, 'auto'))}
          </div>
        )}
      </div>
    </div>
  );
};

