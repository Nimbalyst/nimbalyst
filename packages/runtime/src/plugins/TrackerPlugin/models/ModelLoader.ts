/**
 * Model loader for built-in and custom tracker definitions
 */

import { parseTrackerYAML } from './YAMLParser';
import { globalRegistry, type TrackerDataModel } from './TrackerDataModel';

// Temporarily hardcode built-in tracker definitions until YAML bundling is resolved
const builtinTrackers: TrackerDataModel[] = [
  {
    type: 'bug',
    displayName: 'Bug',
    displayNamePlural: 'Bugs',
    icon: 'bug_report',
    color: '#dc2626',
    modes: { inline: true, fullDocument: false },
    idPrefix: 'bug',
    idFormat: 'ulid',
    fields: [
      { name: 'title', type: 'string', required: true },
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
    ],
    inlineTemplate: '{icon} {title} {status} {priority}',
  },
  {
    type: 'task',
    displayName: 'Task',
    displayNamePlural: 'Tasks',
    icon: 'task_alt',
    color: '#2563eb',
    modes: { inline: true, fullDocument: false },
    idPrefix: 'tsk',
    idFormat: 'ulid',
    fields: [
      { name: 'title', type: 'string', required: true },
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
      { name: 'owner', type: 'string' },
      { name: 'dueDate', type: 'date' },
    ],
    inlineTemplate: '{icon} {title} {status} {owner}',
  },
  {
    type: 'idea',
    displayName: 'Idea',
    displayNamePlural: 'Ideas',
    icon: 'lightbulb',
    color: '#ca8a04',
    modes: { inline: true, fullDocument: false },
    idPrefix: 'id',
    idFormat: 'ulid',
    fields: [
      { name: 'title', type: 'string', required: true },
      {
        name: 'status',
        type: 'select',
        default: 'new',
        options: [
          { value: 'new', label: 'New', icon: 'fiber_new' },
          { value: 'considering', label: 'Considering', icon: 'psychology' },
          { value: 'accepted', label: 'Accepted', icon: 'thumb_up' },
          { value: 'rejected', label: 'Rejected', icon: 'thumb_down' },
        ],
      },
    ],
    inlineTemplate: '{icon} {title} {status}',
  },
];

/**
 * Load all built-in tracker definitions
 */
export function loadBuiltinTrackers(): void {
  console.log('[TrackerPlugin] Loading built-in trackers...');

  for (const model of builtinTrackers) {
    try {
      globalRegistry.register(model);
      console.log(`[TrackerPlugin] Loaded built-in tracker: ${model.type}`);
    } catch (error) {
      console.error(`[TrackerPlugin] Failed to load built-in tracker '${model.type}':`, error);
    }
  }

  console.log(`[TrackerPlugin] Loaded ${globalRegistry.getAll().length} built-in trackers`);
}

/**
 * Load a custom tracker definition from YAML string
 */
export function loadCustomTracker(yamlString: string): void {
  const model = parseTrackerYAML(yamlString);
  globalRegistry.register(model);
  console.log(`[TrackerPlugin] Loaded custom tracker: ${model.type}`);
}

/**
 * Load custom trackers from a directory (for workspace-specific trackers)
 * This would be called by the Electron main process and passed to the renderer
 */
export async function loadCustomTrackersFromDirectory(
  directoryPath: string,
  fs: any // File system interface
): Promise<void> {
  // This function would be implemented in the Electron layer
  // to read YAML files from .nimbalyst/trackers/ directory
  console.log(`[TrackerPlugin] Loading custom trackers from: ${directoryPath}`);
}
