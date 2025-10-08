---
planStatus:
  planId: plan-image-management
  title: Agent Image Management Strategy
  status: in-development
  planType: infrastructure
  priority: medium
  owner: ghinkle
  stakeholders:
    - editor-team
    - agents
    - design
  tags:
    - media
    - ai-chat
  created: "2025-10-08"
  updated: "2025-10-08T18:30:00Z"
  progress: 60
  dueDate: "2025-10-29"
  startDate: "2025-10-08"
---
# Agent Image Management Strategy
<!-- plan-status -->

## Background
- Plan documents and other project markdown files often embed images as base64 data URIs, greatly inflating file size and prompt tokens when shared with AI providers.
- Large inline blobs slow down document editing, syncing, and review, and cause transcripts sent to coding agents to exceed context limits.
- We need a consistent strategy for storing images referenced in markdown so they integrate with StravuEditor, AI chat exports, and agent tooling.

## Goals
- Evaluate approaches for externalizing markdown-embedded images (e.g., project-relative asset files) to reduce base64 usage.
- Define how AI chat and coding agents resolve image references when reading plan documents or other markdown sources.
- Provide authoring workflows in StravuEditor (paste, drag/drop) that persist image assets predictably without embedding raw base64.
- Document provider-specific requirements for supplying images alongside markdown when context is transmitted.

## Non-Goals
- Building a remote media CDN; focus on local/project-scoped asset storage.
- Replacing markdown as the primary format for plans; aim to enhance current workflow.
- Implementing computer-vision features; scope is about access and transmission.

## Deliverables
- Decision document selecting the canonical storage pattern (likely external image files + markdown links) with pros/cons.
- Updated markdown serialization/parsing logic to support the new image reference schema and avoid base64 by default.
- StravuEditor paste/upload handlers that create image assets and insert stable links, including migration prompts for existing base64 content.
- Guidance for AI chat panel and coding agents on attaching or referencing images when sending plan documents to providers.
- Migration utilities or scripts to convert existing base64-laden markdown to the new format.

## Milestones
1. Audit current markdown documents (plans, notes) to quantify base64 image usage and identify storage pain points.
2. Prototype external image storage models (e.g., `/assets/` folder, hashed filenames) and test round-trip editing in StravuEditor.
3. Choose the canonical representation and codify markdown conversion rules plus fallback behavior.
4. Implement editor tooling for inserting/relinking images and detecting legacy base64 blocks.
5. Update agent runtimes to fetch referenced image files when sending markdown context to providers (separate uploads vs. metadata handoff).
6. Develop migration plan and tools for existing documents; communicate rollout steps to users.

## Technical Considerations
- Decide on asset folder structure, naming conventions, and collision handling for pasted images across projects.
- Ensure references remain portable across Electron and web deployments and compatible with session/document stores.
- Define provider interaction: when markdown references an image file, how is that file transmitted (multipart, signed URL, etc.)?
- Provide safe fallbacks when referenced image files are missing or deleted.
- Coordinate with DocumentLinkPlugin if image links should leverage the same resolution mechanisms.

## Risks & Mitigations
- Broken image links post-migration; mitigate with validation checks, editor warnings, and automated repair tools.
- Workspace bloat if image assets are duplicated; establish deduplication or reuse strategy.
- AI provider limitations on image attachment sizes; validate with representative files before finalizing approach.
- User confusion during transition; deliver clear UX cues and documentation for inserting images under the new model.

## Implementation Plan

### Architecture Decision
Store images in workspace-level `.preditor/assets/[hash].[ext]` using SHA-256 content addressing. Use standard relative markdown links for compatibility with all markdown editors.

### Core Components

**1. ElectronDocumentService Extensions** (`packages/electron/src/main/services/ElectronDocumentService.ts`)
✅ IMPLEMENTED - Added asset management methods:
- `storeAsset(buffer: Buffer, mimeType: string): Promise<{ hash: string, extension: string, path: string }>`
- `getAssetPath(hash: string): Promise<string | null>`
- Content-addressed storage using SHA-256 hashing
- Automatic file extension detection from MIME type
- Uses existing `document-service:*` IPC channels

**2. Image Paste/Drop Handler** (`packages/rexical/src/plugins/ImagesPlugin/index.tsx`)
✅ IMPLEMENTED - Full paste/drop support:
- Intercepts paste/drop events with image data
- Sends buffer to `document-service:store-asset` via IPC
- Inserts ImageNode with content-addressed path `.preditor/assets/[hash].[ext]`
- Automatic deduplication via content hashing
- Supports multiple image formats (PNG, JPEG, GIF, WebP, SVG)

**3. Markdown Image Transformer** (`packages/rexical/src/plugins/ImagesPlugin/ImageTransformer.ts`)
✅ IMPLEMENTED - Enhanced markdown serialization:
- Exports images as `![alt](path){widthxheight}` with rounded dimensions
- Imports both standard `![alt](path)` and sized `![alt](path){300x200}` formats
- Preserves user-resized image dimensions across save/reload
- Works with content-addressed paths

**4. Path Resolution Utility**
⏳ TODO - Need relative path calculation:
- Currently uses absolute paths from workspace root
- Should calculate relative paths from document location to asset folder
- Document at `plans/feature.md` → `../.preditor/assets/abc123.png`
- Document at `docs/api/guide.md` → `../../.preditor/assets/abc123.png`

**5. AI Document Context Enhancement** (`packages/runtime/src/ai/prompt.ts`)
⏳ TODO - Provider integration:
- Scan markdown content for image references matching `.preditor/assets/` pattern
- Resolve to absolute filesystem paths
- Load image buffers and attach as separate content blocks (multipart/vision API)
- Strip image markdown syntax from text sent to provider to reduce tokens

**6. Migration Handler**
⏳ TODO - Base64 conversion:
- Detect base64 data URIs in loaded documents
- Show toast notification: "This document has embedded images (450KB). Externalize to reduce size?"
- On confirm: extract base64 → decode → hash → store → replace with relative link
- Optional: Auto-migrate on document save

### Storage Format
- Location: `.preditor/assets/[sha256-hash].[ext]`
- Naming: Hash from image buffer content, extension from MIME type
- Deduplication: Same image content = same hash = single file
- Cleanup: Periodic scan of workspace .md files, delete unreferenced assets

### Example Flow (Current Implementation)
1. User pastes image in `plans/feature.md`
2. Buffer sent to DocumentService → hashed as `a1b2c3d4...` (SHA-256)
3. Stored as `.preditor/assets/a1b2c3d4.png`
4. Markdown updated: `![screenshot](.preditor/assets/a1b2c3d4.png)` (workspace-relative path)
5. User resizes image → saved as `![screenshot](.preditor/assets/a1b2c3d4.png){300x200}`
6. Same image pasted in `docs/guide.md` → detects duplicate hash, reuses file
7. On reload, image dimensions are preserved from markdown

Note: Currently using workspace-relative paths. Relative path calculation from document location is TODO.

### Benefits
- Standard markdown - works everywhere
- Automatic deduplication via content addressing
- Minimal file sizes (no base64 bloat)
- Dramatic reduction in AI token usage
- No database overhead
- Simple garbage collection

## Open Questions
- Should we maintain a fallback export mode that re-embeds base64 for external sharing scenarios?
  - No - relative links are portable and standard
- How should thumbnails vs. full-resolution assets be handled in markdown and agent transcripts?
  - Full resolution only initially, thumbnails can be added later if needed
- Do coding agents need permission to create/update image assets (e.g., screenshot diffs), and how is that serialized?
  - Out of scope for initial implementation
- What additional tooling is required for collaborative projects to sync image assets effectively?
  - Standard git workflow - `.preditor/assets/` is committed alongside markdown
