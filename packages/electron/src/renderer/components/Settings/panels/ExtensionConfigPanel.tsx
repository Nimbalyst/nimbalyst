import React, { useState, useEffect, useCallback } from 'react';
import type { ExtensionManifest, ConfigurationProperty } from '@nimbalyst/runtime';

interface ExtensionConfigPanelProps {
  extensionId: string;
  manifest: ExtensionManifest;
  scope: 'user' | 'project';
  workspacePath?: string;
  onConfigChange?: () => void;
}

/**
 * Renders a dynamic configuration panel for an extension based on its
 * configuration contribution in the manifest.
 */
export const ExtensionConfigPanel: React.FC<ExtensionConfigPanelProps> = ({
  extensionId,
  manifest,
  scope,
  workspacePath,
  onConfigChange,
}) => {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const config = manifest.contributions?.configuration;
  const properties = config?.properties ?? {};

  // Load configuration values
  useEffect(() => {
    loadConfig();
  }, [extensionId, scope, workspacePath]);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const apiScope = scope === 'project' ? 'workspace' : 'user';
      const userConfig = await window.electronAPI.extensions.getConfig(extensionId, 'user');

      // If in project scope, also get workspace config which overrides user
      let workspaceConfig: Record<string, unknown> = {};
      if (scope === 'project' && workspacePath) {
        workspaceConfig = await window.electronAPI.extensions.getConfig(extensionId, 'workspace', workspacePath);
      }

      // Merge configs: defaults < user < workspace
      const merged: Record<string, unknown> = {};
      for (const [key, prop] of Object.entries(properties)) {
        // Start with default
        merged[key] = prop.default;
        // Override with user value if present
        if (userConfig[key] !== undefined) {
          merged[key] = userConfig[key];
        }
        // Override with workspace value if in project scope
        if (scope === 'project' && workspaceConfig[key] !== undefined) {
          merged[key] = workspaceConfig[key];
        }
      }

      setValues(merged);
    } catch (err) {
      console.error('Failed to load extension config:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleChange = useCallback(async (key: string, value: unknown) => {
    setSaving(true);
    try {
      const apiScope = scope === 'project' ? 'workspace' : 'user';
      await window.electronAPI.extensions.setConfig(
        extensionId,
        key,
        value,
        apiScope,
        scope === 'project' ? workspacePath : undefined
      );

      setValues(prev => ({ ...prev, [key]: value }));
      onConfigChange?.();
    } catch (err) {
      console.error('Failed to save extension config:', err);
    } finally {
      setSaving(false);
    }
  }, [extensionId, scope, workspacePath, onConfigChange]);

  if (!config || Object.keys(properties).length === 0) {
    return (
      <div className="extension-config-empty">
        <p>This extension has no configurable settings.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="extension-config-loading">
        <p>Loading configuration...</p>
      </div>
    );
  }

  // Sort properties by order
  const sortedProperties = Object.entries(properties).sort(
    ([, a], [, b]) => (a.order ?? 1000) - (b.order ?? 1000)
  );

  return (
    <div className="extension-config-panel">
      {config.title && (
        <div className="extension-config-header">
          <h4>{config.title}</h4>
        </div>
      )}
      <div className="extension-config-fields">
        {sortedProperties.map(([key, prop]) => (
          <ConfigField
            key={key}
            propertyKey={key}
            property={prop}
            value={values[key]}
            onChange={(value) => handleChange(key, value)}
            disabled={saving}
          />
        ))}
      </div>
    </div>
  );
};

interface ConfigFieldProps {
  propertyKey: string;
  property: ConfigurationProperty;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
}

const ConfigField: React.FC<ConfigFieldProps> = ({
  propertyKey,
  property,
  value,
  onChange,
  disabled,
}) => {
  const { type, description, placeholder } = property;

  // Render based on property type
  switch (type) {
    case 'boolean':
      return (
        <div className="config-field config-field-boolean">
          <label className="config-field-toggle">
            <input
              type="checkbox"
              checked={Boolean(value)}
              onChange={(e) => onChange(e.target.checked)}
              disabled={disabled}
            />
            <span className="config-field-label">{description || propertyKey}</span>
          </label>
        </div>
      );

    case 'string':
      // If has enum, render as select
      if (property.enum && property.enum.length > 0) {
        return (
          <div className="config-field config-field-select">
            <label className="config-field-label-block">
              <span>{description || propertyKey}</span>
              <select
                value={String(value ?? '')}
                onChange={(e) => onChange(e.target.value)}
                disabled={disabled}
              >
                {property.enum.map((opt, idx) => (
                  <option key={String(opt)} value={String(opt)}>
                    {property.enumDescriptions?.[idx] ?? String(opt)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        );
      }

      // Regular text input
      return (
        <div className="config-field config-field-text">
          <label className="config-field-label-block">
            <span>{description || propertyKey}</span>
            <input
              type="text"
              value={String(value ?? '')}
              onChange={(e) => onChange(e.target.value)}
              placeholder={placeholder}
              pattern={property.pattern}
              disabled={disabled}
            />
          </label>
        </div>
      );

    case 'number':
      return (
        <div className="config-field config-field-number">
          <label className="config-field-label-block">
            <span>{description || propertyKey}</span>
            <input
              type="number"
              value={value !== undefined ? Number(value) : ''}
              onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}
              min={property.minimum}
              max={property.maximum}
              placeholder={placeholder}
              disabled={disabled}
            />
          </label>
        </div>
      );

    default:
      // Fallback for unsupported types
      return (
        <div className="config-field config-field-unsupported">
          <span className="config-field-label">{description || propertyKey}</span>
          <span className="config-field-value">{JSON.stringify(value)}</span>
          <span className="config-field-hint">Type "{type}" not supported in UI</span>
        </div>
      );
  }
};

export default ExtensionConfigPanel;
