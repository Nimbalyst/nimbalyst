/**
 * Core types and interfaces for the unified tracker system
 */

export type FieldType =
  | 'string'
  | 'text'
  | 'number'
  | 'select'
  | 'multiselect'
  | 'date'
  | 'datetime'
  | 'boolean'
  | 'user'
  | 'reference'
  | 'array'
  | 'object';

export interface FieldOption {
  value: string;
  label: string;
  icon?: string;
  color?: string;
}

export interface FieldDefinition {
  name: string;
  type: FieldType;
  required?: boolean;
  default?: any;
  displayInline?: boolean;
  readOnly?: boolean;

  // For string/text
  minLength?: number;
  maxLength?: number;

  // For number
  min?: number;
  max?: number;

  // For select/multiselect
  options?: FieldOption[];

  // For array
  itemType?: FieldType;
  schema?: FieldDefinition[];
}

export interface StatusBarLayoutRow {
  row: Array<{
    field: string;
    width: number | 'auto';
  }>;
}

export interface TrackerModes {
  inline: boolean;
  fullDocument: boolean;
}

export interface TableViewConfig {
  defaultColumns: string[];
  sortable: boolean;
  filterable: boolean;
  exportable: boolean;
}

/**
 * Sync policy for a tracker type.
 * Controls whether tracked items of this type participate in collaborative sync.
 */
export type TrackerSyncMode = 'local' | 'shared' | 'hybrid';

export interface TrackerSyncPolicy {
  /** How items sync: local (never), shared (always), hybrid (per-item choice) */
  mode: TrackerSyncMode;
  /** Scope of sync: project (git remote) or workspace (local path) */
  scope: 'project' | 'workspace';
}

export interface TrackerDataModel {
  type: string;
  displayName: string;
  displayNamePlural: string;
  icon: string;
  color: string;
  modes: TrackerModes;
  idPrefix: string;
  idFormat: 'ulid' | 'uuid' | 'sequential';
  fields: FieldDefinition[];
  statusBarLayout?: StatusBarLayoutRow[];
  inlineTemplate?: string;
  tableView?: TableViewConfig;
  /** Sync policy for collaborative tracking. Defaults to local if omitted. */
  sync?: TrackerSyncPolicy;
  /** If false, items of this type cannot be created via tracker_create. Defaults to true. */
  creatable?: boolean;
  /** Whether this type can be used as a primary type. Defaults to true. */
  primaryCapable?: boolean;
}

/**
 * Runtime tracker item instance
 */
export interface TrackerItem {
  id: string;
  type: string;
  data: Record<string, any>;
  workspace: string;
  documentPath?: string;
  lineNumber?: number;
  created: string;
  updated: string;
  lastIndexed?: string;
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: Array<{
    field: string;
    message: string;
  }>;
}

/**
 * Data model registry
 */
export class TrackerDataModelRegistry {
  private models: Map<string, TrackerDataModel> = new Map();
  private listeners: Set<() => void> = new Set();

  register(model: TrackerDataModel): void {
    this.models.set(model.type, model);
    this.listeners.forEach(fn => fn());
  }

  /** Subscribe to registry changes. Returns an unsubscribe function. */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  get(type: string): TrackerDataModel | undefined {
    return this.models.get(type);
  }

  getAll(): TrackerDataModel[] {
    return Array.from(this.models.values());
  }

  has(type: string): boolean {
    return this.models.has(type);
  }

  validate(type: string, data: Record<string, any>): ValidationResult {
    const model = this.get(type);
    if (!model) {
      return {
        valid: false,
        errors: [{ field: 'type', message: `Unknown tracker type: ${type}` }],
      };
    }

    const errors: Array<{ field: string; message: string }> = [];

    for (const field of model.fields) {
      const value = data[field.name];

      // Check required fields
      if (field.required && (value === undefined || value === null || value === '')) {
        errors.push({
          field: field.name,
          message: `Field '${field.name}' is required`,
        });
        continue;
      }

      // Skip validation if field is not provided and not required
      if (value === undefined || value === null) {
        continue;
      }

      // Type validation
      switch (field.type) {
        case 'number':
          if (typeof value !== 'number') {
            errors.push({
              field: field.name,
              message: `Field '${field.name}' must be a number`,
            });
          } else {
            if (field.min !== undefined && value < field.min) {
              errors.push({
                field: field.name,
                message: `Field '${field.name}' must be >= ${field.min}`,
              });
            }
            if (field.max !== undefined && value > field.max) {
              errors.push({
                field: field.name,
                message: `Field '${field.name}' must be <= ${field.max}`,
              });
            }
          }
          break;

        case 'select':
          if (field.options && !field.options.some(opt => opt.value === value)) {
            errors.push({
              field: field.name,
              message: `Field '${field.name}' has invalid option: ${value}`,
            });
          }
          break;

        case 'array':
          if (!Array.isArray(value)) {
            errors.push({
              field: field.name,
              message: `Field '${field.name}' must be an array`,
            });
          }
          break;

        case 'boolean':
          if (typeof value !== 'boolean') {
            errors.push({
              field: field.name,
              message: `Field '${field.name}' must be a boolean`,
            });
          }
          break;
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}

// Global registry instance
export const globalRegistry = new TrackerDataModelRegistry();

/**
 * Base fields shared by all tracker item types.
 * Types only need to define their unique fields on top of these.
 */
export const BASE_TRACKER_FIELDS: FieldDefinition[] = [
  { name: 'title', type: 'string', required: true, displayInline: true },
  {
    name: 'status',
    type: 'select',
    default: 'to-do',
    options: [
      { value: 'to-do', label: 'To Do', icon: 'circle' },
      { value: 'in-progress', label: 'In Progress', icon: 'motion_photos_on' },
      { value: 'done', label: 'Done', icon: 'check_circle' },
    ],
  },
  {
    name: 'priority',
    type: 'select',
    options: [
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' },
      { value: 'critical', label: 'Critical' },
    ],
  },
  { name: 'owner', type: 'user' },
  { name: 'assigneeEmail', type: 'user' },
  { name: 'reporterEmail', type: 'user' },
  { name: 'description', type: 'text' },
  { name: 'tags', type: 'array', itemType: 'string', displayInline: false },
  { name: 'created', type: 'datetime', displayInline: false, readOnly: true },
  { name: 'updated', type: 'datetime', displayInline: false, readOnly: true },
];

/**
 * Resolve the available fields for an item with multiple type tags.
 * Returns the union of all tag types' fields, with base fields first.
 * First type tag wins for duplicate field names (primary type takes precedence).
 */
export function resolveFields(typeTags: string[]): FieldDefinition[] {
  const seen = new Set<string>();
  const fields: FieldDefinition[] = [];

  // Base fields always come first
  for (const field of BASE_TRACKER_FIELDS) {
    seen.add(field.name);
    fields.push(field);
  }

  // Then add type-specific fields from each tag
  for (const tag of typeTags) {
    const model = globalRegistry.get(tag);
    if (!model) continue;
    for (const field of model.fields) {
      if (!seen.has(field.name)) {
        seen.add(field.name);
        fields.push(field);
      }
    }
  }

  return fields;
}
