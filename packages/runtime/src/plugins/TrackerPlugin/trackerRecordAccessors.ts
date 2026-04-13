/**
 * Accessor utilities for reading TrackerRecord fields via schema roles.
 *
 * These are pure functions (no React hooks) so they can be used in both
 * renderer components and non-React code (MCP handlers, sync, etc.).
 */

import type { TrackerRecord } from '../../core/TrackerRecord';
import type { TrackerIdentity } from '../../core/DocumentService';
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
 * Get the kanban sort order key for a record.
 * This is a plain data field, not a schema role.
 */
export function getRecordSortOrder(record: TrackerRecord): string | undefined {
  return record.fields.kanbanSortOrder as string | undefined;
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

// ---------------------------------------------------------------------------
// Identity matching
// ---------------------------------------------------------------------------

/**
 * Check whether a string value (owner, assigneeEmail, etc.) matches any
 * facet of the given identity.  All comparisons are case-insensitive.
 */
function matchesIdentity(value: string, identity: TrackerIdentity): boolean {
  const v = value.toLowerCase();
  if (identity.email && v === identity.email.toLowerCase()) return true;
  if (identity.displayName && v === identity.displayName.toLowerCase()) return true;
  if (identity.gitEmail && v === identity.gitEmail.toLowerCase()) return true;
  if (identity.gitName && v === identity.gitName.toLowerCase()) return true;
  return false;
}

/**
 * Determine whether a TrackerRecord belongs to the given identity.
 *
 * Matches on:
 *  1. The assignee-role field (defaults to `owner`) -- any identity facet
 *  2. The `assigneeEmail` field -- any identity facet
 *  3. The author identity stored in system metadata -- email or git email
 *
 * All comparisons are case-insensitive.
 */
export function isMyRecord(record: TrackerRecord, identity: TrackerIdentity): boolean {
  // 1. Assignee role field (resolves to 'owner' by default)
  const assignee = getFieldByRole(record, 'assignee') as string | undefined;
  if (assignee && matchesIdentity(assignee, identity)) return true;

  // 2. Explicit assigneeEmail field (used by MCP tools)
  const assigneeEmail = record.fields.assigneeEmail as string | undefined;
  if (assigneeEmail && matchesIdentity(assigneeEmail, identity)) return true;

  // 3. Author identity (who created the item)
  const author = record.system.authorIdentity;
  if (author?.email && identity.email &&
      author.email.toLowerCase() === identity.email.toLowerCase()) return true;
  if (author?.gitEmail && identity.gitEmail &&
      author.gitEmail.toLowerCase() === identity.gitEmail.toLowerCase()) return true;

  return false;
}
