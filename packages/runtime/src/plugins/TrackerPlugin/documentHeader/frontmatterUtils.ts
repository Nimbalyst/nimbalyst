/**
 * Utilities for detecting and parsing tracker frontmatter
 */

import jsyaml from 'js-yaml';
import { globalRegistry } from '../models/TrackerDataModel';
import { parseDate, formatLocalDateOnly } from '../models/dateUtils';

/**
 * Format an automation schedule object into a human-readable string.
 * Handles interval, daily, and weekly schedule types.
 */
function formatAutomationSchedule(schedule: any): string {
  if (!schedule || typeof schedule !== 'object') return schedule ?? '';
  switch (schedule.type) {
    case 'interval':
      return `Every ${schedule.intervalMinutes} min`;
    case 'daily':
      return `Daily at ${schedule.time ?? ''}`;
    case 'weekly': {
      const days = (schedule.days as string[]) ?? [];
      return `${days.map((d: string) => d.charAt(0).toUpperCase() + d.slice(1)).join(', ')} at ${schedule.time ?? ''}`;
    }
    default:
      return String(schedule.type ?? schedule);
  }
}

export interface TrackerFrontmatter {
  type: string; // Tracker type (plan, decision, bug, etc.)
  data: Record<string, any>; // All tracker field data
}

/**
 * Resolve tracker field data from merged frontmatter using the model's field definitions.
 * Handles date fallback ('date' -> 'publishDate') and parses date values.
 */
function resolveFieldData(type: string, data: Record<string, any>): Record<string, any> {
  const model = globalRegistry.get(type);
  if (!model) return data;

  const resolved = { ...data };
  for (const field of model.fields) {
    // If the field value is missing, check the 'date' key as fallback for date fields
    if (resolved[field.name] === undefined && (field.type === 'date' || field.type === 'datetime')) {
      if (resolved.date !== undefined) {
        resolved[field.name] = resolved.date;
      }
    }
    // Parse date values into proper Date objects
    if ((field.type === 'date' || field.type === 'datetime') && resolved[field.name] !== undefined) {
      const parsed = parseDate(resolved[field.name]);
      if (parsed) {
        resolved[field.name] = parsed;
      }
    }
  }
  return resolved;
}

/**
 * Extract YAML frontmatter from markdown content
 */
export function extractFrontmatter(content: string): Record<string, any> | null {
  const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return null;
  }

  try {
    const yamlContent = match[1];
    const parsed = jsyaml.load(yamlContent) as Record<string, any>;
    return parsed || null;
  } catch (error) {
    console.error('[TrackerPlugin] Failed to parse frontmatter:', error);
    return null;
  }
}

/**
 * Detect tracker type and data from frontmatter
 *
 * Supports multiple frontmatter formats:
 * - planStatus: { ... } -> type: 'plan'
 * - decisionStatus: { ... } -> type: 'decision'
 * - trackerStatus: { type: 'bug', ... } -> type: 'bug'
 */
export function detectTrackerFromFrontmatter(content: string): TrackerFrontmatter | null {
  const frontmatter = extractFrontmatter(content);
  if (!frontmatter) {
    return null;
  }

  // Check for planStatus
  if (frontmatter.planStatus && typeof frontmatter.planStatus === 'object') {
    return {
      type: 'plan',
      data: resolveFieldData('plan', frontmatter.planStatus as Record<string, any>),
    };
  }

  // Check for decisionStatus
  if (frontmatter.decisionStatus && typeof frontmatter.decisionStatus === 'object') {
    return {
      type: 'decision',
      data: resolveFieldData('decision', frontmatter.decisionStatus as Record<string, any>),
    };
  }

  // Check for automationStatus
  if (frontmatter.automationStatus && typeof frontmatter.automationStatus === 'object') {
    const auto = frontmatter.automationStatus as Record<string, any>;
    const status = auto.enabled
      ? (auto.lastRunStatus === 'error' ? 'failing' : 'active')
      : (auto.runCount > 0 ? 'paused' : 'new');
    return {
      type: 'automation',
      data: resolveFieldData('automation', {
        title: auto.title,
        status,
        schedule: formatAutomationSchedule(auto.schedule),
        lastRun: auto.lastRun,
        runCount: auto.runCount ?? 0,
      }),
    };
  }

  // Check for generic trackerStatus with type field
  if (frontmatter.trackerStatus && typeof frontmatter.trackerStatus === 'object') {
    const trackerData = frontmatter.trackerStatus as Record<string, any>;
    if (trackerData.type) {
      // Top-level fields are canonical. Embedded trackerStatus fields are backward-compat fallback.
      const { trackerStatus: _, ...topLevelFields } = frontmatter;
      const merged = { ...trackerData, ...topLevelFields };
      return {
        type: trackerData.type as string,
        data: resolveFieldData(trackerData.type as string, merged),
      };
    }
  }

  return null;
}

/**
 * Update frontmatter in markdown content
 */
export function updateFrontmatter(
  content: string,
  updates: Record<string, any>
): string {
  const frontmatter = extractFrontmatter(content) || {};
  const updated = { ...frontmatter, ...updates };

  const yamlContent = jsyaml.dump(updated, {
    indent: 2,
    lineWidth: -1, // Don't wrap lines
    noRefs: true,
  });

  const frontmatterRegex = /^---\n[\s\S]*?\n---\n?/;
  const hasFrontmatter = frontmatterRegex.test(content);

  if (hasFrontmatter) {
    // Replace existing frontmatter
    return content.replace(frontmatterRegex, `---\n${yamlContent}---\n`);
  } else {
    // Add frontmatter at the beginning
    return `---\n${yamlContent}---\n${content}`;
  }
}

/**
 * Update specific tracker data in frontmatter
 */
export function updateTrackerInFrontmatter(
  content: string,
  trackerType: string,
  updates: Record<string, any>
): string {
  const frontmatter = extractFrontmatter(content) || {};

  // Determine the frontmatter key based on tracker type
  let frontmatterKey = 'trackerStatus';
  if (trackerType === 'plan') {
    frontmatterKey = 'planStatus';
  } else if (trackerType === 'decision') {
    frontmatterKey = 'decisionStatus';
  } else if (trackerType === 'automation') {
    frontmatterKey = 'automationStatus';
  }

  const existingData = (frontmatter[frontmatterKey] || {}) as Record<string, any>;

  // For generic trackerStatus, fields that already exist at the top level of the
  // frontmatter should be written back there (not inside trackerStatus). This keeps
  // them in sync with tools like Astro that read top-level frontmatter.
  const topLevelUpdates: Record<string, any> = {};
  const trackerUpdates: Record<string, any> = {};

  if (frontmatterKey === 'trackerStatus') {
    // trackerStatus only holds `type`. All other fields go at the top level.
    // This keeps frontmatter compatible with external tools (Astro, Hugo, etc.)
    // and eliminates sync issues between embedded and top-level fields.
    for (const [key, value] of Object.entries(updates)) {
      if (key === 'type') {
        trackerUpdates[key] = value;
      } else {
        topLevelUpdates[key] = value;
      }
    }
  } else {
    // For plan/decision, all updates go into the status block (legacy behavior)
    Object.assign(trackerUpdates, updates);
  }

  // Preserve existing trackerStatus but strip out any fields that are now top-level
  const cleanedTrackerData: Record<string, any> = { type: existingData.type || trackerUpdates.type };
  if (trackerUpdates.type) cleanedTrackerData.type = trackerUpdates.type;

  const now = formatLocalDateOnly(new Date());

  if (frontmatterKey === 'trackerStatus') {
    // Set updated at top level; set created if not already present
    if (!frontmatter.created && !topLevelUpdates.created) {
      topLevelUpdates.created = now;
    }
    topLevelUpdates.updated = now;

    return updateFrontmatter(content, {
      ...topLevelUpdates,
      [frontmatterKey]: cleanedTrackerData,
    });
  } else {
    // plan/decision: timestamps live inside the status block
    const mergedData: Record<string, any> = {
      ...existingData,
      ...trackerUpdates,
      updated: now,
    };
    if (!existingData.created && !trackerUpdates.created) {
      mergedData.created = now;
      // Also reset updated — it predates created and would cause an inverted display
      mergedData.updated = now;
    }

    return updateFrontmatter(content, {
      ...topLevelUpdates,
      [frontmatterKey]: mergedData,
    });
  }
}

/**
 * Update an inline tracker item in file content.
 * Finds a line matching `... #type[id:ITEM_ID ...]` and rewrites the metadata fields.
 * Returns the updated content, or null if the item was not found.
 */
export function updateInlineTrackerItem(
  content: string,
  itemId: string,
  updates: Record<string, any>
): string | null {
  const lines = content.split('\n');
  let found = false;

  // Match lines like: Some title #bug[id:bug_abc123 status:to-do priority:high]
  const inlineRegex = new RegExp(
    `^(.+?)\\s+#([a-z][\\w-]*)\\[(.+?)\\](.*)$`
  );

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(inlineRegex);
    if (!match) continue;

    const [, textContent, type, propsStr, trailing] = match;

    // Parse existing props to check if this is the right item
    const props = parseInlineProps(propsStr);
    if (props.id !== itemId) continue;

    // Apply updates
    for (const [key, value] of Object.entries(updates)) {
      if (key === 'title') {
        // Title is the text before #type[...], handled separately below
        continue;
      }
      if (value === null || value === undefined) {
        // Remove the prop when set to null/undefined
        delete props[key];
      } else {
        props[key] = value;
      }
    }

    // Update the 'updated' timestamp
    props.updated = new Date().toISOString().split('T')[0];

    // Rebuild the props string
    const newPropsStr = serializeInlineProps(props);

    // Rebuild the line (use updated title if provided)
    const title = updates.title ?? textContent.trim();
    lines[i] = `${title} #${type}[${newPropsStr}]${trailing}`;
    found = true;
    break;
  }

  return found ? lines.join('\n') : null;
}

/**
 * Remove an inline tracker item line from file content.
 * Returns updated content with the matching line removed, or null if not found.
 */
export function removeInlineTrackerItem(content: string, itemId: string): string | null {
  const lines = content.split('\n');
  const inlineRegex = /^(.+?)\s+#([a-z][\w-]*)\[(.+?)\](.*)$/;

  const nextLines = lines.filter(line => {
    const match = line.match(inlineRegex);
    if (!match) return true;
    const props = parseInlineProps(match[3]);
    return props.id !== itemId;
  });

  if (nextLines.length === lines.length) return null; // not found
  return nextLines.join('\n');
}

/** Parse key:value pairs from inline tracker metadata string */
function parseInlineProps(propsStr: string): Record<string, string> {
  const props: Record<string, string> = {};
  const propRegex = /(\w+):((?:"[^"]*")|(?:[^\s]+))/g;
  let match;
  while ((match = propRegex.exec(propsStr)) !== null) {
    const [, key, value] = match;
    props[key] = value.startsWith('"') ? value.slice(1, -1).replace(/\\"/g, '"') : value;
  }
  return props;
}

/** Serialize props back to inline format: id:X status:Y priority:Z */
function serializeInlineProps(props: Record<string, string>): string {
  // Maintain a consistent field order
  const order = ['id', 'status', 'priority', 'owner', 'created', 'updated', 'tags', 'archived'];
  const parts: string[] = [];

  for (const key of order) {
    if (props[key] !== undefined) {
      const value = props[key];
      // Quote values that contain spaces
      parts.push(value.includes(' ') ? `${key}:"${value}"` : `${key}:${value}`);
    }
  }

  // Append any extra fields not in the standard order
  for (const [key, value] of Object.entries(props)) {
    if (!order.includes(key)) {
      parts.push(value.includes(' ') ? `${key}:"${value}"` : `${key}:${value}`);
    }
  }

  return parts.join(' ');
}
