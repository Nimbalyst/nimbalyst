---
planStatus:
  planId: plan-external-links-browser
  title: Open External Links in Default Browser
  status: completed
  planType: feature
  priority: medium
  owner: developer
  stakeholders:
    - developer
  tags:
    - links
    - electron
    - ux
  created: "2025-11-06"
  updated: "2025-11-07T04:36:00.000Z"
  progress: 100
---
# Open External Links in Default Browser

Test Link: [Nimbalyst](https://github.com/nimbalyst/nimbalyst)

## Goals

- Intercept link clicks from the Lexical LinkPlugin
- Distinguish between internal (document links) and external (HTTP/HTTPS) links
- Open external links in the user's default OS browser
- Keep internal links functioning within the editor

## Problem Description

Currently, when users click on links in markdown documents, all links are handled by the Electron app's webview. For external website links (e.g., https://example.com), this creates a poor user experience as users expect these to open in their default browser (Safari, Chrome, etc.).

## Approach

### 1. Link Click Interception

Since the rexical LinkPlugin is a shared dependency that doesn't know about Electron, we need to intercept link clicks at the Electron app level using a global click handler:
- Add a `document.addEventListener('click')` handler in App.tsx
- Check if the clicked element is a link (`<a>` tag)
- Determine if it's an external link (starts with http:// or https://)
- Prevent default behavior for external links
- Call `window.electronAPI.openExternal(url)` to open in default browser

### 2. External Link Detection

External links are identified as:
- Starting with `http://` or `https://`
- Pointing to domains outside the app (not file:// or internal routes)

Internal links that should remain in-app:
- Relative links (./file.md, ../other.md)
- Anchor links (#section)
- File protocol links (file://)

### 3. IPC Communication

Use the existing IPC channel for opening URLs in default browser:
- `window.electronAPI.openExternal(url)` already exists in preload (line 508)
- IPC handler `open-external` already implemented in WindowHandlers.ts
- Handler properly uses `shell.openExternal()` with URL validation

## Key Files to Modify

- **packages/electron/src/renderer/App.tsx** - Add global click event handler in useEffect
- **packages/electron/src/preload/index.ts** - Already has `openExternal()` method (line 508)
- **packages/electron/src/main/ipc/WindowHandlers.ts** - Already has `open-external` handler

## Acceptance Criteria

- Clicking an external link (https://github.com) opens in default browser
- Clicking an internal markdown link (./other.md) navigates within the app
- Clicking anchor links (#section) scrolls within the document
- No security vulnerabilities (validate URLs before opening)
- Works consistently across macOS, Windows, and Linux

## Security Considerations

- Validate URLs before passing to `shell.openExternal()`
- Prevent opening dangerous protocols (file://, javascript:, etc.)
- Only allow http:// and https:// to open externally

## Testing

- Test with various link types (http, https, relative, anchor)
- Test on different operating systems
- Verify no XSS vulnerabilities from malicious URLs
