---
trackerStatus:
  type: plan
planId: plan-tracker-generic-schema-refactor
title: Tracker Generic Schema Refactor
status: completed
planType: system-design
priority: high
owner: ghinkle
tags:
  - tracker
  - architecture
  - refactor
  - breaking-change
  - schema
created: "2026-04-08"
updated: "2026-04-08"
progress: 100
---
# Tracker Generic Schema Refactor

## Overview

The tracker system currently claims to be schema-driven, but that is only partially true in the renderer. The real contracts that matter most -- persistence, sync, MCP tools, import/export, and much of the UI -- still hardcode a privileged built-in issue shape (`status`, `priority`, `owner`, `assignee`, `reporter`, `labels`, and similar fields).

This plan fixes that by making the tracker schema authoritative across the entire stack and by removing compatibility-driven branching. The result should be a clean tracker architecture where:

- the schema is the only place that defines tracker field names
- the product consumes semantic roles instead of hardcoded field names
- sync and MCP operate on generic field bags
- file formats are adapters around one canonical tracker record

This is a breaking refactor. The goal is clean code, not incremental compatibility.

## Problem Statement

Today the tracker system has three conflicting truths:

1. The tracker model layer says fields are flexible.
2. The shared runtime and sync layers still encode a fixed issue schema.
3. The UI falls back to built-in type/status/color/field assumptions whenever the schema stops giving it exactly what it expects.

That split creates predictable failures:

- custom fields are second-class
- custom tracker types are not truly portable through sync and MCP
- different layers disagree about which fields are canonical
- schema loading is renderer-owned instead of application-owned
- the codebase keeps accumulating special cases

The system does not need more patching. It needs a single canonical tracker model and a hard reset on where semantics live.

## Goals

1. Make one canonical tracker record shape used by persistence, sync, MCP, and UI.
2. Make tracker schemas authoritative in the main process, not renderer-local.
3. Replace hardcoded field-name semantics with schema-declared roles.
4. Make sync fully generic and non-lossy for schema-defined fields.
5. Make MCP tracker tools operate on generic field bags rather than built-in issue arguments.
6. Make tracker UI views derive behavior from schema metadata instead of built-in type/status maps.
7. Delete compatibility branches that preserve old tracker formats and old built-in assumptions.

## Non-Goals

- Backward compatibility with old tracker file formats or old MCP argument shapes
- Performance/indexing work in this refactor pass
- Solving every reporting, automation, analytics, or enterprise permission need
- Keeping `planStatus`, `decisionStatus`, and similar legacy tracker formats alive forever

## Design Principles

### 1. Schema Owns Field Names

No layer outside the schema may assume that workflow status is called `status`, that assignment is called `owner`, or that categorization is called `labels` or `tags`.

Field names are data.

### 2. Product Uses Roles, Not Names

The product still needs semantic concepts like title, workflow state, assignee, or due date. Those semantics should come from schema-declared roles, not from hardcoded property names.

Recommended roles:

- `title`
- `workflowStatus`
- `priority`
- `assignee`
- `reporter`
- `tags`
- `startDate`
- `dueDate`
- `progress`

Roles are optional. If a schema does not declare a role, that feature should disappear or degrade gracefully instead of guessing.

### 3. One Canonical Tracker Record

All internal layers should use one shape:

```ts
type TrackerRecord = {
  id: string;
  primaryType: string;
  typeTags: string[];
  issueKey?: string;
  source: 'native' | 'inline' | 'document';
  sourceRef?: string;
  archived: boolean;
  syncStatus: 'local' | 'pending' | 'synced';
  content?: unknown;
  system: {
    createdAt: string;
    updatedAt: string;
    authorIdentity?: TrackerIdentity | null;
    lastModifiedBy?: TrackerIdentity | null;
    linkedSessions?: string[];
    linkedCommitSha?: string;
  };
  fields: Record<string, unknown>;
  fieldUpdatedAt: Record<string, number>;
};
```

The only top-level business data should be system metadata and routing metadata. User-defined tracker data lives in `fields`.

### 4. File Formats Are Adapters

Inline markers, document frontmatter, and native DB records are not separate tracker models. They are storage or editing formats that adapt to and from the canonical tracker record.

### 5. Main Process Is the Source of Truth

The main process must own tracker schema loading, watching, and distribution. The renderer may cache schema snapshots, but it must not be the authority.

## Target Architecture

### TrackerSchemaService

Introduce a main-process `TrackerSchemaService` responsible for:

- loading built-in schemas
- loading workspace schemas from `.nimbalyst/trackers/*.yaml`
- validating schemas
- resolving role mappings
- exposing a schema snapshot to renderer, MCP, and tracker services
- watching the schema directory for changes

`globalRegistry` should stop being a renderer-bootstrapped singleton that other layers casually read.

### Schema Format

Extend the tracker schema with role metadata and view metadata:

```yaml
type: bug
displayName: Bug
displayNamePlural: Bugs
icon: bug_report
color: "#dc2626"

roles:
  title: title
  workflowStatus: state
  priority: severity
  assignee: assignedTo
  tags: labels

fields:
  - name: title
    type: string
    required: true

  - name: state
    type: select
    required: true
    options:
      - value: todo
        label: To Do
        color: "#6b7280"
      - value: fixing
        label: Fixing
        color: "#eab308"

  - name: severity
    type: select
    options:
      - value: low
        label: Low
      - value: critical
        label: Critical
```

This lets the product find semantic fields without requiring shared field names across tracker types.

### Persistence

Store the canonical record directly in PGLite.

Do not keep mixing some fields into top-level columns, some into `data`, and some into `customFields`.

Recommended table direction for this refactor:

- keep routing/system columns such as `id`, `primary_type`, `type_tags`, `workspace`, `source`, `source_ref`, `archived`, `sync_status`
- replace the current mixed `data` shape with a canonical JSONB payload for `system`, `fields`, and `field_updated_at`
- stop treating `status`, `priority`, `owner`, and similar names as special inside storage logic

No indexing redesign is included in this plan. Correctness and architectural cleanup come first.

### Sync

The sync payload must become a direct transport of the canonical tracker record.

Requirements:

- all schema-defined fields round-trip without loss
- `fieldUpdatedAt` exists for every field key in `fields`
- no semantic rewrites like mapping `owner` from `assigneeEmail`
- no privileged built-in business fields outside system metadata

### MCP API

Replace fixed built-in tracker arguments with generic field operations.

Recommended tool shape:

```ts
tracker_create({
  type: string,
  typeTags?: string[],
  fields: Record<string, unknown>,
  content?: string,
  archived?: boolean
})

tracker_update({
  id: string,
  fields?: Record<string, unknown>,
  unsetFields?: string[],
  content?: string,
  archived?: boolean,
  typeTags?: string[]
})

tracker_list({
  type?: string,
  typeTag?: string,
  where?: Array<{ field: string; op: string; value: unknown }>,
  limit?: number
})
```

If the product wants convenience for agents later, it can add schema-driven sugar on top of this. The core API should remain generic.

### UI

All tracker UI surfaces should consume schema snapshots and roles:

- detail panel
- table view
- kanban view
- transcript widgets
- inline popovers
- create/edit forms

UI behavior should come from:

- field definitions
- role mappings
- field options
- model colors/icons
- view config

Not from hardcoded arrays of built-in types, statuses, colors, or primary field names.

## Workstreams

## Workstream 1: Canonical Model

### Objectives

- Define the canonical tracker record
- Remove mixed business-field shapes from shared types

### Tasks

1. Replace the shared tracker item type with the canonical record model.
2. Remove `customFields` as a separate concept.
3. Move all user-defined business data into `fields`.
4. Restrict top-level properties to system and routing metadata.

### Acceptance Criteria

- Shared tracker types no longer privilege built-in business fields.
- The same tracker record shape is used by main, renderer, sync, and MCP.

## Workstream 2: Schema Authority

### Objectives

- Move schema ownership into the main process
- Eliminate renderer-owned schema bootstrapping

### Tasks

1. Introduce `TrackerSchemaService`.
2. Load built-in schemas there.
3. Load workspace YAML schemas there.
4. Add watcher-based schema refresh.
5. Expose schema snapshots to renderer and MCP via IPC/service APIs.
6. Delete ad hoc schema loading paths and hardcoded sample-file logic.

### Acceptance Criteria

- Tracker schemas are loaded once in the main process.
- Renderer surfaces consume a schema snapshot rather than mutating their own registry state.

## Workstream 3: Breaking Storage And Sync Refactor

### Objectives

- Make persistence and sync non-lossy and generic

### Tasks

1. Replace the mixed storage payload with canonical `system`, `fields`, and `fieldUpdatedAt`.
2. Rewrite tracker sync payload types around the canonical record.
3. Remove field-specific sync mapping logic.
4. Ensure per-field merge uses actual field keys from `fields`.
5. Rewrite hydration and upload logic to operate on the canonical record only.

### Acceptance Criteria

- Sync no longer drops schema-defined fields.
- No storage or sync logic assumes field names like `status`, `priority`, or `owner`.

## Workstream 4: MCP Contract Cleanup

### Objectives

- Make tracker tools generic and schema-first

### Tasks

1. Replace fixed field argument lists with generic `fields` and `unsetFields`.
2. Rewrite list filtering to accept field-driven predicates.
3. Return schema-consistent structured results to widgets.
4. Remove built-in tracker-specific wording from tool descriptions where it leaks storage assumptions.

### Acceptance Criteria

- Agents can create and update arbitrary tracker schemas without requiring code changes.
- MCP handler code no longer duplicates tracker field definitions.

## Workstream 5: File Adapter Simplification

### Objectives

- Stop embedding tracker semantics into multiple file formats

### Tasks

1. Choose one document-backed tracker format.
2. Rewrite import/export logic around canonical record adapters.
3. Remove branches for `planStatus`, `decisionStatus`, `automationStatus`, and similar format-specific storage rules.
4. Rewrite inline serialization/parsing so it is schema-aware instead of hardcoded to a fixed prop set.

### Acceptance Criteria

- File-backed trackers round-trip through one canonical adapter layer.
- Document parsing code no longer has built-in tracker-type switches.

## Workstream 6: UI Rewrite

### Objectives

- Make tracker UI truly schema-driven

### Tasks

1. Replace hardcoded type/status/color maps with schema-derived view data.
2. Use field roles to determine which fields appear in primary UI positions.
3. Drive kanban columns from the schema's workflow-status role.
4. Drive badges, labels, and editors from field definitions and options.
5. Remove built-in type option lists and primary-field assumptions.

### Acceptance Criteria

- A custom tracker schema can render correctly in detail, table, and kanban views without code changes.
- UI components no longer contain built-in tracker-type registries.

## Deletions This Plan Should Explicitly Make

- Delete renderer-owned tracker schema bootstrapping as the authority model.
- Delete hardcoded custom tracker filenames.
- Delete fixed MCP tracker field lists.
- Delete sync payload field whitelists.
- Delete special-case tracker frontmatter branches.
- Delete built-in type/status/color maps in tracker UI components where schema data exists.

## Testing Strategy

1. Unit-test schema role resolution.
2. Unit-test canonical record serialization/deserialization.
3. Unit-test sync merge behavior across arbitrary field keys.
4. Unit-test MCP create/update/list behavior using non-built-in tracker schemas.
5. Add integration tests proving a custom tracker type survives:
  - creation
  - edit
  - sync
  - reload
  - UI rendering

## Risks

### 1. This is a breaking refactor

That is intentional. The clean architecture requires deleting old assumptions rather than layering over them.

### 2. The scope is broad

This touches shared types, database access, sync, MCP, file adapters, and UI. The work should be staged, but each stage must still target the new architecture rather than preserving the old one.

### 3. Some current tracker surfaces may disappear temporarily

That is acceptable if it avoids reintroducing compatibility branches. The priority is establishing the correct contracts first.

## Acceptance Criteria For The Whole Plan

- The only place that defines tracker field names is the tracker schema.
- Shared tracker contracts do not privilege built-in business fields.
- Main process schema loading is authoritative.
- Sync round-trips all schema-defined fields without semantic corruption.
- MCP tools can operate on arbitrary tracker schemas without code changes.
- Tracker UI surfaces render from schema roles and field definitions instead of built-in assumptions.

## Recommended Implementation Order

1. Canonical tracker record and schema role design
2. Main-process `TrackerSchemaService`
3. Storage and sync rewrite
4. MCP rewrite
5. File adapter rewrite
6. UI rewrite
7. Deletion pass for old branches and assumptions
