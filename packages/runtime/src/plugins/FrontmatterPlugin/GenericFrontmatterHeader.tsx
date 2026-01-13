/**
 * GenericFrontmatterHeader - Renders arbitrary YAML frontmatter as editable fields
 *
 * This component provides a generic UI for any frontmatter that isn't handled
 * by specialized providers (like TrackerDocumentHeader).
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { DocumentHeaderComponentProps } from '../TrackerPlugin/documentHeader/DocumentHeaderRegistry';
import {
  extractFrontmatterWithError,
  parseFields,
  updateFieldInFrontmatter,
  type InferredField,
} from './fieldUtils';
import { MaterialSymbol } from '../../ui/icons/MaterialSymbol';
import './GenericFrontmatterHeader.css';

export const GenericFrontmatterHeader: React.FC<DocumentHeaderComponentProps> = ({
  content,
  onContentChange,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [localFields, setLocalFields] = useState<InferredField[]>([]);

  // Parse frontmatter into fields (with error handling)
  const parseResult = useMemo(() => extractFrontmatterWithError(content), [content]);
  const fields = useMemo(
    () => (parseResult.data ? parseFields(parseResult.data) : []),
    [parseResult.data]
  );

  // Sync local state with parsed fields
  useEffect(() => {
    setLocalFields(fields);
  }, [fields]);

  const handleFieldChange = useCallback(
    (fieldKey: string, newValue: unknown) => {
      if (!onContentChange) return;

      const updatedContent = updateFieldInFrontmatter(content, fieldKey, newValue);
      onContentChange(updatedContent);
    },
    [content, onContentChange]
  );

  const renderTagsField = useCallback(
    (field: InferredField) => {
      const tags = Array.isArray(field.value) ? field.value : [];

      const handleRemoveTag = (index: number) => {
        const newTags = [...tags];
        newTags.splice(index, 1);
        handleFieldChange(field.key, newTags);
      };

      const handleAddTag = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const input = e.currentTarget;
          const newTag = input.value.trim();
          if (newTag && !tags.includes(newTag)) {
            handleFieldChange(field.key, [...tags, newTag]);
            input.value = '';
          }
        }
      };

      return (
        <div key={field.key} className="frontmatter-field frontmatter-field-tags">
          <label>{field.key}</label>
          <div className="frontmatter-tags-container">
            {tags.map((tag, index) => (
              <span key={index} className="frontmatter-tag">
                {String(tag)}
                <button
                  className="frontmatter-tag-remove"
                  onClick={() => handleRemoveTag(index)}
                  aria-label={`Remove ${tag}`}
                >
                  <MaterialSymbol icon="close" size={12} />
                </button>
              </span>
            ))}
            <input
              type="text"
              className="frontmatter-tag-input"
              placeholder="Add tag..."
              onKeyDown={handleAddTag}
            />
          </div>
        </div>
      );
    },
    [handleFieldChange]
  );

  const renderField = useCallback(
    (field: InferredField) => {
      const fieldId = `frontmatter-${field.key}`;

      switch (field.type) {
        case 'tags':
          return renderTagsField(field);

        case 'boolean':
          return (
            <div key={field.key} className="frontmatter-field frontmatter-field-checkbox">
              <label htmlFor={fieldId}>
                <input
                  id={fieldId}
                  type="checkbox"
                  checked={Boolean(field.value)}
                  onChange={(e) => handleFieldChange(field.key, e.target.checked)}
                />
                {field.key}
              </label>
            </div>
          );

        case 'date':
          // Convert date to input format (YYYY-MM-DD)
          let dateValue = '';
          let originalTimeComponent = '';
          if (field.value instanceof Date) {
            // Handle Date object from js-yaml
            const d = field.value;
            if (!isNaN(d.getTime())) {
              const isoString = d.toISOString();
              dateValue = isoString.split('T')[0];
              // Preserve time component if it exists
              const timeMatch = isoString.match(/T(.+)$/);
              if (timeMatch) {
                originalTimeComponent = timeMatch[1];
              }
            }
          } else if (typeof field.value === 'string') {
            const match = field.value.match(/^(\d{4}-\d{2}-\d{2})(T.+)?$/);
            if (match) {
              dateValue = match[1];
              // Preserve time component if it exists
              if (match[2]) {
                originalTimeComponent = match[2].substring(1); // Remove 'T' prefix
              }
            }
          }
          return (
            <div key={field.key} className="frontmatter-field">
              <label htmlFor={fieldId}>{field.key}</label>
              <input
                id={fieldId}
                type="date"
                value={dateValue}
                onChange={(e) => {
                  // Preserve time component when updating date
                  const newDate = e.target.value;
                  const newValue = originalTimeComponent
                    ? `${newDate}T${originalTimeComponent}`
                    : newDate;
                  handleFieldChange(field.key, newValue);
                }}
              />
            </div>
          );

        case 'number':
          return (
            <div key={field.key} className="frontmatter-field">
              <label htmlFor={fieldId}>{field.key}</label>
              <input
                id={fieldId}
                type="number"
                step="any"
                value={field.value as number}
                onChange={(e) => {
                  const val = e.target.value;
                  // Handle empty string - don't convert to 0
                  if (val === '') {
                    handleFieldChange(field.key, null);
                  } else {
                    // Preserve decimal precision by using parseFloat
                    const numValue = parseFloat(val);
                    handleFieldChange(field.key, isNaN(numValue) ? null : numValue);
                  }
                }}
              />
            </div>
          );

        case 'link':
          // Validate URL to prevent XSS via javascript: protocol
          const isValidUrl = (url: string): boolean => {
            return url.startsWith('http://') || url.startsWith('https://');
          };
          const linkValue = String(field.value || '');
          const canRenderLink = linkValue && isValidUrl(linkValue);

          return (
            <div key={field.key} className="frontmatter-field frontmatter-field-link">
              <label htmlFor={fieldId}>{field.key}</label>
              <div className="frontmatter-link-container">
                <input
                  id={fieldId}
                  type="url"
                  value={linkValue}
                  onChange={(e) => handleFieldChange(field.key, e.target.value)}
                  placeholder="https://..."
                />
                {canRenderLink && (
                  <a
                    href={linkValue}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="frontmatter-link-open"
                    aria-label="Open link"
                  >
                    <MaterialSymbol icon="open_in_new" size={14} />
                  </a>
                )}
              </div>
            </div>
          );

        case 'array':
          // Non-tag arrays as comma-separated
          const arrayValue = Array.isArray(field.value) ? field.value.join(', ') : '';
          return (
            <div key={field.key} className="frontmatter-field">
              <label htmlFor={fieldId}>{field.key}</label>
              <input
                id={fieldId}
                type="text"
                value={arrayValue}
                onChange={(e) => {
                  const newValue = e.target.value
                    .split(',')
                    .map((v) => v.trim())
                    .filter((v) => v.length > 0);
                  handleFieldChange(field.key, newValue);
                }}
                placeholder="Comma-separated values"
              />
            </div>
          );

        case 'string':
        default:
          return (
            <div key={field.key} className="frontmatter-field">
              <label htmlFor={fieldId}>{field.key}</label>
              <input
                id={fieldId}
                type="text"
                value={String(field.value || '')}
                onChange={(e) => handleFieldChange(field.key, e.target.value)}
              />
            </div>
          );
      }
    },
    [handleFieldChange, renderTagsField]
  );

  // Show error banner if frontmatter exists but failed to parse
  if (parseResult.hasFrontmatter && !parseResult.success) {
    return (
      <div className="frontmatter-header frontmatter-header-error">
        <div className="frontmatter-error-banner">
          <MaterialSymbol icon="error" size={20} />
          <div className="frontmatter-error-content">
            <span className="frontmatter-error-title">Invalid Frontmatter</span>
            <span className="frontmatter-error-message">{parseResult.error}</span>
          </div>
        </div>
      </div>
    );
  }

  if (localFields.length === 0) {
    return null;
  }

  if (isCollapsed) {
    return (
      <div className="frontmatter-header frontmatter-header-collapsed">
        <button
          className="frontmatter-toggle"
          onClick={() => setIsCollapsed(false)}
          aria-label="Expand metadata"
        >
          <MaterialSymbol icon="data_object" size={18} />
          <span>Document Metadata</span>
          <span className="frontmatter-field-count">{localFields.length} fields</span>
        </button>
      </div>
    );
  }

  return (
    <div className="frontmatter-header">
      <div
        className="frontmatter-header-title"
        onClick={() => setIsCollapsed(true)}
        style={{ cursor: 'pointer' }}
      >
        <div className="frontmatter-title-left">
          <MaterialSymbol icon="data_object" size={20} />
          <span>Document Metadata</span>
        </div>
        <MaterialSymbol icon="expand_less" size={18} className="frontmatter-collapse-icon" />
      </div>

      <div className="frontmatter-content">
        <div className="frontmatter-fields">
          {localFields.map((field) => renderField(field))}
        </div>
      </div>
    </div>
  );
};

/**
 * Check if content should render the generic frontmatter header
 */
export function shouldRenderGenericFrontmatter(content: string): boolean {
  const result = extractFrontmatterWithError(content);

  // No frontmatter at all
  if (!result.hasFrontmatter) {
    return false;
  }

  // Show error banner for invalid frontmatter
  if (!result.success) {
    return true;
  }

  // No data parsed
  if (!result.data) {
    return false;
  }

  // Skip if it's a tracker document
  if (result.data.planStatus || result.data.decisionStatus || result.data.trackerStatus) {
    return false;
  }

  // Check for at least one renderable field
  const fields = parseFields(result.data);
  return fields.length > 0;
}
