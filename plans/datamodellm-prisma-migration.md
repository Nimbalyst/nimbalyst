---
planStatus:
  planId: plan-datamodellm-prisma-migration
  title: Migrate DatamodelLM to Prisma Schema Format
  status: in-development
  planType: refactor
  priority: high
  owner: ghinkle
  stakeholders: []
  tags:
    - datamodellm
    - extension
    - simplification
    - prisma
  created: "2025-12-11"
  updated: "2025-12-11T00:00:00.000Z"
  progress: 80
---
# Migrate DatamodelLM to Prisma Schema Format

## Problem Statement

The current DatamodelLM extension uses a complex custom tool system for AI interactions:

1. Custom MCP tool registration from renderer to main process
2. IPC round-trips for tool execution
3. Tool scoping based on active editor type
4. Store registration/lookup by file path
5. Custom UI that needs to stay in sync with store changes

This complexity exists just to let the AI add entities to a diagram. Meanwhile, Claude already knows how to:
- Edit text files using standard `Edit` and `Write` tools
- Understand DBML syntax natively
- Make structured changes to text-based schema files

## Proposed Solution

Replace the custom `.datamodel` JSON format with Prisma schema format (`.prisma`), which Claude understands natively. The AI can then edit schemas using standard file editing tools instead of custom MCP tools.

### Why Prisma over DBML

| Feature | DBML | Prisma |
| --- | --- | --- |
| SQL databases | Yes | Yes |
| MongoDB | No | Yes |
| Embedded documents | No | Yes (`type`) |
| Arrays | No | Yes (`Type[]`) |
| Relations | Inline refs | Explicit both sides |
| Claude familiarity | Good | Very good |
| Real-world usage | Diagramming | Production ORMs |

### Prisma Format with Nimbalyst Metadata

```prisma
// @nimbalyst {"viewport":{"x":0,"y":0,"zoom":1},"positions":{"User":{"x":100,"y":100},"Post":{"x":450,"y":100}}}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  email     String    @unique
  name      String?
  posts     Post[]
  createdAt DateTime  @default(now())
}

model Post {
  title     String
  content   String?
  published Boolean   @default(false)
  author    User      @relation(fields: [authorId], references: [email])
  authorId  String
  tags      String[]
}
```

### MongoDB Example with Embedded Types

```prisma
// @nimbalyst {"viewport":{"x":0,"y":0,"zoom":1},"positions":{"User":{"x":100,"y":100}}}

datasource db {
  provider = "mongodb"
  url      = env("DATABASE_URL")
}

model User {
  id      String   @id @default(auto()) @map("_id") @db.ObjectId
  email   String   @unique
  profile Profile  // embedded document
  posts   Post[]
}

type Profile {  // embedded type, not a separate collection
  name   String
  avatar String?
}
```

### Key Benefits

1. **Simplifies AI interaction** - AI edits Prisma files directly instead of going through custom tools for every schema change
2. **Uses Claude's existing knowledge** - Prisma is a well-known format that Claude understands very well
3. **Standard file watching** - Changes detected via existing file watcher infrastructure
4. **Human-readable and portable** - Files can be edited in any text editor
5. **Supports both SQL and NoSQL** - Native MongoDB support with embedded types
6. **No unnecessary IDs** - Can use `@unique` fields as identifiers, or let Prisma handle it
7. **Production-ready format** - Files can be used directly with Prisma ORM

## Implementation Plan

### Phase 1: Prisma Parser/Serializer

- [ ] Add `@prisma/internals` or write custom parser for Prisma schema
- [ ] Create serializer that outputs Prisma schema with Nimbalyst metadata comment
- [ ] Handle metadata extraction from `// @nimbalyst {...}` comment
- [ ] Map Prisma constructs to visual Entity/Field/Relationship types

### Phase 2: Update DatamodelLM Editor

- [ ] Change file extension from `.datamodel` to `.prisma`
- [ ] Update manifest.json with new file patterns
- [ ] Modify store to load/save Prisma format
- [ ] Update `getContent()` to return Prisma schema string
- [ ] Handle file watcher reloading when file changes externally

### Phase 3: Update AI Tools for Prisma

- [ ] Remove entity/field/relationship manipulation tools from `aiTools.ts` (no longer needed - AI edits file directly)
- [ ] Keep extension AI tools infrastructure for other uses (screenshots, etc.)
- [ ] Add screenshot tool: `capture_datamodel_screenshot` - captures the current diagram view
- [ ] Update `registerEditorStore`/`unregisterEditorStore` if still needed for screenshot context

### Phase 4: Update New File Menu

- [x] Change "Data Model" to create `.prisma` files
- [x] Update default content to be valid Prisma schema with metadata comment

## Prisma Feature Mapping

| Current Feature | Prisma Equivalent |
| --- | --- |
| Entity | `model` |
| Field | Field definition |
| Primary Key | `@id` attribute |
| Foreign Key | `@relation(fields: [...], references: [...])` |
| Nullable | `Type?` (optional) |
| Unique | `@unique` attribute |
| Default Value | `@default(value)` attribute |
| Relationship | Relation fields on both models |
| Array fields | `Type[]` |
| Embedded docs | `type` (MongoDB) |
| Entity Position | `// @nimbalyst {...}` JSON |
| Viewport | `// @nimbalyst {...}` JSON |
| Database type | `datasource db { provider = "..." }` |

## Prisma Syntax Reference

```prisma
// Models (tables/collections)
model User {
  email     String   @unique        // unique constraint
  name      String?                 // nullable (optional)
  age       Int      @default(0)    // default value
  posts     Post[]                  // one-to-many relation
  profile   Profile?                // one-to-one relation
  createdAt DateTime @default(now())
}

// Relations
model Post {
  title    String
  author   User   @relation(fields: [authorId], references: [email])
  authorId String
}

// Embedded types (MongoDB only)
type Address {
  street String
  city   String
  zip    String?
}

// Enums
enum Role {
  USER
  ADMIN
}

// Indexes
model User {
  @@index([email, name])
  @@unique([firstName, lastName])
}
```

## Migration Considerations

### Existing `.datamodel` Files

- Provide one-time migration utility to convert existing JSON files to Prisma format
- Migration maps: entities -> models, fields -> fields, relationships -> @relation

### Parser Options

1. **`@prisma/internals`**: Official parser, full compatibility
2. **Custom parser**: Lighter weight, only parse what we need
3. **Regex-based**: Simple extraction for basic models (fragile)

Recommendation: Start with custom parser for reading, since we only need to extract models/fields/relations. Use string templates for writing.

## Success Criteria

- [ ] AI can create and modify data models using standard `Edit` tool
- [ ] Editor reloads automatically when file changes externally
- [ ] All current visual features (drag, zoom, relationships) still work
- [ ] Files are valid Prisma schema syntax
- [ ] Significantly reduced codebase complexity
- [ ] MongoDB embedded types work correctly

## Open Questions

1. Should the `datasource` and `generator` blocks be required or optional?
2. Do we want to support all Prisma features (enums, indexes, composite types)?
3. How do we handle the `url = env("DATABASE_URL")` - hide it or make it configurable?
