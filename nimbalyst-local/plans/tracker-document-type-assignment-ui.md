---
planStatus:
  planId: plan-tracker-document-type-assignment-ui
  title: Tracker Document Type Assignment UI
  status: in-development
  planType: feature
  priority: high
  owner: developer
  stakeholders:
    - developer
    - users
  tags:
    - tracker
    - ui
    - frontmatter
    - document-actions
  created: "2025-11-15"
  updated: "2025-11-15T13:45:00.000Z"
  progress: 60
  startDate: "2025-11-15"
---

## Implementation Progress

- [x] Create TrackerTypeRegistry service with built-in tracker type definitions
- [x] Create FrontmatterService for parsing and merging frontmatter
- [x] Create types.ts for tracker type interfaces
- [x] Expose tracker type methods in TrackerPlugin
- [x] Add "Set Document Type" menu item to FloatingDocumentActionsPlugin
- [x] Implement submenu showing available tracker types
- [x] Show checkmark for currently assigned tracker type
- [x] Handle tracker type selection and frontmatter updates
- [x] Add styles for submenu
- [ ] Test assigning tracker type to document without frontmatter
- [ ] Test changing tracker type on existing tracked document
- [ ] Test removing tracker type assignment
- [ ] Test frontmatter preservation during type changes
- [ ] Verify auto-save triggers after type assignment
- [ ] Verify tracker table updates immediately

# Tracker Document Type Assignment UI

<!-- Status: in-development | Progress: 60% -->

## Goals

- Enable users to manually assign tracker types to documents through the UI
- Support both built-in tracker types (bugs, tasks, ideas) and user-defined custom trackers
- Provide an intuitive interface in the floating document actions menu
- Automatically add/update appropriate frontmatter when a tracker type is assigned
- Allow users to remove tracker type assignments

## Problem Statement

Currently, the tracker plugin can only detect documents that already have tracker-specific frontmatter. There's no UI mechanism for users to:
- Mark a document as a specific tracker type (e.g., "blog", "bug", "task")
- Add the required frontmatter fields for a tracker type
- Discover what tracker types are available
- Convert a regular document into a tracked item

Users must manually edit frontmatter YAML, which is error-prone and requires knowledge of the exact field names and structure for each tracker type.

## Proposed Solution

Extend the floating document actions menu (the three-dot menu that appears when editing a document) with a "Set Document Type" submenu that:

1. Lists all available tracker types (built-in + custom)
2. Shows the currently assigned type (if any)
3. Allows selecting a tracker type to assign
4. Allows removing the tracker type assignment

When a user selects a tracker type:
- The appropriate frontmatter fields are added to the document
- Default values are set for required fields
- The document is saved
- The tracker table updates to include the document

## System Components

### UI Components to Modify

- **FloatingDocumentActionsPlugin** (`packages/rexical/src/plugins/FloatingDocumentActionsPlugin/index.tsx`)
  - Add "Set Document Type" menu item with submenu
  - Display current tracker type if assigned
  - Handle tracker type selection

### Frontmatter Management

- **TrackerPlugin** (`packages/electron/src/renderer/plugins/TrackerPlugin/TrackerPlugin.tsx`)
  - Expose method to get available tracker types (built-in + custom)
  - Expose method to get default frontmatter template for each type
  - Expose method to apply tracker type to a document

- **Frontmatter Service** (to be created or extended)
  - Parse existing frontmatter
  - Merge new tracker fields with existing frontmatter
  - Preserve user's existing frontmatter fields
  - Format frontmatter YAML correctly

### Tracker Type Registry

- **TrackerTypeRegistry** (new service)
  - Register built-in tracker types with their schemas
  - Register user-defined custom tracker types
  - Provide templates for default frontmatter values
  - Validate tracker type definitions

## Key User Flows

### Assigning a Tracker Type

1. User opens a document
2. User clicks floating document actions menu (three dots)
3. User hovers over "Set Document Type" menu item
4. Submenu shows available tracker types: "Bug", "Task", "Idea", "Blog", "Remove Type"
5. User selects "Blog"
6. System adds blog tracker frontmatter to document
7. Document auto-saves
8. Tracker table updates to show the new blog entry

### Changing a Tracker Type

1. User opens a document that is already a "Bug"
2. User clicks floating document actions menu
3. User hovers over "Set Document Type" (shows checkmark next to "Bug")
4. User selects "Task"
5. System removes bug-specific fields, adds task-specific fields
6. Document auto-saves
7. Tracker tables update

### Removing a Tracker Type

1. User opens a tracked document
2. User clicks floating document actions menu
3. User hovers over "Set Document Type"
4. User selects "Remove Type"
5. System removes tracker-specific frontmatter fields
6. Document auto-saves
7. Document disappears from tracker tables

## Frontmatter Templates

Each tracker type needs a default frontmatter template. Examples:

### Bug Tracker
- status: "open"
- priority: "medium"
- assignee: ""
- labels: []

### Task Tracker
- status: "todo"
- priority: "medium"
- dueDate: ""
- assignee: ""

### Blog Tracker (Custom Example)
- status: "draft"
- publishDate: ""
- author: ""
- tags: []
- category: ""

## Technical Considerations

### Frontmatter Preservation
- Must not remove existing frontmatter fields unrelated to tracker
- Must merge tracker fields with existing frontmatter
- Must handle YAML formatting edge cases

### Auto-save Integration
- Document should auto-save after tracker type assignment
- User should see immediate feedback in tracker tables

### Custom Tracker Configuration
- Users need ability to define custom tracker types in settings
- Custom trackers need schema definition (field names, types, defaults)
- UI should dynamically reflect available custom trackers

### Performance
- Tracker type list should be cached
- Frontmatter updates should be efficient
- Tracker table should update reactively

## Files to Modify/Create

### Existing Files to Modify
- `packages/rexical/src/plugins/FloatingDocumentActionsPlugin/index.tsx`
- `packages/rexical/src/plugins/FloatingDocumentActionsPlugin/styles.css`
- `packages/electron/src/renderer/plugins/TrackerPlugin/TrackerPlugin.tsx`

### New Files to Create
- `packages/electron/src/renderer/plugins/TrackerPlugin/TrackerTypeRegistry.ts`
- `packages/electron/src/renderer/plugins/TrackerPlugin/FrontmatterService.ts`
- `packages/electron/src/renderer/plugins/TrackerPlugin/types.ts` (if not exists)

## Acceptance Criteria

- [ ] User can see "Set Document Type" option in floating document actions menu
- [ ] Submenu shows all built-in tracker types (bugs, tasks, ideas)
- [ ] Currently assigned tracker type is visually indicated (checkmark)
- [ ] Selecting a tracker type adds appropriate frontmatter to document
- [ ] Document auto-saves after tracker type assignment
- [ ] Tracker table updates immediately to include/exclude document
- [ ] User can remove tracker type assignment
- [ ] Existing frontmatter fields are preserved when assigning tracker type
- [ ] System handles edge cases: empty frontmatter, malformed frontmatter, etc.
- [ ] Custom tracker types (when configured) appear in the submenu

## Future Enhancements

- Visual tracker type badge in document header
- Bulk assignment of tracker types to multiple documents
- Tracker type templates with pre-filled content
- Validation of required fields before saving
- Custom field configuration UI for tracker types
