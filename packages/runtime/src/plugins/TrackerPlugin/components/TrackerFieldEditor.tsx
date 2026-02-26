/**
 * TrackerFieldEditor - Reusable field editor for tracker data model fields.
 * Renders the appropriate input control based on FieldDefinition type.
 * Used by both StatusBar (document headers) and TrackerItemDetail (edit panel).
 */

import React from 'react';
import type { FieldDefinition } from '../models/TrackerDataModel';
import { CustomSelect } from './CustomSelect';

export interface TrackerFieldEditorProps {
  field: FieldDefinition;
  value: any;
  onChange: (value: any) => void;
  /** 'vertical' = label on top (default), 'horizontal' = label on left */
  layout?: 'horizontal' | 'vertical';
}

const labelClasses = "text-[11px] font-medium text-[var(--nim-text-muted)] uppercase tracking-[0.5px]";
const inputClasses = "py-1.5 px-2 border border-[var(--nim-border)] rounded bg-[var(--nim-bg)] text-[var(--nim-text)] text-[13px] font-inherit transition-colors duration-200 focus:outline-none focus:border-[var(--nim-primary)] focus:shadow-[0_0_0_2px_rgba(59,130,246,0.1)]";

/**
 * Format a display label from a camelCase field name.
 * e.g. "publishDate" -> "Publish Date", "storyPoints" -> "Story Points"
 */
function formatFieldLabel(name: string): string {
  return name
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, s => s.toUpperCase())
    .trim();
}

export const TrackerFieldEditor: React.FC<TrackerFieldEditorProps> = ({
  field,
  value,
  onChange,
  layout = 'vertical',
}) => {
  const fieldId = `field-${field.name}`;
  const label = formatFieldLabel(field.name);

  const wrapperClasses = layout === 'horizontal'
    ? "flex flex-row items-center gap-2 min-w-[120px]"
    : "flex flex-col gap-1 min-w-[120px]";

  switch (field.type) {
    case 'select':
      return (
        <div className={wrapperClasses}>
          <label htmlFor={fieldId} className={labelClasses}>{label}</label>
          <CustomSelect
            value={value || field.default || ''}
            options={field.options || []}
            onChange={onChange}
            required={field.required}
          />
        </div>
      );

    case 'number': {
      const useSlider = field.min !== undefined && field.max !== undefined;

      if (useSlider) {
        return (
          <div className={`${wrapperClasses} status-bar-field-slider`}>
            <div className="slider-header flex justify-between items-center gap-2 mb-1 w-full">
              <label htmlFor={fieldId} className={`${labelClasses} flex-1 mb-0`}>{label}</label>
              <input
                type="number"
                className="w-[60px] py-1 px-2 border border-[var(--nim-border)] rounded bg-[var(--nim-bg)] text-[var(--nim-text)] text-[13px] font-semibold font-inherit text-center transition-colors duration-200 focus:outline-none focus:border-[var(--nim-primary)] focus:shadow-[0_0_0_2px_rgba(59,130,246,0.1)]"
                value={value ?? field.default ?? field.min}
                min={field.min}
                max={field.max}
                onChange={(e) => {
                  const newValue = Number(e.target.value);
                  if (!isNaN(newValue)) {
                    onChange(newValue);
                  }
                }}
              />
            </div>
            <input
              id={fieldId}
              type="range"
              className="w-full"
              value={value ?? field.default ?? field.min}
              min={field.min}
              max={field.max}
              onChange={(e) => onChange(Number(e.target.value))}
            />
          </div>
        );
      }

      return (
        <div className={wrapperClasses}>
          <label htmlFor={fieldId} className={labelClasses}>{label}</label>
          <input
            id={fieldId}
            type="number"
            className={inputClasses}
            value={value ?? field.default ?? ''}
            min={field.min}
            max={field.max}
            onChange={(e) => onChange(Number(e.target.value))}
          />
        </div>
      );
    }

    case 'date':
    case 'datetime': {
      let dateValue = value || '';
      if (value instanceof Date && !isNaN(value.getTime())) {
        const y = value.getFullYear();
        const m = String(value.getMonth() + 1).padStart(2, '0');
        const d = String(value.getDate()).padStart(2, '0');
        dateValue = `${y}-${m}-${d}`;
      }
      return (
        <div className={wrapperClasses}>
          <label htmlFor={fieldId} className={labelClasses}>{label}</label>
          <input
            id={fieldId}
            type="date"
            className={inputClasses}
            value={dateValue}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      );
    }

    case 'text':
      return (
        <div className={wrapperClasses}>
          <label htmlFor={fieldId} className={labelClasses}>{label}</label>
          <textarea
            id={fieldId}
            className={`${inputClasses} min-h-[80px] resize-y`}
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.required ? 'Required' : 'Optional'}
          />
        </div>
      );

    case 'string':
    case 'user':
      return (
        <div className={wrapperClasses}>
          <label htmlFor={fieldId} className={labelClasses}>{label}</label>
          <input
            id={fieldId}
            type="text"
            className={inputClasses}
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.required ? 'Required' : 'Optional'}
          />
        </div>
      );

    case 'array': {
      const arrayValue = Array.isArray(value) ? value.join(', ') : '';
      return (
        <div className={wrapperClasses}>
          <label htmlFor={fieldId} className={labelClasses}>{label}</label>
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
              onChange(newValue);
            }}
            placeholder="Comma-separated values"
          />
        </div>
      );
    }

    case 'boolean':
      return (
        <div className={layout === 'horizontal' ? "flex flex-row items-center gap-2 min-w-[120px]" : "flex flex-row items-center min-w-[120px]"}>
          <label htmlFor={fieldId} className="flex items-center gap-1.5 normal-case tracking-normal text-[13px] cursor-pointer text-[var(--nim-text)]">
            <input
              id={fieldId}
              type="checkbox"
              className="cursor-pointer w-4 h-4"
              checked={value || false}
              onChange={(e) => onChange(e.target.checked)}
            />
            {label}
          </label>
        </div>
      );

    default:
      return null;
  }
};
