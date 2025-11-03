---
planStatus:
  planId: plan-browser-extension-web-clipping
  title: Browser Extension for Web Clipping and AI Extraction
  status: in-development
  planType: feature
  priority: medium
  owner: developer
  stakeholders:
    - developer
    - users
  tags:
    - browser-extension
    - web-clipping
    - ai-extraction
    - tracker-integration
  created: "2025-11-02"
  updated: "2025-11-03T03:13:51.525Z"
  startDate: "2025-11-02"
  progress: 50
---
## Implementation Progress

### Browser Extension (Complete)

- [x] Set up browser extension package structure
- [x] Install dependencies (Turndown, build tools)
- [x] Create Chrome manifest.json (v3)
- [x] Implement content script for HTML to markdown conversion
- [x] Implement background service worker
- [x] Create popup UI for quick actions
- [x] Add context menu integration for right-click clipping
- [x] Implement base64 encoding for content
- [x] Handle URL length limits with fallback mechanism
- [x] Create documentation (README, DEVELOPMENT, IMPLEMENTATION_SUMMARY)
- [x] Build and package extension for distribution

### Nimbalyst Integration (Not Started - Phase 2)

The browser extension package is complete. The next phase requires implementing the Nimbalyst app integration:

- [ ] Register `nimbalyst://` protocol handler in Electron
- [ ] Implement protocol URL parser and router
- [ ] Create web-clipping tracker type definition
- [ ] Implement clip document creation with frontmatter
- [ ] Build image downloader service
- [ ] Integrate AI extraction processing
- [ ] Add project selection dialog (multi-project support)
- [ ] Test full end-to-end workflow
- [ ] Test on various websites

**Note**: As requested, only the browser extension package was implemented. The Nimbalyst app changes are documented in the plan but not implemented yet.

# Browser Extension for Web Clipping and AI Extraction

## Goals

- Enable users to clip web pages directly from their browser into Nimbalyst projects
- Support both simple markdown mnversion and AI-powered content extraction
- Integrate with the tracker system to organize web clippings
- Provide a seamless workflow for capturing and processing web content

## Overview

A browser extension (Chrome, Firefox, Safari) that allows users to capture web content and send it to Nimbalyst. The extension will support two primary modes:

1. **Simple Clipping**: Convert the current web page to markdown and save it to the project
2. **AI-Powered Extraction**: Use AI to extract specific information, summarize, or transform content based on user prompts

## Key Components

### Browser Extension

- Popup UI for quick actions
- Content script for extracting page content
- Background script for communication with Nimbalyst
- Context menu integration for right-click clipping

### Nimbalyst Integration

- Custom URL protocol handler (`nimbalyst://`) for receiving clips
- New "web-clipping" tracker type defined as custom tracker YAML
- Full-document tracker items with frontmatter containing clip metadata
- Appears in TrackerBottomPanel table on the web-clipping tab
- Dialog for selecting target project when multiple projects are open

### Content Processing

- HTML to markdown conversion using Turndown library
- Images kept as URL references in markdown
- Nimbalyst downloads images to `.nimbalyst/assets/` folder (using existing ImagePlugin infrastructure)
- Metadata extraction (title, URL, timestamp, author)
- Screenshot capture (optional)
- AI-powered content transformation

## User Workflows

### Simple Web Clipping

1. User clicks extension icon or uses keyboard shortcut
2. Extension extracts page content and converts to markdown
3. If multiple projects open: dialog appears in Nimbalyst to select target project
4. If single project open: automatically clips to frontmost project
5. Content saved to `tracker-items/web-clippings/[page-title].md`
6. Tracker type "web-clipping" automatically added to frontmatter

### AI-Powered Extraction

1. User clicks extension icon and selects "Extract with AI"
2. Popup shows prompt input: "What do you want to extract?"
3. User enters prompt (e.g., "Extract all product names and prices into a table")
4. Extension sends page content + prompt to Nimbalyst
5. Nimbalyst uses AI to process and format the content
6. Result saved as markdown file in web-clippings folder

### Project Selection

**Option A: Automatic**
- Extension communicates with Nimbalyst to get frontmost project
- Clips directly to that project without user interaction

**Option B: User Selection**
- Extension triggers dialog in Nimbalyst
- Dialog shows list of open projects
- User selects target project
- Content saved to selected project

**Decision needed**: Which approach to use, or support both with a preference setting?

## Technical Architecture

### Communication Protocol






**Custom URL Protocol Approach (Recommended)**

- Register `nimbalyst://` custom protocol handler in Electron
- Extension creates `nimbalyst://clip?title=...&content=...&url=...` URLs
- OS-level protocol handling launches/activates Nimbalyst automatically
- Simple, secure, no need for HTTP server or complex native messaging
- Works with bookmarklets and other web integrations too






**For Rich Content (Alternative/Complement)**

- Optional local HTTP server on `localhost:45678` for POST requests with large payloads
- Use when URL length limits exceeded or sending binary data (screenshots)
- Requires HTTP endpoint but no native messaging manifests

Message format includes: page URL, title, content (markdown/HTML), metadata, extraction prompt (optional)

### Files Affected





**Browser Extension:**
- New package: `packages/browser-extension/` (manifest, popup, content script, background)
- Turndown library for HTML to markdown conversion
- Keeps images as URL references (no inline base64)
- Context menu handlers for "Clip to Nimbalyst"

**Nimbalyst Desktop App:**
- `packages/electron/src/main/index.ts` - Register `nimbalyst://` protocol handler
- New protocol handler service for parsing and routing clip requests
- Base64 decoding for content payloads
- Image downloader service (reuse existing ImagePlugin infrastructure)
  - Scans markdown for image URLs
  - Downloads images to `.nimbalyst/assets/`
  - Updates markdown with local image paths
  - Shows progress toast: "Downloading 5 images..."
- Optional page downloader for oversized content fallback
- `.nimbalyst/trackers/web-clipping.yaml` - Custom tracker type definition (per workspace)
- Document creation service to generate markdown files with tracker frontmatter
- Project selection dialog component (if multi-project support)
- AI service integration for content extraction

### Storage Structure





Web clippings are stored as full-document tracker items:

```
[project-root]/
  .nimbalyst/
    web-clippings/
      article-title-2025-11-02.md
      blog-post-2025-11-02.md
```


Web clippings will be visible in the TrackerBottomPanel's table on the web-clipping tab.

Each clipping file includes tracker frontmatter:
```yaml
---
trackerStatus:
  type: web-clipping
  clippingId: clip_01JAB2C3D4E5F6G7H8
  title: "Article Title"
  sourceUrl: "https://example.com/article"
  source: "Browser Extension"
  status: "to-review"
  tags: ["ai", "research"]
  clippedAt: "2025-11-02T14:19:00.000Z"
  created: "2025-11-02"
  updated: "2025-11-02T14:19:00.000Z"
---

# Article Title

Clipped content here...
```





## Tracker Type Definition

The web-clipping tracker type will be defined as a custom tracker YAML file that gets created in each workspace's `.nimbalyst/trackers/` directory:

**File: \****`.nimbalyst/trackers/web-clipping.yaml`**

```yaml
type: web-clipping
displayName: Web Clipping
displayNamePlural: Web Clippings
icon: web
color: "#10b981"
modes:
  inline: false
  fullDocument: true
idPrefix: clip
idFormat: ulid
fields:
  - name: clippingId
    type: string
    required: true
    display: { showInStatusBar: false }
  - name: title
    type: string
    required: true
    display: { showInStatusBar: true, width: "full" }
  - name: sourceUrl
    type: string
    required: true
    display: { showInStatusBar: true, width: "full" }
  - name: source
    type: select
    options: ["Browser Extension", "Bookmarklet", "Manual"]
    default: "Browser Extension"
    display: { showInStatusBar: true }
  - name: status
    type: select
    options: ["to-review", "reviewed", "archived"]
    default: "to-review"
    display: { showInStatusBar: true }
  - name: tags
    type: array
    display: { showInStatusBar: true }
  - name: clippedAt
    type: datetime
    required: true
    display: { showInStatusBar: true }
  - name: created
    type: date
    required: true
    display: { showInStatusBar: false }
  - name: updated
    type: datetime
    required: true
    display: { showInStatusBar: false }
statusBarLayout:
  - fields: ["title"]
  - fields: ["sourceUrl", "source", "status"]
  - fields: ["tags", "clippedAt"]
tableView:
  columns: ["title", "sourceUrl", "status", "tags", "clippedAt"]
  defaultSort: { field: "clippedAt", direction: "desc" }
```

**What this enables:**
- Full-document mode only (not inline tracker items)
- Status bar at top of document showing metadata
- Web-clipping tab in TrackerBottomPanel showing all clippings in a table
- Green color (#10b981) to distinguish from other types
- Searchable and filterable like other tracker items

## Open Questions

1. **Project selection mechanism**: Automatic to frontmost vs. user dialog vs. preference setting?
2. **Extension permissions**: Which permissions are acceptable to users (storage, tabs, activeTab, etc.)?
3. **Authentication**: Local trust (custom protocol opens Nimbalyst directly, no auth needed)
4. **Offline support**: Should clippings queue when Nimbalyst isn't running? (URL opens would launch app automatically)
5. **Browser support priority**: Start with Chrome only, or multi-browser from the start? → Chrome to start
6. **Screenshot inclusion**: Optional screenshot capture alongside markdown? → Interesting idea, worth exploring
7. **URL length limits**: At what content size do we need to fall back to HTTP POST instead of URL parameters?
8. **Auto-create tracker YAML**: Should Nimbalyst auto-create `.nimbalyst/trackers/web-clipping.yaml` on first clip, or require manual setup?

## Acceptance Criteria

- Extension can clip current web page to markdown in Nimbalyst project
- Web clippings appear in tracker system with "web-clipping" type
- Extension can send AI extraction prompts to Nimbalyst
- AI-extracted content is properly formatted and saved
- User can identify which project receives the clipped content
- Extension works reliably across common websites
- Metadata (URL, title, timestamp) is preserved with each clipping
- Images are downloaded and stored locally in `.nimbalyst/assets/`
- Markdown is updated with local image paths after download



## Implementation Notes

### Base64 Encoding Approach

The communication protocol will use base64-encoded content in URLs:

**Why base64 encoding:**
- **Preserves authenticated sessions**: Extension clips logged-in content (paywalls, private pages)
- **Supports text selections**: Clip only highlighted portions of a page
- **Captures dynamic content**: Extension has full JS-rendered DOM
- **No size issues for typical content**: Most articles (50-100KB markdown) encode to 67-134KB base64, well under 2MB URL limit
- **Simple architecture**: No HTTP server, no native messaging, just URL protocol

**Fallback for oversized content:**
- If encoded content > 1.5MB, send URL only with `downloadFull=true` flag
- Nimbalyst downloads the page server-side (loses authentication but handles size)
- Display warning: "Large content downloaded without authentication - some content may be missing"

### HTML to Markdown Conversion

The extension uses the **Turndown** library to convert HTML to markdown:

```javascript
// Content script
import TurndownService from 'turndown';

function convertPageToMarkdown() {
  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
  });

  // Images kept as URL references (Nimbalyst will download them)
  turndown.addRule('images', {
    filter: 'img',
    replacement: (content, node) => {
      const src = node.getAttribute('src');
      const alt = node.getAttribute('alt') || '';

      // Convert relative URLs to absolute
      const absoluteSrc = new URL(src, window.location.href).href;
      return `![${alt}](${absoluteSrc})`;
    }
  });

  return turndown.turndown(document.body);
}
```

### Chrome Extension Example

```javascript
chrome.contextMenus.onClicked.addListener((info, tab) => {
  // Get markdown from content script
  chrome.tabs.sendMessage(tab.id, { action: 'getMarkdown' }, (response) => {
    const markdown = response.markdown; // Contains image URLs
    const selection = info.selectionText || null;

    // Base64 encode content
    const contentB64 = btoa(unescape(encodeURIComponent(markdown)));
    const selectionB64 = selection ? btoa(unescape(encodeURIComponent(selection))) : null;

    // Check size (1.5MB threshold)
    if (contentB64.length > 1500000) {
      // Fallback: send URL only
      const url = `nimbalyst://clip?${new URLSearchParams({
        url: tab.url,
        title: tab.title,
        downloadFull: 'true'
      })}`;
      chrome.tabs.create({ url });
    } else {
      // Send base64-encoded content with image URLs
      const params = { url: tab.url, title: tab.title, content: contentB64 };
      if (selectionB64) params.selection = selectionB64;

      const url = `nimbalyst://clip?${new URLSearchParams(params)}`;
      chrome.tabs.create({ url });
    }
  });
});
```

### Protocol Handler (Nimbalyst)

```typescript
// In packages/electron/src/main/index.ts
app.setAsDefaultProtocolClient('nimbalyst');

app.on('open-url', (event, url) => {
  event.preventDefault;
  handleNimbalystURL(url);
});

async function handleNimbalystURL(url: string) {
  const parsed = new URL(url);
  if (parsed.hostname === 'clip') {
    const params = Object.fromEntries(parsed.searchParams);

    // Decode base64 content
    const markdown = params.content ? Buffer.from(params.content, 'base64').toString('utf-8') : null;
    const selection = params.selection ? Buffer.from(params.selection, 'base64').toString('utf-8') : null;

    // Create clip document with tracker frontmatter
    const clipPath = await createWebClipDocument({
      title: params.title,
      content: markdown,
      selection: selection,
      sourceUrl: params.url,
      downloadFull: params.downloadFull === 'true',
    });

    // Download images in background (reuse ImagePlugin infrastructure)
    if (markdown) {
      const imageUrls = extractImageUrls(markdown);
      if (imageUrls.length > 0) {
        showToast(`Downloading ${imageUrls.length} images...`);
        await downloadAndReplaceImages(clipPath, markdown, imageUrls);
        showToast(`Clip saved with ${imageUrls.length} images`);
      }
    }
  }
}

function extractImageUrls(markdown: string): string[] {
  const regex = /!\[.*?\]\((https?:\/\/[^\)]+)\)/g;
  const urls: string[] = [];
  let match;
  while ((match = regex.exec(markdown)) !== null) {
    urls.push(match[1]);
  }
  return urls;
}

async function downloadAndReplaceImages(filePath: string, markdown: string, imageUrls: string[]) {
  // Download each image to .nimbalyst/assets/
  // Replace URLs in markdown with local paths
  // Use existing ImagePlugin download infrastructure
  // Save updated markdown back to file
}
```

## Future Enhancements

- Highlight selection clipping (clip only selected text)
- Tag suggestions based on page content
- Batch clipping of multiple tabs
- Browser bookmark sync
- Reading list integration
- Annotation support before clipping
- Bookmarklet support using same `nimbalyst://` protocol
