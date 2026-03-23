---
planStatus:
  planId: plan-ios-transcript-clickable-links
  title: iOS Transcript Clickable Links
  status: draft
  planType: feature
  priority: medium
  owner: ghinkle
  stakeholders: []
  tags:
    - ios
    - transcript
    - links
    - ux
  created: "2026-03-23"
  updated: "2026-03-23T00:00:00.000Z"
  progress: 0
---
# iOS Transcript Clickable Links

Make links in the iOS app's session transcript interactive: external URLs open in Safari, and file path links navigate to the file in the app's Files tab.

## Current State

The transcript is rendered in a **WKWebView** using the same React `MarkdownRenderer` as the desktop app. The MarkdownRenderer already has:

- `resolveTranscriptFilePathFromHref()` - classifies links as file paths vs external URLs
- `onOpenFile` callback prop - fires when a file path link is clicked
- `target="_blank"` on external links

However, the **iOS transcript \****`main.tsx`***\* does NOT pass \****`onOpenFile`** to `AgentTranscriptPanel`, so file path links are inert. And the WKWebView does not implement `decidePolicyFor:navigationAction:` so `target="_blank"` links also do nothing -- they attempt to navigate within the web view (which fails or replaces the transcript).

## Implementation Plan

### 1. Handle external URL clicks in WKWebView (Swift)

Add `WKUIDelegate` and/or `decidePolicyFor:navigationAction:` to `TranscriptWebView.Coordinator` so that:
- Links with `target="_blank"` open in `SFSafariViewController` or `UIApplication.shared.open(url)`
- Navigation away from the transcript HTML is blocked (the web view should only show `transcript.html`)

**Files**: `TranscriptWebView.swift`

### 2. Wire up `onOpenFile` through the JS bridge

Add a new bridge message type `"open_file"` from JS -> Swift:

**JS side** (`main.tsx`):
```tsx
const handleOpenFile = useCallback((filePath: string) => {
  (window as any).webkit?.messageHandlers?.bridge?.postMessage({
    type: 'open_file',
    filePath,
  });
}, []);

// Pass to AgentTranscriptPanel:
<AgentTranscriptPanel
  ...
  onFileClick={handleOpenFile}
/>
```

**Swift side** (`TranscriptWebView.swift`):
Add `"open_file"` case to the bridge message handler, and surface it via a new callback:
```swift
case "open_file":
    if let filePath = body["filePath"] as? String {
        onOpenFile?(filePath)
    }
```

Add `onOpenFile: ((String) -> Void)?` to `TranscriptWebView` init and `Coordinator`.

**Files**: `main.tsx`, `TranscriptWebView.swift`

### 3. Present file as sheet overlay from SessionDetailView

**Decision: Sheet overlay** -- present the document editor as a `.sheet` over the transcript. User stays in context and can dismiss to return.

When `onOpenFile` fires in `SessionDetailView`:
1. Convert the absolute desktop file path to a relative path by stripping the workspace prefix (see step 5)
2. Query `SyncedDocument` table for a document with matching `relativePath` in the current project
3. If found: present `DocumentEditorView` in a `.sheet`
4. If not found: show a toast "This file is on your Mac and not available on this device"

**Files**: `SessionDetailView.swift`, `TranscriptWebView.swift`

### 4. Handle non-synced file paths with toast

**Decision: Toast message** -- when a file path doesn't match any synced document, show a brief dismissible message.

**Files**: `SessionDetailView.swift`

### 5. Sync workspace path from desktop

**Decision: Sync workspace path** -- add the workspace root path to the project sync payload so iOS can strip it from absolute file paths to derive `relativePath` for matching.

- Add `workspacePath` column to the iOS `Project` GRDB model
- Include workspace path in the CollabV3 project sync data from desktop
- In the file link handler: `relativePath = absolutePath.replacingOccurrences(of: workspacePath + "/", with: "")`

**Files**: `Project.swift` (model), `DatabaseManager.swift` (migration), `SyncProtocol.swift`, desktop sync payload

## Architecture Diagram

```
Transcript WebView (React)
  |
  |-- External URL click --> target="_blank"
  |       |
  |       v
  |   decidePolicyFor:navigationAction (WKNavigationDelegate)
  |       |
  |       v
  |   UIApplication.shared.open(url) -> Safari
  |
  |-- File path click --> onOpenFile(filePath)
          |
          v
      bridge.postMessage({ type: "open_file", filePath })
          |
          v
      Coordinator.userContentController(didReceive:)
          |
          v
      onOpenFile callback -> SessionDetailView
          |
          v
      Strip workspace prefix -> match SyncedDocument.relativePath
          |
          +-- Found: present DocumentEditorView as .sheet
          +-- Not found: show toast "File not available on this device"
```

## Decisions Made

- **File link UX**: Sheet overlay (stays in context, easy dismiss)
- **Non-synced files**: Toast message ("not available on this device")
- **Path matching**: Sync workspace path from desktop, strip prefix for relative path matching
