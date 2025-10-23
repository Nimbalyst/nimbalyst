---
planStatus:
  planId: plan-unified-tracker-refactor
  title: Unified Tracker System Refactor
  status: in-development
  planType: refactor
  priority: high
  owner: ghinkle
  stakeholders:
    - development-team
  tags:
    - architecture
    - refactor
    - tracker-system
    - data-model
  created: "2025-10-17"
  updated: "2025-10-23T20:49:08.586Z"
  progress: 52
---
# Unified Tracker System Refactor
<!-- plan-status -->



- testtest3asdfas #bug[id:bug_mh3pkcl40nyisjsx status:done priority:medium created:2025-10-23 updated:2025-10-23T18:36:09.686Z]
- shit #bug[id:bug_mh3szl93gemf3hkp status:to-do priority:medium created:2025-10-23]

## TODO
- Tracker items are always in lists and if you tag a bug outside of a list, it makes a list

## Task Progress

- [x] Phase 1: Create data model system (YAML parser, validation, loading)
- [x] Phase 2: Migrate database schema to JSONB storage
- [x] Phase 3: Update TrackerItemNode to use # syntax instead of @
- [x] Phase 4: Create StatusBar component for full document tracking
- [x] Phase 4.5: Implement DocumentHeaderContainer and register tracker header provider
- [ ] Phase 5: Update TrackerBottomPanel to be data-model driven
- [ ] Phase 6: Add reference system (#type[ref:id] syntax)
- [ ] Phase 7: Implement copy/paste with reference vs duplicate modes
- [ ] Phase 8: Create onboarding tracker selection screen
- [ ] Phase 9: Generate AI slash commands from tracker definitions
- [ ] Phase 10: Remove old PlanStatusPlugin, DecisionStatusPlugin

**Progress: 4.5/10 phases complete (45%)**

## Goals

Unify all tracking functionality (Plans, Decisions, ItemTracker) into a single, extensible tracker system with:
- User-configurable data models
- Consistent inline and full-document tracking
- Flexible UI components driven by data model configuration
- Improved storage with JSONB in PGLite
- Better user experience with hash syntax and typeahead

## Implementation Progress (45% Complete)

### Phase 1: Data Model System ✓ COMPLETED
**Files**: `packages/runtime/src/plugins/TrackerPlugin/models/`
- Created `TrackerDataModel.ts` with core types and validation registry
- Implemented `IDGenerator.ts` with ULID generation and type prefixes
- Built `YAMLParser.ts` for parsing tracker definitions
- Created `ModelLoader.ts` for loading built-in and custom trackers
- Added all 5 built-in tracker definitions as YAML files

### Phase 2: Database Schema Migration ✓ COMPLETED
**Files**: `packages/electron/src/main/database/worker.js`
- Migrated `tracker_items` table to JSONB structure
- Added migration script to convert existing data
- Created generated columns for commonly queried fields
- Added GIN index on JSONB for full-text search

### Phase 3: Syntax Change @ to # ✓ COMPLETED
**Files**: `packages/runtime/src/plugins/ItemTrackerPlugin/`
- Updated `TrackerItemNode` rendering to use #
- Changed typeahead trigger from @ to #
- Updated `TrackerItemTransformer` to parse # syntax

### Phase 4: StatusBar Component ✓ COMPLETED
**Files**: `packages/runtime/src/plugins/TrackerPlugin/components/`
- Created `StatusBar.tsx` for full-document tracking
- Implemented field rendering based on data model
- Added support for custom layouts from statusBarLayout
- Styled with `StatusBar.css`

### Phase 4.5: Document Header Integration ✓ COMPLETED
**Files**: `packages/runtime/src/plugins/TrackerPlugin/documentHeader/`, `packages/electron/src/renderer/plugins/registerTrackerPlugin.ts`
- Created `DocumentHeaderRegistry` system for extensible document headers
- Implemented `DocumentHeaderContainer` to render headers in editor scroll pane
- Built `TrackerDocumentHeader` component with frontmatter detection
- Added `CustomSelect` component with icon support for dropdowns
- Registered tracker header provider on app initialization
- Updated plan tracker: added Review status, shortened labels
- Positioned header inside editor-scroller for proper scrolling
- Fixed z-index layering for floating toolbar visibility
- Added e2e test for plan status header rendering

### Next: Phase 5 - Update TrackerBottomPanel
Make TrackerBottomPanel data-model driven with dynamic columns

## Current State Analysis

### Existing Systems
1. **PlanStatusPlugin** - Full document tracking for plans via custom Lexical node
2. **DecisionStatusPlugin** - Full document tracking for decisions via custom Lexical node
3. **ItemTrackerPlugin** - Inline tracking for bugs/tasks/ideas using @ syntax
4. **PlansPanel** - Left nav panel showing all plans
5. **Separate storage** - Different schemas for different types

### Problems with Current Approach
- Code duplication across three separate plugins
- Inconsistent UX (@ vs frontmatter, inline vs full-doc)
- Hard-coded types (can't add custom tracker types without code changes)
- Custom Lexical nodes pollute document structure
- No unified view across all tracked items
- Storage schema requires migration for each new type
- No way to promote inline items to full documents
- No way to reference full documents from inline items

## Architecture Overview

### Single Plugin Architecture
**Location**: `packages/runtime/src/plugins/TrackerPlugin/`

All tracker functionality consolidated into one plugin with modular components:
- Data model management
- Inline item rendering and typeahead
- Full document status bar (replaces custom nodes)
- Table views with filtering/sorting
- Storage layer (JSONB-based)

### Data Model System

#### Model Definition Files
**Location**: `.nimbalyst/trackers/`

Each tracker type defined in a YAML file:

```yaml
# .nimbalyst/trackers/plan.yaml
type: plan
displayName: Plan
displayNamePlural: Plans
icon: flag  # Material Symbols icon name
color: "#3b82f6"  # Primary color for this type

# Modes this tracker supports
modes:
  inline: true
  fullDocument: true


# ID generation
idPrefix: pln  # Short prefix (plan -> pln)
idFormat: ulid  # ulid | uuid | sequential

# Fields definition
fields:
  - name: title
    type: string
    required: true
    displayInline: true

  - name: status
    type: select
    required: true
    default: draft
    options:
      - value: draft
        label: Draft
        icon: edit_note
        color: "#64748b"
      - value: ready-for-development
        label: Ready
        icon: check_circle
        color: "#22c55e"
      - value: in-development
        label: In Progress
        icon: construction
        color: "#f59e0b"
      - value: completed
        label: Completed
        icon: task_alt
        color: "#10b981"
      - value: rejected
        label: Rejected
        icon: cancel
        color: "#ef4444"
      - value: blocked
        label: Blocked
        icon: block
        color: "#dc2626"

  - name: priority
    type: select
    required: false
    options:
      - value: low
        label: Low
        icon: arrow_downward
      - value: medium
        label: Medium
        icon: remove
      - value: high
        label: High
        icon: arrow_upward
      - value: critical
        label: Critical
        icon: priority_high

  - name: progress
    type: number
    min: 0
    max: 100
    displayInline: false

  - name: owner
    type: string
    displayInline: true

  - name: tags
    type: array
    itemType: string
    displayInline: false

  - name: dueDate
    type: date
    displayInline: true

# Layout configuration for full document status bar
statusBarLayout:
  - row:
    - field: status
      width: 200
    - field: priority
      width: 150
    - field: progress
      width: 100
  - row:
    - field: owner
      width: 200
    - field: dueDate
      width: 150
    - field: tags
      width: auto

# Inline display template
inlineTemplate: "{icon} {title} {status} {priority} {owner}"

# Table view configuration
tableView:
  defaultColumns:
    - title
    - status
    - priority
    - owner
    - updated
  sortable: true
  filterable: true
  exportable: true
```

Example for simpler types:

```yaml
# .nimbalyst/trackers/bug.yaml
type: bug
displayName: Bug
displayNamePlural: Bugs
icon: bug_report
color: "#dc2626"

modes:
  inline: true
  fullDocument: false  # Bugs are inline-only


idPrefix: bug

fields:
  - name: title
    type: string
    required: true

  - name: status
    type: select
    default: to-do
    options:
      - value: to-do
        label: To Do
        icon: circle
      - value: in-progress
        label: In Progress
        icon: motion_photos_on
      - value: done
        label: Done
        icon: check_circle

  - name: priority
    type: select
    options:
      - value: low
        label: Low
      - value: medium
        label: Medium
      - value: high
        label: High
      - value: critical
        label: Critical

inlineTemplate: "{icon} {title} {status} {priority}"
```

```yaml
# .nimbalyst/trackers/decision.yaml
type: decision
displayName: Decision
displayNamePlural: Decisions
icon: gavel
color: "#8b5cf6"

modes:
  inline: true
  fullDocument: true


idPrefix: dec

fields:
  - name: title
    type: string
    required: true

  - name: status
    type: select
    default: to-do
    options:
      - value: to-do
        label: To Decide
        icon: help
      - value: in-progress
        label: Evaluating
        icon: psychology
      - value: decided
        label: Decided
        icon: check_circle
      - value: implemented
        label: Implemented
        icon: done_all

  - name: chosen
    type: string
    displayInline: true

  - name: options
    type: array
    itemType: object
    schema:
      - name: name
        type: string
      - name: pros
        type: array
        itemType: string
      - name: cons
        type: array
        itemType: string

statusBarLayout:
  - row:
    - field: status
      width: 200
    - field: chosen
      width: 300
```

#### Built-in Data Models

Out-of-the-box trackers (installed during onboarding):
1. **plan** - Feature plans and design docs
2. **decision** - Architecture and design decisions
3. **bug** - Bug reports and issues
4. **task** - Action items and todos
5. **idea** - Feature ideas and brainstorming

Users can enable/disable these during onboarding and at any time in settings.

#### Custom Data Models

Users can create custom tracker types by:
1. Adding new YAML files to `.nimbalyst/trackers/`
2. Using a UI wizard in settings (generates YAML)
3. Copying and modifying existing tracker definitions

### ID Generation System

#### Short ULID Format
- Base32 encoded ULID (26 characters)
- Prefixed with type abbreviation
- Total length: ~30 characters
- Example: `pln_01HQXYZ7890ABCDEF12345`

#### Type Prefix Rules
- Remove vowels from type name (keep first character)
- Max 4 characters
- Examples:
  - plan → `pln`
  - decision → `dcsn` or `dec`
  - bug → `bug`
  - task → `tsk`
  - idea → `ida`
  - custom-tracker → `cstm`

#### ID Generation Logic
```typescript
function generateTrackerId(type: string): string {
  const prefix = generatePrefix(type);
  const ulid = generateULID();
  return `${prefix}_${ulid}`;
}

function generatePrefix(type: string): string {
  // Remove vowels, keep first char, max 4 chars
  const vowels = 'aeiouAEIOU';
  let prefix = type[0];

  for (let i = 1; i < type.length && prefix.length < 4; i++) {
    if (!vowels.includes(type[i]) && type[i] !== '-') {
      prefix += type[i];
    }
  }

  return prefix.toLowerCase();
}
```

### Syntax Change: @ to #

#### Inline Syntax
**Current**: `Fix the bug @bug[id:bug_123 status:to-do]`
**New**: `Fix the bug````````````````````````````````````````````````````````````````#bug````````````````````````````````````````````````````````````````[id:bug_123 status:to-do]`

**Rationale**:
- Hash is more familiar (hashtags, anchors, references)
- Visually distinct from mentions
- Easier to type (no shift key needed)
- Better semantic meaning (categorization/reference)

#### Typeahead Behavior
- Typing `#` triggers tracker typeahead
- Shows available tracker types with icons
- After selecting type, shows field autocomplete
- Smart defaults based on data model

Example flow:
```javascript
Type: #
Shows: [#plan] [#bug] [#task] [#decision] [#idea]

Type: #bug
Creates: #bug[id:bug_01HQX... status:to-do]
Shows fields autocomplete for title, priority, etc.

Type: #bug Fix t
Autocompletes to: #bug[id:bug_01HQX... title:"Fix the" status:to-do]
```

### Storage Schema Refactor

#### New JSONB Schema
```sql
CREATE TABLE tracker_items (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  data JSONB NOT NULL,
  workspace TEXT NOT NULL,
  document_path TEXT,  -- NULL for inline items
  line_number INTEGER, -- NULL for full-doc items
  created TIMESTAMP DEFAULT NOW(),
  updated TIMESTAMP DEFAULT NOW(),
  last_indexed TIMESTAMP DEFAULT NOW(),

  -- Extracted commonly queried fields for performance
  title TEXT GENERATED ALWAYS AS (data->>'title') STORED,
  status TEXT GENERATED ALWAYS AS (data->>'status') STORED,

  -- Indexes
  INDEX idx_type (type),
  INDEX idx_workspace (workspace),
  INDEX idx_status (status),
  INDEX idx_created (created),
  INDEX idx_updated (updated),

  -- Full-text search on JSONB
  INDEX idx_data_gin (data) USING GIN
);
```

#### Migration Strategy
1. Create new table with JSONB schema
2. Migrate existing data from old schemas
3. Keep old tables temporarily for rollback
4. Remove old tables after verification

### UI Components

#### 1. Full Document Status Bar
**Location**: Tab top gutter (above editor, but in it's scroll pane)
**Replaces**: Custom PlanStatusNode and DecisionStatusNode

Layout driven by `statusBarLayout` in data model:
- Renders fields in configured rows/columns
- Auto-saves on change
- Collapsible/expandable
- Shows/hides based on document frontmatter presence

```tsx
// Example rendering
<StatusBar tracker={planTracker} data={frontmatterData}>
  <StatusRow>
    <StatusField field="status" width={200} />
    <StatusField field="priority" width={150} />
    <StatusField field="progress" width={100} />
  </StatusRow>
  <StatusRow>
    <StatusField field="owner" width={200} />
    <StatusField field="dueDate" width={150} />
    <StatusField field="tags" width="auto" />
  </StatusRow>
</StatusBar>
```

#### 2. Inline Tracker Items
**Rendering**: Custom Lexical node using hash syntax
**Features**:
- Compact inline display based on `inlineTemplate`
- Click to edit in modal/popover
- Visual indicator with icon and color from data model
- Support for references to full documents

```tsx
<InlineTrackerNode id="bug_123" type="bug">
  <Icon name="bug_report" color="#dc2626" />
  <span>Fix the header bug</span>
  <Badge status="in-progress" />
  <Badge priority="high" />
</InlineTrackerNode>
```

#### 4. Bottom Tracker Panel Table View
**Features**:
- Tabs by type
- Filter by fields, status, date range, workspace
- Sort by any field
- Column configuration from data model
- Export to CSV/JSON
- Bulk operations (update status, delete, etc.)
- Click to jump to item (open doc or scroll to line)

```tsx
<TrackerTableView>
  <FilterBar types={['plan', 'bug', 'task']} />
  <Table
    columns={['type', 'title', 'status', 'priority', 'updated']}
    sortable={true}
    filterable={true}
  />
  <BulkActions />
  <ExportButton />
</TrackerTableView>
```

### Reference System

#### Full Document References
Inline items can reference full document items:

```markdown
Implement the feature described in #plan[ref:pln_01HQX...]
```

**Storage**: Reference stored in inline item's JSONB data
**Rendering**: Shows link with title of referenced document
**Navigation**: Click to open referenced document

#### Expanding Inline to Full Document
User action: Right-click inline item → "Expand to Document"

**Process**:
1. Extract inline item data
2. Create new document with frontmatter
3. Pre-populate fields from inline item
4. Replace inline item with reference to new document
5. Open new document for editing

**Example**:
```markdown
Before:
- Refactor the authentication system #task[id:tsk_123 status:to-do priority:high]

After (inline):
- Refactor the authentication system #task[ref:tsk_123]

New document (refactor-authentication.md):
---
trackerId: tsk_123
trackerType: task
title: Refactor the authentication system
status: to-do
priority: high
---

# Refactor the authentication system

[Content here...]
```

### Copy/Paste Behavior

#### Duplicate Prevention
When copying tracker items:

**Option 1: Copy as Reference (Default)**
- Paste creates reference to original item
- Preserves single source of truth
- Example: `#bug````````````````````````````````````````````````````````````````[ref:bug_123]`

**Option 2: Duplicate Item**
- Hold Option/Alt while pasting
- Creates new item with new ID
- Copies all field values
- User can modify after paste

**Option 3: Copy as Markdown**
- Hold shift while copying, include markdown

#### UI Affordance
Show paste options in context menu:
- Paste as Reference
- Paste as Duplicate
- Paste as Text

### AI / Claude Code Integration

#### Slash Commands for Tracker Creation
Users can create tracker documents directly from the AI chat panel using slash commands.

**Example Usage**:
```javascript
User types in AI panel: /plan dark mode feature

Claude Code creates:
- New file: plans/dark-mode-feature.md
- Proper frontmatter with tracker metadata
- Structured content based on plan template
```

#### Built-in Slash Command Files
**Location**: `.claude/commands/`

During workspace setup, install tracker-aware slash commands that reference the data model files:

**Example: \****`.claude/commands/plan.md`**
```markdown
Create a new plan document for: {{userInput}}

Instructions:
1. Read the plan tracker data model from .nimbalyst/trackers/plan.yaml
2. Generate a unique plan ID using the format specified (pln_ prefix + ULID)
3. Create a new markdown file in the plans/ directory
4. Use kebab-case filename based on the plan title
5. Include complete YAML frontmatter matching the plan data model schema
6. Populate required fields (title, status, priority, owner, tags, etc.)
7. Set status to "draft" by default
8. Add the plan-status comment marker after the title
9. Create a structured outline with common plan sections:
   - Goals
   - Current State
   - Proposed Solution
   - Implementation Plan
   - Risks & Mitigation
   - Success Metrics

Example frontmatter structure:
---
planStatus:
  planId: pln_[GENERATED_ULID]
  title: [User provided title]
  status: draft
  planType: feature
  priority: medium
  owner: [Current user or TBD]
  stakeholders: []
  tags: []
  created: "[Current date YYYY-MM-DD]"
  updated: "[Current timestamp ISO8601]"
  progress: 0
---

# [Plan Title]
<!-- plan-status -->

[Continue with plan content...]
```

**Example: \****`.claude/commands/decision.md`**
```markdown
Create a new decision document for: {{userInput}}

Instructions:
1. Read the decision tracker data model from .nimbalyst/trackers/decision.yaml
2. Generate a unique decision ID using the format specified (dec_ prefix + ULID)
3. Create a new markdown file in the decisions/ directory
4. Use kebab-case filename based on the decision title
5. Include complete YAML frontmatter matching the decision data model schema
6. Populate required fields (title, status, options, etc.)
7. Set status to "to-do" by default
8. Create a structured decision template with:
   - Decision Context
   - Options (with pros/cons for each)
   - Decision Criteria
   - Recommendation
   - Decision Record (to be filled when decided)

Example frontmatter structure:
---
decisionStatus:
  decisionId: dec_[GENERATED_ULID]
  title: [User provided title]
  status: to-do
  priority: medium
  owner: [Current user or TBD]
  stakeholders: []
  tags: []
  created: "[Current date YYYY-MM-DD]"
  updated: "[Current timestamp ISO8601]"
  chosen: null
  options:
    - name: "Option 1"
      pros: []
      cons: []
    - name: "Option 2"
      pros: []
      cons: []
---

# [Decision Title]
<!-- decision-status -->

## Decision Context
[Why is this decision needed?]

## Options

### Option 1: [Name]
**Pros:**
- [Benefit 1]

**Cons:**
- [Drawback 1]

### Option 2: [Name]
**Pros:**
- [Benefit 1]

**Cons:**
- [Drawback 1]

## Decision Criteria
[What factors are important?]

## Recommendation
[To be filled during evaluation]

## Decision Record
**Chosen**: [To be filled when decided]
**Date**: [To be filled when decided]
**Rationale**: [To be filled when decided]
```

**Example: \****`.claude/commands/bug.md`**
```markdown
Create a new bug tracker document for: {{userInput}}

Instructions:
1. Read the bug tracker data model from .nimbalyst/trackers/bug.yaml
2. Generate a unique bug ID (bug_ prefix + ULID)
3. Create a new markdown file in the bugs/ directory
4. Include frontmatter matching the bug data model
5. Create structured bug report with:
   - Description
   - Steps to Reproduce
   - Expected Behavior
   - Actual Behavior
   - Screenshots/Logs (if applicable)
   - Environment

Note: Bugs can also be tracked inline in other documents using #bug[...] syntax.
For full bug documents, use this template.
```

#### Dynamic Slash Command Generation
For custom tracker types, automatically generate slash commands:

**Process**:
1. User creates custom tracker type in `.nimbalyst/trackers/custom-type.yaml`
2. System detects new tracker definition
3. Auto-generates `.claude/commands/custom-type.md` with appropriate template
4. Claude Code immediately has access to `/custom-type` command
5. Template generated from data model schema

**Auto-generated command template**:
```markdown
Create a new {{trackerType}} document for: {{userInput}}

Instructions:
1. Read the {{trackerType}} tracker data model from .nimbalyst/trackers/{{trackerType}}.yaml
2. Generate a unique ID using the prefix "{{idPrefix}}_" + ULID
3. Create a new markdown file in the {{trackerType}}s/ directory
4. Include complete YAML frontmatter with all fields from the data model:
{{#each fields}}
   - {{name}}: {{#if required}}[REQUIRED]{{else}}[OPTIONAL]{{/if}} (type: {{type}})
{{/each}}
5. Set default values where specified in the data model
6. Add appropriate section headers based on tracker type
```

#### AI Integration Features

**Smart Defaults**:
- Auto-populate owner from current user (if configured)
- Suggest tags based on content analysis
- Infer priority from keywords ("urgent", "critical", etc.)
- Suggest related items based on semantic similarity

**Content Generation**:
- Generate plan outlines based on feature description
- Create decision option comparisons
- Draft bug reproduction steps
- Suggest acceptance criteria

**Validation**:
- Verify frontmatter matches data model schema
- Warn about missing required fields
- Suggest improvements to structure

**Workflow Integration**:
```javascript
User: /plan implement dark mode toggle
AI:
- Creates plan document with proper frontmatter
- Generates implementation phases
- Identifies potential risks
- Creates related #task items for each phase
- Links to relevant existing plans/decisions
```

**Multi-step Tracker Workflows**:
```javascript
User: /decision choose database for new feature
AI:
1. Creates decision document
2. Researches options (PostgreSQL, MySQL, SQLite, etc.)
3. Populates pros/cons for each option
4. Fills in decision criteria
5. Leaves recommendation section for user to complete
```

#### Setup and Maintenance

**During Onboarding**:
1. Install built-in tracker slash commands to `.claude/commands/`
2. Configure commands to reference `.nimbalyst/trackers/` data models
3. Explain to user how to create plans/decisions via AI
4. Demo: `/plan getting started` to show the feature

**Auto-sync**:
- When tracker data models change, update slash command templates
- Regenerate command files if deleted
- Validate command files reference correct data model paths

**User Customization**:
Users can edit `.claude/commands/*.md` files to:
- Customize the structure of generated documents
- Add project-specific sections
- Change default values
- Modify AI instructions for their workflow

### Onboarding Integration

#### Tracker Selection Screen
During onboarding, show tracker selection:

```javascript
Which tracking systems do you want to use?

☑ Plans - Track feature plans and design documents
☑ Decisions - Document architecture and design decisions
☑ Bugs - Track bugs and issues
☑ Tasks - Manage action items and todos
☐ Ideas - Capture feature ideas and brainstorming

You can always add or remove these later in Settings.

[Continue]
```

**Default**: All enabled except Ideas
**Customization**: Users can enable/disable at any time

**AI Integration Setup**:
After tracker selection, install corresponding slash commands:
- Selected "Plans" → Install `.claude/commands/plan.md`
- Selected "Decisions" → Install `.claude/commands/decision.md`
- Selected "Bugs" → Install `.claude/commands/bug.md`
- Selected "Tasks" → Install `.claude/commands/task.md`
- Selected "Ideas" → Install `.claude/commands/idea.md`

#### Settings Management
Settings screen includes Tracker Management:
- Enable/disable built-in trackers
- Create custom tracker types
- Edit tracker configurations
- Import/export tracker definitions
- Preview tracker UI components
- Regenerate AI slash commands

### Built-in Field Types

Core field types supported in data models:

| Type | Description | Example |
| --- | --- | --- |
| string | Short text field | Title, Owner, Name |
| text | Long text field | Description, Notes |
| number | Numeric value | Progress (0-100), Count |
| select | Single choice | Status, Priority |
| multiselect | Multiple choices | Tags, Categories |
| date | Date picker | Due Date, Start Date |
| datetime | Date + time picker | Scheduled Time |
| boolean | Checkbox | Is Blocking, Is Critical |
| user | User reference | Owner, Assignee |
| reference | Link to another tracker item | Related Bug, Blocks |
| array | List of items | Options, Stakeholders |
| object | Nested structure | Decision Options |

**Auto-managed fields**:
- `id` - Auto-generated ULID
- `created` - Auto-set on creation
- `updated` - Auto-updated on save

## Implementation Plan

### Phase 1: Data Model System
**Files**: `packages/runtime/src/plugins/TrackerPlugin/models/`

1. Create YAML parser for tracker definitions
2. Implement data model validation
3. Build ID generation system
4. Create built-in tracker definitions (plan, decision, bug, task, idea)
5. Add model loading from `.nimbalyst/trackers/`

**Acceptance Criteria**:
- Load and validate all built-in tracker models
- Generate valid short ULIDs with type prefixes
- Support custom tracker definitions
- Validate field types and constraints

### Phase 2: Storage Layer Migration
**Files**: `packages/electron/src/main/database/worker.js`

1. Create new `tracker_items` table with JSONB schema
2. Write migration scripts for existing data
3. Implement CRUD operations for JSONB storage
4. Add indexing for performance
5. Test migration with production data

**Acceptance Criteria**:
- All existing plans, decisions, and tracker items migrated
- JSONB queries perform well (< 50ms for 10k items)
- Full-text search works across all fields
- Rollback capability if migration fails

### Phase 3: Inline Tracker Refactor
**Files**: `packages/runtime/src/plugins/TrackerPlugin/nodes/`

1. Create new hash syntax parser (`#type``````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````[...]`)
2. Implement InlineTrackerNode Lexical node
3. Build typeahead system for hash syntax
4. Add field autocomplete
5. Migrate existing @ syntax to # syntax
6. Implement reference rendering

**Acceptance Criteria**:
- Hash syntax works for all tracker types
- Typeahead shows available types with icons
- Field autocomplete based on data model
- Existing @ items auto-migrate to # on load
- References render as clickable links

### Phase 4: Full Document Status Bar
**Files**: `packages/runtime/src/plugins/TrackerPlugin/components/`

1. Create StatusBar component
2. Implement field rendering based on data model
3. Build layout engine from `statusBarLayout` config
4. Add frontmatter sync (read/write)
5. Replace PlanStatusNode and DecisionStatusNode
6. Integrate with tab top gutter

**Acceptance Criteria**:
- Status bar renders above editor in tab gutter
- Fields editable inline
- Auto-saves to frontmatter
- Works for all tracker types with `fullDocument: true`
- Respects layout configuration from data model


### Phase 6: Bottom Table View
**Files**: `packages/runtime/src/plugins/TrackerPlugin/components/TrackerBottomPanel/`

1. Update existing TrackerBottomPanel
2. Build column configuration from data models

**Acceptance Criteria**:
- Shows all tracker items across workspace
- Filter by multiple criteria
- Sort by any column

### Phase 7: Reference System
**Files**: `packages/runtime/src/plugins/TrackerPlugin/references/`

1. Implement reference syntax (`#type````````````````````````````````````````````````````````````````[ref:id]`)
2. Build reference resolution
3. Create reference picker UI
4. Add "Expand to Document" action
5. Implement reference navigation
6. Handle broken references gracefully

**Acceptance Criteria**:
- References render with linked item's title
- Click reference navigates to target
- Broken references show warning
- Expand action creates document correctly
- Reference backlinks tracked

### Phase 8: Copy/Paste Behavior
**Files**: `packages/runtime/src/plugins/TrackerPlugin/clipboard/`

1. Implement reference-based paste (default)
2. Add duplicate paste (with modifier key)
3. Add plain text paste (with modifier key)
4. Show paste options in context menu
5. Handle cross-document paste
6. Prevent circular references

**Acceptance Criteria**:
- Default paste creates reference
- Alt+paste creates duplicate
- Shift+paste creates plain text
- Context menu shows options
- No duplicate IDs created

### Phase 9: Onboarding Integration
**Files**: `packages/electron/src/renderer/components/Onboarding/`

1. Add tracker selection screen
2. Create tracker preview cards
3. Implement enable/disable toggles
4. Set sensible defaults
5. Initialize `.nimbalyst/trackers/` with selections
6. Add Settings tracker management

**Acceptance Criteria**:
- Onboarding shows tracker options
- Previews show what each tracker does
- User can enable/disable any tracker
- Selections persist to workspace config
- Settings allow changing later

### Phase 10: Migration & Cleanup
**Files**: Multiple

1. Create migration guide for users
2. Auto-migrate old syntax on document load
3. Remove old PlanStatusPlugin
4. Remove old DecisionStatusPlugin
5. Remove old ItemTrackerPlugin
6. Update documentation
7. Add migration warnings/logs

**Acceptance Criteria**:
- All existing documents work with new system
- Old plugins cleanly removed
- Documentation updated
- Migration logs help debugging
- No data loss during migration

## Data Model Examples

### Research Tracker
Users studying topics could create:

```yaml
# .nimbalyst/trackers/research.yaml
type: research
displayName: Research Note
displayNamePlural: Research Notes
icon: science
color: "#06b6d4"

modes:
  inline: true
  fullDocument: true


fields:
  - name: title
    type: string
    required: true
  - name: topic
    type: select
    options:
      - AI/ML
      - Databases
      - Frontend
      - Backend
  - name: source
    type: string
  - name: rating
    type: number
    min: 1
    max: 5
```

### Feature Request Tracker
Product teams could create:

```yaml
# .nimbalyst/trackers/feature-request.yaml
type: feature-request
displayName: Feature Request
displayNamePlural: Feature Requests
icon: lightbulb
color: "#eab308"

modes:
  inline: true
  fullDocument: true


fields:
  - name: title
    type: string
    required: true
  - name: status
    type: select
    options:
      - Submitted
      - Under Review
      - Planned
      - In Development
      - Shipped
      - Rejected
  - name: requestedBy
    type: string
  - name: votes
    type: number
    default: 0
  - name: effort
    type: select
    options:
      - Small
      - Medium
      - Large
  - name: impact
    type: select
    options:
      - Low
      - Medium
      - High
```

## Testing Strategy

### Unit Tests
- Data model parsing and validation
- ID generation (uniqueness, format)
- JSONB storage operations
- Syntax parsing (hash syntax)
- Field type validation

### Integration Tests
- Full document status bar with frontmatter sync
- Inline item rendering and editing
- Reference resolution and navigation
- Copy/paste with different modes
- Migration from old schemas

### E2E Tests
- Create tracker items via typeahead
- Edit items inline and in status bar
- Navigate via bottom tracker panels
- Filter and sort in table view
- Export tracker items
- Expand inline to full document
- Create custom tracker types

### Performance Tests
- Table view with 10k+ items
- JSONB query performance
- Full-text search speed
- Typeahead responsiveness
- Reference resolution at scale

## Risks & Mitigation

### Risk: Data Loss During Migration
**Mitigation**:
- Keep old tables during migration
- Comprehensive backup before migration
- Incremental migration with rollback
- Extensive testing on copy of production data

### Risk: Breaking Existing Documents
**Mitigation**:
- Auto-migration of old syntax
- Backward compatibility mode
- Clear migration warnings
- Documentation and user communication

### Risk: Performance with Large Datasets
**Mitigation**:
- Proper indexing on JSONB fields
- Pagination in table view
- Lazy loading in bottom tracker panel
- Query optimization
- Caching frequently accessed items

### Risk: User Confusion with New Syntax
**Mitigation**:
- Onboarding tutorial
- In-app help and tooltips
- Migration guide documentation
- Gradual rollout with feature flag
- Support for both @ and # during transition

### Risk: Complex Data Model Validation
**Mitigation**:
- JSON Schema validation for YAML
- Runtime validation of field values
- Clear error messages
- Data model editor with live preview
- Template library for common patterns

## Future Enhancements

### Phase 11+: Advanced Features
1. **Relationships and Dependencies**
  - Link tracker items with typed relationships
  - Dependency graphs
  - Blocking item tracking

2. **Automation and Workflows**
  - Status transitions with rules
  - Auto-assignment based on conditions
  - Notification triggers

3. **Templates**
  - Item templates for common patterns
  - Document templates with pre-filled trackers
  - Template marketplace

4. **Collaboration**
  - Comments on tracker items
  - @mentions in tracker discussions
  - Activity history

5. **Analytics**
  - Tracker dashboards
  - Progress charts
  - Burndown/velocity metrics
  - Time tracking integration

6. **API and Integrations**
  - REST API for tracker items
  - Webhook support
  - GitHub Issues sync
  - Linear integration
  - Jira bridge

## Success Metrics

### User Experience
- Time to create tracker item < 5 seconds
- Migration success rate > 99%
- User adoption of custom trackers > 20%
- Reduction in support issues about tracking

### Performance
- Table view loads in < 100ms for 1k items
- Typeahead latency < 50ms
- JSONB queries < 20ms average
- Full-text search < 100ms

### Adoption
- 80%+ of users enable at least 3 tracker types
- 30%+ of users create custom tracker types
- Daily active tracker usage > current system
- Document with trackers increase by 50%

## Documentation Requirements

### User Documentation
1. Getting Started with Trackers
2. Creating Custom Tracker Types
3. Using Inline vs Full Document Trackers
4. Working with References
5. Table View and Filtering Guide
6. Migration Guide from Old System

### Developer Documentation
1. Tracker Plugin Architecture
2. Data Model Schema Reference
3. Adding Custom Field Types
4. Storage Layer API
5. Testing Tracker Features
6. Performance Best Practices

## Conclusion

This unified tracker system will:
- Eliminate code duplication and complexity
- Provide consistent, intuitive UX
- Enable unlimited customization by users
- Improve performance and scalability
- Position the product for advanced features

The refactor is substantial but well-scoped, with clear phases and acceptance criteria. The new system will be more maintainable, extensible, and user-friendly than the current fragmented approach.
