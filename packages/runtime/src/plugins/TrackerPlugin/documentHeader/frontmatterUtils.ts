/**
 * Utilities for detecting and parsing tracker frontmatter
 */

import jsyaml from 'js-yaml';
import { globalRegistry } from '../models/TrackerDataModel';
import { parseDate } from '../models/dateUtils';

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

  // Check for generic trackerStatus with type field
  if (frontmatter.trackerStatus && typeof frontmatter.trackerStatus === 'object') {
    const trackerData = frontmatter.trackerStatus as Record<string, any>;
    if (trackerData.type) {
      // Merge top-level frontmatter fields (author, date, tags, etc.) as defaults,
      // with trackerStatus fields taking precedence
      const { trackerStatus: _, ...topLevelFields } = frontmatter;
      const merged = { ...topLevelFields, ...trackerData };
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
  }

  const existingData = (frontmatter[frontmatterKey] || {}) as Record<string, any>;
  const updatedData = {
    ...existingData,
    ...updates,
    updated: new Date().toISOString(), // Auto-update timestamp
  };

  return updateFrontmatter(content, {
    [frontmatterKey]: updatedData,
  });
}
