/**
 * Status Bar component for full-document tracker items
 * Renders at the top of the editor based on frontmatter
 */

import React, { useState, useEffect, useCallback } from 'react';
import type { TrackerDataModel, FieldDefinition } from '../models/TrackerDataModel';
import { MaterialSymbol } from './MaterialSymbol';
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
            <select
              id={fieldId}
              value={value || field.default || ''}
              onChange={(e) => handleFieldChange(field.name, e.target.value)}
            >
              {!field.required && <option value="">None</option>}
              {field.options?.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.icon && <span className="material-symbols-outlined">{option.icon}</span>}
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        );

      case 'number':
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
          title="Expand status bar"
        >
          <MaterialSymbol icon={model.icon} size={18} />
          <span>{model.displayName}</span>
          <MaterialSymbol icon="expand_more" size={18} />
        </button>
      </div>
    );
  }

  return (
    <div className="status-bar" style={{ borderLeft: `4px solid ${model.color}` }}>
      <div className="status-bar-header">
        <div className="status-bar-title">
          <MaterialSymbol icon={model.icon} size={20} />
          <span>{model.displayName}</span>
        </div>
        <div className="status-bar-actions">
          <button
            className="status-bar-collapse-btn"
            onClick={() => setIsCollapsed(true)}
            title="Collapse status bar"
          >
            <MaterialSymbol icon="expand_less" size={18} />
          </button>
          {onClose && (
            <button
              className="status-bar-close-btn"
              onClick={onClose}
              title="Remove tracker"
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

// Material Symbol helper component (if not already available globally)
function MaterialSymbolComponent({ icon, size = 20 }: { icon: string; size?: number }) {
  return (
    <span className="material-symbols-outlined" style={{ fontSize: size }}>
      {icon}
    </span>
  );
}

// Use global MaterialSymbol if available, otherwise use local implementation
const MaterialSymbolFallback =
  typeof window !== 'undefined' && (window as any).MaterialSymbol
    ? (window as any).MaterialSymbol
    : MaterialSymbolComponent;

export { MaterialSymbolFallback as MaterialSymbol };
