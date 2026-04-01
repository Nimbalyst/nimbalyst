/**
 * Model loader for built-in and custom tracker definitions
 */

import { parseTrackerYAML } from './YAMLParser';
import { globalRegistry, type TrackerDataModel } from './TrackerDataModel';

// Temporarily hardcode built-in tracker definitions until YAML bundling is resolved
const builtinTrackers: TrackerDataModel[] = [
  {
    type: 'plan',
    displayName: 'Plan',
    displayNamePlural: 'Plans',
    icon: 'flag',
    color: '#3b82f6',
    modes: { inline: true, fullDocument: true },
    sync: { mode: 'hybrid', scope: 'project' },
    idPrefix: 'pln',
    idFormat: 'ulid',
    fields: [
      { name: 'planId', type: 'string', required: true, displayInline: false },
      { name: 'title', type: 'string', required: true, displayInline: true },
      {
        name: 'status',
        type: 'select',
        required: true,
        default: 'draft',
        options: [
          { value: 'draft', label: 'Draft', icon: 'edit_note', color: '#64748b' },
          { value: 'ready-for-development', label: 'Ready', icon: 'check_circle', color: '#22c55e' },
          { value: 'in-development', label: 'In Development', icon: 'construction', color: '#f59e0b' },
          { value: 'in-review', label: 'In Review', icon: 'rate_review', color: '#3b82f6' },
          { value: 'completed', label: 'Completed', icon: 'task_alt', color: '#10b981' },
          { value: 'rejected', label: 'Rejected', icon: 'cancel', color: '#ef4444' },
          { value: 'blocked', label: 'Blocked', icon: 'block', color: '#dc2626' },
        ],
      },
      {
        name: 'planType',
        type: 'select',
        required: false,
        default: 'feature',
        options: [
          { value: 'system-design', label: 'System Design' },
          { value: 'feature', label: 'Feature' },
          { value: 'bug-fix', label: 'Bug Fix' },
          { value: 'refactor', label: 'Refactor' },
          { value: 'documentation', label: 'Documentation' },
          { value: 'research', label: 'Research' },
        ],
      },
      {
        name: 'priority',
        type: 'select',
        required: false,
        options: [
          { value: 'low', label: 'Low', icon: 'arrow_downward' },
          { value: 'medium', label: 'Medium', icon: 'remove' },
          { value: 'high', label: 'High', icon: 'arrow_upward' },
          { value: 'critical', label: 'Critical', icon: 'priority_high' },
        ],
      },
      { name: 'progress', type: 'number', min: 0, max: 100, displayInline: false },
      { name: 'owner', type: 'user', displayInline: true },
      { name: 'stakeholders', type: 'array', itemType: 'string', displayInline: false },
      { name: 'tags', type: 'array', itemType: 'string', displayInline: false },
      { name: 'created', type: 'datetime', displayInline: false, readOnly: true },
      { name: 'updated', type: 'datetime', displayInline: false, readOnly: true },
      { name: 'startDate', type: 'date', displayInline: false },
      { name: 'agentSessions', type: 'array', itemType: 'object', displayInline: false },
    ],
    statusBarLayout: [
      {
        row: [
          { field: 'status', width: 200 },
          { field: 'priority', width: 150 },
          { field: 'progress', width: 100 },
        ],
      },
      {
        row: [
          { field: 'owner', width: 200 },
          { field: 'tags', width: 'auto' },
        ],
      },
    ],
    inlineTemplate: '{icon} {title} {status} {priority}',
  },
  {
    type: 'decision',
    displayName: 'Decision',
    displayNamePlural: 'Decisions',
    icon: 'gavel',
    color: '#8b5cf6',
    modes: { inline: true, fullDocument: true },
    sync: { mode: 'shared', scope: 'project' },
    idPrefix: 'dec',
    idFormat: 'ulid',
    fields: [
      { name: 'decisionId', type: 'string', required: true, displayInline: false },
      { name: 'title', type: 'string', required: true, displayInline: true },
      {
        name: 'status',
        type: 'select',
        default: 'to-do',
        options: [
          { value: 'to-do', label: 'To Decide', icon: 'help' },
          { value: 'in-progress', label: 'Evaluating', icon: 'psychology' },
          { value: 'decided', label: 'Decided', icon: 'check_circle' },
          { value: 'implemented', label: 'Implemented', icon: 'done_all' },
        ],
      },
      { name: 'chosen', type: 'string', displayInline: true },
      {
        name: 'priority',
        type: 'select',
        required: false,
        options: [
          { value: 'low', label: 'Low' },
          { value: 'medium', label: 'Medium' },
          { value: 'high', label: 'High' },
          { value: 'critical', label: 'Critical' },
        ],
      },
      { name: 'owner', type: 'user', displayInline: false },
      { name: 'stakeholders', type: 'array', itemType: 'string', displayInline: false },
      { name: 'tags', type: 'array', itemType: 'string', displayInline: false },
      { name: 'created', type: 'datetime', displayInline: false, readOnly: true },
      { name: 'updated', type: 'datetime', displayInline: false, readOnly: true },
    ],
    statusBarLayout: [
      {
        row: [
          { field: 'status', width: 200 },
          { field: 'chosen', width: 300 },
          { field: 'priority', width: 150 },
        ],
      },
    ],
    inlineTemplate: '{icon} {title} {status}',
  },
  {
    type: 'bug',
    displayName: 'Bug',
    displayNamePlural: 'Bugs',
    icon: 'bug_report',
    color: '#dc2626',
    modes: { inline: true, fullDocument: false },
    sync: { mode: 'shared', scope: 'project' },
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
          { value: 'in-review', label: 'In Review', icon: 'rate_review', color: '#3b82f6' },
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
      { name: 'description', type: 'text' },
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
    sync: { mode: 'shared', scope: 'project' },
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
          { value: 'in-review', label: 'In Review', icon: 'rate_review', color: '#3b82f6' },
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
      { name: 'description', type: 'text' },
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
    sync: { mode: 'local', scope: 'project' },
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
  {
    type: 'feature',
    displayName: 'Feature',
    displayNamePlural: 'Features',
    icon: 'rocket_launch',
    color: '#10b981',
    modes: { inline: true, fullDocument: false },
    sync: { mode: 'shared', scope: 'project' },
    idPrefix: 'feat',
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
          { value: 'in-review', label: 'In Review', icon: 'rate_review', color: '#3b82f6' },
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
      { name: 'description', type: 'text' },
      { name: 'releaseVersion', type: 'string', displayInline: true },
      { name: 'releaseNotes', type: 'text' },
    ],
    inlineTemplate: '{icon} {title} {status} {releaseVersion}',
  },
  {
    type: 'automation',
    displayName: 'Automation',
    displayNamePlural: 'Automations',
    icon: 'auto_mode',
    color: '#60a5fa',
    creatable: false,
    modes: { inline: false, fullDocument: true },
    sync: { mode: 'local', scope: 'project' },
    idPrefix: 'aut',
    idFormat: 'ulid',
    fields: [
      { name: 'title', type: 'string', required: true, displayInline: true },
      {
        name: 'status',
        type: 'select',
        default: 'new',
        options: [
          { value: 'active', label: 'Active', icon: 'play_circle', color: '#22c55e' },
          { value: 'failing', label: 'Failing', icon: 'error', color: '#ef4444' },
          { value: 'paused', label: 'Paused', icon: 'pause_circle', color: '#64748b' },
          { value: 'new', label: 'New', icon: 'fiber_new', color: '#3b82f6' },
        ],
      },
      { name: 'schedule', type: 'string', displayInline: true, readOnly: true },
      { name: 'lastRun', type: 'datetime', displayInline: true, readOnly: true },
      { name: 'runCount', type: 'number', displayInline: true, readOnly: true },
      { name: 'tags', type: 'array', itemType: 'string', displayInline: false },
      { name: 'created', type: 'datetime', displayInline: false, readOnly: true },
      { name: 'updated', type: 'datetime', displayInline: false, readOnly: true },
    ],
    statusBarLayout: [
      {
        row: [
          { field: 'status', width: 150 },
          { field: 'schedule', width: 150 },
          { field: 'lastRun', width: 200 },
          { field: 'runCount', width: 80 },
        ],
      },
    ],
  },
];

/**
 * Load all built-in tracker definitions
 */
export function loadBuiltinTrackers(): void {
  // console.log('[TrackerPlugin] Loading built-in trackers...');

  for (const model of builtinTrackers) {
    try {
      globalRegistry.register(model);
      // console.log(`[TrackerPlugin] Loaded built-in tracker: ${model.type}`);
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

/**
 * ModelLoader singleton for accessing tracker models
 */
export class ModelLoader {
  private static instance: ModelLoader;

  private constructor() {
    // Initialize built-in trackers on construction
    loadBuiltinTrackers();
  }

  static getInstance(): ModelLoader {
    if (!ModelLoader.instance) {
      ModelLoader.instance = new ModelLoader();
    }
    return ModelLoader.instance;
  }

  async getModel(type: string): Promise<TrackerDataModel> {
    const model = globalRegistry.get(type);
    if (!model) {
      throw new Error(`Tracker model not found for type: ${type}`);
    }
    return model;
  }

  getAllModels(): TrackerDataModel[] {
    return globalRegistry.getAll();
  }
}
