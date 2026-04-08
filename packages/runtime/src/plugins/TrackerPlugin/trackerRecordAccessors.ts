/**
 * Accessor utilities for reading TrackerRecord fields via schema roles.
 *
 * These are pure functions (no React hooks) so they can be used in both
 * renderer components and non-React code (MCP handlers, sync, etc.).
 */

import type { TrackerRecord } from '../../core/TrackerRecord';
import type { TrackerSchemaRole, FieldDefinition } from './models/TrackerDataModel';
import { globalRegistry, getRoleField } from './models/TrackerDataModel';

/**
 * Conventional field names for each role.
 * Used as fallback when a model doesn't declare explicit roles.
 */
const ROLE_DEFAULTS: Record<TrackerSchemaRole, string> = {
  title: 'title',
  workflowStatus: 'status',
  priority: 'priority',
  assignee: 'owner',
  reporter: 'reporterEmail',
  tags: 'tags',
  startDate: 'startDate',
  dueDate: 'dueDate',
  progress: 'progress',
};

/**
 * Resolve the field name for a role given a tracker type.
 * Uses explicit role mapping first, falls back to conventional defaults.
 */
export function resolveRoleFieldName(type: string, role: TrackerSchemaRole): string {
  const model = globalRegistry.get(type);
  if (model) {
    const explicit = getRoleField(model, role);
    if (explicit) return explicit;
  }
  return ROLE_DEFAULTS[role];
}

/**
 * Get the value of the field that fulfills a given role for a record.
 * Uses the model's explicit role mapping first, falls back to
 * conventional field names when no role is declared.
 */
export function getFieldByRole(record: TrackerRecord, role: TrackerSchemaRole): unknown {
  const model = globalRegistry.get(record.primaryType);
  const fieldName = model ? (getRoleField(model, role) ?? ROLE_DEFAULTS[role]) : ROLE_DEFAULTS[role];
  return record.fields[fieldName];
}

/**
 * Get a typed field value by role with a fallback.
 */
export function getFieldByRoleAs<T>(record: TrackerRecord, role: TrackerSchemaRole, fallback: T): T {
  const value = getFieldByRole(record, role);
  return (value as T) ?? fallback;
}

/**
 * Get a string field value directly from record.fields.
 */
export function getRecordField(record: TrackerRecord, fieldName: string): unknown {
  return record.fields[fieldName];
}

/**
 * Get a string field value with fallback.
 */
export function getRecordFieldStr(record: TrackerRecord, fieldName: string, fallback = ''): string {
  const value = record.fields[fieldName];
  return typeof value === 'string' ? value : fallback;
}

/**
 * Get the title of a record using the title role.
 * Falls back to empty string if no title role is defined.
 */
export function getRecordTitle(record: TrackerRecord): string {
  return getFieldByRoleAs<string>(record, 'title', '');
}

/**
 * Get the workflow status of a record using the workflowStatus role.
 */
export function getRecordStatus(record: TrackerRecord): string {
  return getFieldByRoleAs<string>(record, 'workflowStatus', '');
}

/**
 * Get the priority of a record using the priority role.
 */
export function getRecordPriority(record: TrackerRecord): string {
  return getFieldByRoleAs<string>(record, 'priority', '');
}

/**
 * Get the FieldDefinition for the field that fulfills a role in a record's type.
 * Falls back to conventional field names when no role is declared.
 */
export function getFieldDefForRole(type: string, role: TrackerSchemaRole): FieldDefinition | undefined {
  const model = globalRegistry.get(type);
  if (!model) return undefined;
  const fieldName = getRoleField(model, role) ?? ROLE_DEFAULTS[role];
  return model.fields.find(f => f.name === fieldName);
}

/**
 * Get the status options for a record's type (the workflowStatus role's select options).
 */
export function getStatusOptions(type: string): Array<{ value: string; label: string; icon?: string; color?: string }> {
  const fieldDef = getFieldDefForRole(type, 'workflowStatus');
  return fieldDef?.options ?? [];
}

/**
 * Get the priority options for a record's type.
 */
export function getPriorityOptions(type: string): Array<{ value: string; label: string; icon?: string; color?: string }> {
  const fieldDef = getFieldDefForRole(type, 'priority');
  return fieldDef?.options ?? [];
}
