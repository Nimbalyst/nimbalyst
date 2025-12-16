/**
 * Status Bar component for full-document tracker items
 * Renders at the top of the editor based on frontmatter
 */

import React, { useState, useEffect, useCallback } from 'react';
import type { TrackerDataModel, FieldDefinition } from '../models/TrackerDataModel';
import { MaterialSymbol } from '../../../ui/icons/MaterialSymbol';
import { CustomSelect } from './CustomSelect';
import './StatusBar.css';

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

    switch (field.type) {
      case 'select':
        return (
          <div key={field.name} className="status-bar-field" style={fieldStyle}>
            <label htmlFor={fieldId}>{field.name}</label>
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
            <div key={field.name} className="status-bar-field status-bar-field-slider" style={fieldStyle}>
              <div className="slider-header">
                <label htmlFor={fieldId}>{field.name}</label>
                <input
                  type="number"
                  className="slider-number-input"
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
          <div key={field.name} className="status-bar-field" style={fieldStyle}>
            <label htmlFor={fieldId}>{field.name}</label>
            <input
              id={fieldId}
              type="number"
              value={value ?? field.default ?? ''}
              min={field.min}
              max={field.max}
              onChange={(e) => handleFieldChange(field.name, Number(e.target.value))}
            />
          </div>
        );

      case 'date':
        return (
          <div key={field.name} className="status-bar-field" style={fieldStyle}>
            <label htmlFor={fieldId}>{field.name}</label>
            <input
              id={fieldId}
              type="date"
              value={value || ''}
              onChange={(e) => handleFieldChange(field.name, e.target.value)}
            />
          </div>
        );

      case 'string':
      case 'user':
        return (
          <div key={field.name} className="status-bar-field" style={fieldStyle}>
            <label htmlFor={fieldId}>{field.name}</label>
            <input
              id={fieldId}
              type="text"
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
          <div key={field.name} className="status-bar-field" style={fieldStyle}>
            <label htmlFor={fieldId}>{field.name}</label>
            <input
              id={fieldId}
              type="text"
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
          <div key={field.name} className="status-bar-field status-bar-field-checkbox" style={fieldStyle}>
            <label htmlFor={fieldId}>
              <input
                id={fieldId}
                type="checkbox"
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
      <div className="status-bar status-bar-collapsed">
        <button
          className="status-bar-toggle"
          onClick={() => setIsCollapsed(false)}
          aria-label="Expand status bar"
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <MaterialSymbol icon={model.icon} size={18} />
            <span>{model.displayName}</span>
          </div>
          {/*<MaterialSymbol icon="expand_more" size={18} />*/}
        </button>
      </div>
    );
  }

  return (
    <div className="status-bar">
      <div
        className="status-bar-header"
        onClick={() => setIsCollapsed(true)}
        style={{ cursor: 'pointer' }}
      >
        <div className="status-bar-title">
          <MaterialSymbol icon={model.icon} size={20} />
          <span>{model.displayName}</span>
        </div>
        <div className="status-bar-actions">
          {onClose && (
            <button
              className="status-bar-close-btn"
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

      <div className="status-bar-content">
        {model.statusBarLayout ? (
          // Render based on configured layout
          model.statusBarLayout.map((rowConfig, rowIndex) => (
            <div key={rowIndex} className="status-bar-row">
              {rowConfig.row.map((fieldConfig) => {
                const field = model.fields.find(f => f.name === fieldConfig.field);
                if (!field) return null;
                return renderField(field, fieldConfig.width);
              })}
            </div>
          ))
        ) : (
          // Default layout: one row with all fields
          <div className="status-bar-row">
            {model.fields
              .filter(f => f.displayInline !== false)
              .map(field => renderField(field, 'auto'))}
          </div>
        )}
      </div>
    </div>
  );
};

