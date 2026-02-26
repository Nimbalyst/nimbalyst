---
planStatus:
  planId: plan-ios-slash-commands-attachments
  title: iOS Slash Command Typeahead + Image Attachments
  status: done
  planType: feature
  priority: high
  owner: ghinkle
  stakeholders: []
  tags: [ios, mobile, sync, slash-commands, attachments, camera]
  created: "2026-02-18"
  updated: "2026-02-20T00:00:00.000Z"
  progress: 100
---

# iOS Slash Command Typeahead + Image Attachments

Three features for the iOS ComposeBar:
1. Slash command typeahead (with commands synced from desktop via index room)
2. Image pick from photo library + paste from clipboard as attachments
3. Camera capture as attachment

## Current State

**ComposeBar.swift** is a simple `TextField` + send button. No autocomplete, no attachment support. Prompts are sent as plain text through `SyncManager.sendPrompt()` which encrypts and queues them via the index room WebSocket for the desktop to pick up.

**Desktop side** has a full slash command system:
- `SlashCommandService` discovers commands from 3 sources: SDK built-ins, `.claude/commands/` files, extension plugins
- `AgenticInput.tsx` has typeahead with `/` trigger, score-based ranking, grouped sections
- Commands have: name, description, argumentHint, source, content

**No command data currently syncs to mobile.** The index room syncs sessions, projects, settings, and device presence, but not project-level configuration like available commands.

---

## Feature 1: Slash Command Sync + Typeahead

### Sync Architecture: Persist in project_index

Commands are project-scoped. We extend the **project_index** table with a general-purpose encrypted config blob. This is the same pattern used for `encryptedClientMetadata` on sessions, and gives us a place to add more per-project config later.

Persisting in project_index means mobile gets commands immediately on startup via `indexSyncResponse` without waiting for desktop to be online.

### What Gets Synced

A lightweight command manifest per project -- name and description only. We do NOT sync command file content (that's desktop-only for execution). Mobile just needs enough to show typeahead:

```typescript
interface SyncedSlashCommand {
  name: string;           // e.g., "commit", "review", "BMad:agents:bmad-master"
  description?: string;   // Human-readable description
  source: 'builtin' | 'project' | 'user' | 'plugin';
}

// Encrypted and stored in project_index.encryptedConfig
interface ProjectConfig {
  commands: SyncedSlashCommand[];
  lastCommandsUpdate: number;  // timestamp
  // Extensible: future project-level config goes here
}
```

### Desktop Side Changes

1. **CollabV3Sync.ts** - When syncing projects to index, also encrypt and include the command manifest:
   - After `SlashCommandService.listCommands()` resolves, serialize `{ commands, lastCommandsUpdate }`
   - Encrypt as `encryptedConfig` blob (same AES-GCM pattern as clientMetadata)
   - Include in project index update

2. **Trigger**: Re-sync commands when:
   - Workspace opens/changes
   - File watcher detects changes in `.claude/commands/`
   - Extension plugins load/unload
   - On periodic sync (existing session sync timer already runs every 30s)

3. **runtime/sync/types.ts** - Extend `ProjectIndexEntry`:
   ```typescript
   encryptedConfig?: string;   // base64 AES-GCM ciphertext of ProjectConfig
   configIv?: string;          // base64 IV
   ```

### Server Changes (CollabV3)

4. **IndexRoom.ts** - Add `encrypted_config` + `config_iv` columns to `project_index` table
   - Store on project upsert (same as existing encrypted fields)
   - Include in `indexSyncResponse` project entries
   - Broadcast via `projectBroadcast`

5. **collabv3/types.ts** - Extend `ProjectIndexEntry` with same fields

### iOS Side Changes

6. **SyncProtocol.swift** - Add `encryptedConfig` + `configIv` to `ServerProjectEntry`

7. **SyncManager.swift** - On receiving project data, decrypt config and extract commands:
   - Decrypt `encryptedConfig` using existing crypto
   - Parse JSON into `ProjectConfig`
   - Store commands as JSON blob on the `Project` GRDB record
   - Views observe project changes via GRDB and get updated commands

8. **New: `SlashCommand` model (Swift)**
   ```swift
   struct SlashCommand: Codable, Identifiable {
       let name: String
       let description: String?
       let source: String  // "builtin" | "project" | "user" | "plugin"
       var id: String { name }
   }
   ```

9. **New: `CommandSuggestionView.swift`** - Typeahead overlay for ComposeBar:
   - Appears when user types `/` at start of input (or after whitespace)
   - Filters commands as user types after `/`
   - Score-based ranking matching desktop logic (exact > prefix > word boundary > contains)
   - Tapping a suggestion inserts `/{commandName} ` into the text field
   - Dismiss on tap outside, backspace past `/`, or Escape
   - SwiftUI overlay positioned above the ComposeBar

10. **Update ComposeBar.swift**:
    - Monitor text changes for `/` trigger
    - Show/hide `CommandSuggestionView` overlay
    - Handle selection callbacks
    - Pass available commands from parent (SessionDetailView gets them from project data)

### Typeahead UI Design

- Floating list above the compose bar (like iOS keyboard suggestions but vertical)
- Each row: `/ commandName` + description on the right (truncated)
- Grouped by source: Built-in, Project, User, Plugins
- Max 6 visible results, scrollable
- Matches the existing dark theme (NimbalystColors)

---

## Feature 2: Image Attachments (Photo Library + Paste)

### How Attachments Work on Desktop

Desktop `AgenticInput` handles paste/drag-drop:
1. Read file as ArrayBuffer
2. IPC `attachment:validate` (checks size/type)
3. IPC `attachment:save` (compresses, saves to disk, returns `ChatAttachment`)
4. Attachment preview shown in input area
5. On send, attachments array included in the prompt message

For mobile, we can't save to the desktop filesystem. Instead, **attachments are synced as base64 data** through the existing queued prompt system.

### Sync Strategy

Extend the queued prompt to include attachment data:

```typescript
// Existing EncryptedQueuedPrompt gets a new optional field
interface EncryptedQueuedPrompt {
  id: string;
  encryptedPrompt: string;
  iv: string;
  timestamp: number;
  source?: string;
  // NEW: encrypted attachment payloads
  attachments?: EncryptedAttachment[];
}

interface EncryptedAttachment {
  id: string;
  filename: string;
  mimeType: string;
  encryptedData: string;  // base64 AES-GCM ciphertext of the image data
  iv: string;
  size: number;           // original size in bytes
  width?: number;         // image dimensions for display
  height?: number;
}
```

Desktop decrypts the prompt, saves attachments to temp files, creates `ChatAttachment` objects, and passes them to the AI provider like normal.

### Size Constraints

Aggressive compression for v1. Cloudflare Durable Objects support up to 1MB per WebSocket message.

- Resize images to max 1024px on longest edge
- JPEG compression at quality 0.7
- This keeps most photos under 200KB, well within WebSocket limits
- Max 5 images per prompt
- If a compressed image still exceeds 500KB, further reduce quality/resolution

A separate HTTP upload endpoint can be added later if higher-resolution image support is needed.

### Image Paste Approach

iOS 26 TextEditor's new `AttributedString` support does NOT include inline images (confirmed via WWDC25 session). Rather than wrapping UITextView for paste interception, we keep the SwiftUI `TextField` and add a **`+` button** with an action sheet offering:
- **Photo Library** (PHPicker)
- **Take Photo** (UIImagePickerController camera)
- **Paste from Clipboard** (reads `UIPasteboard.general.image`)

This is simpler, more discoverable, and avoids UIKit bridging complexity. Can revisit with a UITextView wrapper later if inline paste-to-attach becomes a strong user request.

### iOS Implementation

11. **Update ComposeBar.swift**:
    - Add a `+` button to the left of the text field
    - Tapping shows the action sheet with Photo Library / Camera / Paste options
    - Add `attachments` binding and `onAttachmentAdd` / `onAttachmentRemove` callbacks
    - Show `AttachmentPreviewBar` above the text field when attachments are present

12. **New: `AttachmentPicker.swift`** - Wraps `PHPickerViewController`:
    - Filter: images only (`.images` configuration)
    - Multi-select: up to 5 images
    - Returns `[UIImage]` + generated filenames + mimeTypes

13. **New: `ImageCompressor.swift`** - Compress images before encryption:
    - Resize to max 1024px longest edge (using `UIGraphicsImageRenderer`)
    - JPEG compression at quality 0.7
    - Returns compressed `Data` + width/height

14. **New: `AttachmentPreviewBar.swift`** - SwiftUI view for showing attached images:
    - Horizontal scroll of thumbnail chips
    - Each chip: small image preview + filename + X to remove
    - Shows progress indicator while compressing

15. **Update `SyncManager.sendPrompt()`**:
    - New signature: `sendPrompt(sessionId: String, text: String, attachments: [LocalAttachment]?)`
    - Compress each image via `ImageCompressor`
    - Encrypt each attachment's data blob via `CryptoManager`
    - Build `EncryptedAttachment` array
    - Include in the `EncryptedQueuedPrompt`

16. **Update `SyncProtocol.swift`**:
    - Add `attachments` field to `EncryptedQueuedPrompt`
    - Add `EncryptedAttachment` struct

### Desktop Side (Receiving Attachments)

17. **Update queued prompt processing** (wherever desktop decrypts and processes mobile prompts):
    - Decrypt each attachment's `encryptedData`
    - Write to temp directory as files (e.g., `{tempDir}/mobile-attachments/{id}.{ext}`)
    - Create `ChatAttachment` objects with file paths
    - Include in the prompt sent to the AI provider

18. **Update `SyncedQueuedPrompt`** type in runtime:
    - Add optional `attachments` field matching the encrypted wire format

---

## Feature 3: Camera Capture

19. **New: `CameraCapture.swift`** - Wraps `UIImagePickerController` for camera:
    - Source type: `.camera`
    - Photo only (no video)
    - Returns captured `UIImage`
    - Feeds into the same `ImageCompressor` -> `SyncManager.sendPrompt()` pipeline

20. **Info.plist updates**:
    - `NSCameraUsageDescription`: "Take photos to attach to your AI session"
    - `NSPhotoLibraryUsageDescription`: "Choose photos to attach to your AI session" (may already exist)

---

## Implementation Order

### Phase 1: Project Config Sync Infrastructure
- Server: Add `encrypted_config`/`config_iv` columns to project_index
- CollabV3 types: Extend `ProjectIndexEntry`
- Runtime types: Extend `ProjectIndexEntry`
- Desktop: Encrypt command manifest and include in project sync
- iOS: Decrypt config from project data, store commands on Project record

### Phase 2: iOS Typeahead UI
- `SlashCommand` Swift model
- `CommandSuggestionView` overlay
- `ComposeBar` integration with `/` trigger detection
- Wire up commands from project data through SessionDetailView

### Phase 3: Image Attachment Infrastructure
- iOS: `ImageCompressor`, `AttachmentPicker`, `CameraCapture`
- Wire protocol: `EncryptedAttachment` in queued prompts (both collabv3 and runtime types)
- Desktop: Decrypt and process attachments from mobile prompts

### Phase 4: ComposeBar Attachment UI
- `+` button with action sheet (Photo Library / Camera / Paste from Clipboard)
- `AttachmentPreviewBar` for thumbnails
- Updated `sendPrompt` flow with attachments
- Info.plist permission strings

---

## Key Files Affected

### CollabV3 Server
- `packages/collabv3/src/IndexRoom.ts` - project_index schema + upsert + broadcast
- `packages/collabv3/src/types.ts` - ProjectIndexEntry extension

### Runtime (Shared)
- `packages/runtime/src/sync/types.ts` - ProjectIndexEntry, SyncedQueuedPrompt, EncryptedAttachment types
- `packages/runtime/src/sync/CollabV3Sync.ts` - Project sync with config, attachment decryption

### Desktop (Electron)
- `packages/electron/src/main/services/SlashCommandService.ts` - Export command list for sync
- `packages/electron/src/main/services/ai/` - Process mobile attachments in queued prompts

### iOS
- `packages/ios/NimbalystNative/Sources/Views/ComposeBar.swift` - Typeahead + attachment UI
- `packages/ios/NimbalystNative/Sources/Views/CommandSuggestionView.swift` - NEW
- `packages/ios/NimbalystNative/Sources/Views/AttachmentPicker.swift` - NEW
- `packages/ios/NimbalystNative/Sources/Views/AttachmentPreviewBar.swift` - NEW
- `packages/ios/NimbalystNative/Sources/Views/CameraCapture.swift` - NEW
- `packages/ios/NimbalystNative/Sources/Utils/ImageCompressor.swift` - NEW
- `packages/ios/NimbalystNative/Sources/Models/SlashCommand.swift` - NEW
- `packages/ios/NimbalystNative/Sources/Sync/SyncProtocol.swift` - Wire types
- `packages/ios/NimbalystNative/Sources/Sync/SyncManager.swift` - Config decryption + attachment send
- `packages/ios/NimbalystNative/Sources/Views/SessionDetailView.swift` - Pass commands to ComposeBar
