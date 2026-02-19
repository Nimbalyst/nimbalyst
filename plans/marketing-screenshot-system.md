---
planStatus:
  planId: plan-marketing-screenshot-system
  title: Marketing Screenshot System for nimbalyst.com
  status: draft
  planType: feature
  priority: high
  owner: ghinkle
  stakeholders: []
  tags:
    - marketing
    - screenshots
    - playwright
    - dark-theme
    - light-theme
  created: "2026-02-18"
  updated: "2026-02-18T00:00:00.000Z"
  progress: 0
---
# Marketing Screenshot System for nimbalyst.com

## Overview

Build a Playwright-based screenshot automation system for the Electron desktop app, modeled after the iOS marketing screenshot system. Screenshots are captured in both **dark and light themes** for use on nimbalyst.com (with a theme toggle feature on the marketing site). The system is fully separate from E2E tests used for testing.

## Architecture

### Inspiration: iOS Screenshot System

The iOS system (`packages/ios/scripts/take-screenshots.sh`) uses:
1. **Launch arguments** (`--screenshot-mode`, `--screenshot-screen=<name>`) to trigger screenshot-specific UI
2. **ScreenshotDataProvider** to populate an in-memory database with realistic demo data (4 projects, 18 sessions, 7 messages)
3. **ScreenshotHostView** to route to the correct screen
4. **Shell script** to automate simulator boot, app install, screenshot capture

### Electron Screenshot System

For the Electron app we'll use a similar pattern but adapted for Playwright:

```
packages/electron/marketing/
  screenshots/               # Output directory for captured PNGs
    dark/                    # Dark theme variants
    light/                   # Light theme variants
  fixtures/                  # Simulated workspace files (documents, code, data)
    workspace/               # Temp workspace structure
  data/                      # Database seed data for AI sessions
    sessions.ts              # Session/message data to inject via IPC/evaluate
  specs/                     # Screenshot capture specs (NOT in e2e/ directory)
    01-hero-files-mode.spec.ts
    02-agent-mode-session.spec.ts
    03-ai-chat-sidebar.spec.ts
    ...
  playwright.marketing.config.ts   # Separate Playwright config
  take-screenshots.sh        # Runner script
  README.md                  # Documentation
```

### Key Design Decisions

1. **Separate from E2E tests**: Own `playwright.marketing.config.ts`, own `specs/` directory, own `npm run` script. Never mixed with functional tests.
2. **Both themes**: Each screenshot is captured twice - once in dark theme, once in light theme. Theme switching via `window.webContents.send('theme-change', 'dark'|'light')`.
3. **Realistic simulated data**: Pre-built workspace with realistic file names, folder structure, and document content. AI sessions injected into the database with realistic messages.
4. **Consistent window size**: Fixed viewport (e.g., 1440x900) for consistent marketing screenshots. Possibly a Retina-scale (2x) option for high-DPI.
5. **Deterministic**: Same screenshot output every run. No timestamps, no random data. Sessions use fixed relative times.

## Screenshot Catalog

### Category 1: Hero / Overview Shots

These are the primary marketing screenshots showing the full app experience.

| # | Name | Description | Mode | Key Content |
| --- | --- | --- | --- | --- |
| 1 | **hero-files-mode** | Full app with file tree, markdown document open, AI chat sidebar visible | Files mode | Rich markdown doc (project README with headings, lists, code blocks, table), file tree with realistic project structure |
| 2 | **hero-agent-mode** | Full app in Agent mode showing session history + active session transcript | Agent mode | Session list with realistic titles, active session showing a multi-turn conversation with tool calls |
| 3 | **hero-multi-editor** | Files mode with multiple tabs open showing different editor types | Files mode | Tabs: markdown, TypeScript, CSV spreadsheet all visible via tab bar |

### Category 2: Editor Types

Showcase the variety of editors and file types Nimbalyst handles.

| # | Name | Description | Mode | Key Content |
| --- | --- | --- | --- | --- |
| 4 | **editor-markdown** | Markdown document in the Lexical rich text editor | Files mode | Well-formatted document with headings, bold, italic, lists, code blocks, links, table, horizontal rule |
| 5 | **editor-code-typescript** | TypeScript file in Monaco editor | Files mode | Clean, realistic TypeScript code (~40 lines) with syntax highlighting, type annotations |
| 6 | **editor-code-python** | Python file in Monaco editor | Files mode | Realistic Python code with type hints, dataclasses |
| 7 | **editor-csv-spreadsheet** | CSV data in RevoGrid spreadsheet editor | Files mode | Tabular data (8-10 rows, 5-6 columns) with varied content |
| 8 | **editor-excalidraw** | Excalidraw diagram | Files mode | Architecture diagram with boxes, arrows, labels (import a mermaid diagram into the file beforehand) |
| 9 | **editor-mockup** | MockupLM HTML mockup in the preview editor | Files mode | A UI mockup (settings panel or dashboard) rendered in the preview |
| 10 | **editor-datamodel** | DataModelLM schema visualization | Files mode | Entity relationship diagram with 3-4 tables and relationships |
| 11 | **editor-json** | JSON configuration file in Monaco | Files mode | Structured config file with nested objects, syntax highlighted |

### Category 3: AI Features

Showcase AI-powered editing and session management.

| # | Name | Description | Mode | Key Content |
| --- | --- | --- | --- | --- |
| 12 | **ai-chat-sidebar** | Files mode with AI chat panel open showing a conversation | Files mode | Right sidebar with multi-turn chat conversation, user prompt + assistant response with code |
| 13 | **ai-agent-transcript** | Agent mode showing rich transcript with tool calls | Agent mode | Session with text messages, Read/Write/Edit tool calls (collapsed and expanded), code output |
| 14 | **ai-diff-review** | File showing pending AI edits with diff approval bar | Files mode | Markdown or code file with green insertions, diff header bar with "Keep All" / "Revert All" buttons, change counter |
| 15 | **ai-session-history** | Agent mode session list showing multiple sessions grouped by time | Agent mode | Session history sidebar with "Today", "Yesterday", "This Week" groups, various session titles, status indicators (executing, unread) |
| 16 | **ai-permission-dialog** | Tool permission confirmation inline widget | Agent mode | Permission prompt showing a Bash command with Allow Once / Allow Always / Deny buttons |
| 17 | **ai-plan-mode** | Plan mode approval widget | Agent mode | ExitPlanMode prompt with plan content and approve/reject options |
| 18 | **ai-ask-user-question** | AskUserQuestion interactive prompt | Agent mode | Question with multiple choice options displayed inline in transcript |

### Category 4: Workspace & Navigation

| # | Name | Description | Mode | Key Content |
| --- | --- | --- | --- | --- |
| 19 | **workspace-file-tree** | File tree with rich project structure | Files mode | Deep folder hierarchy (src/, components/, utils/, tests/), various file types, open folders |
| 20 | **workspace-multiple-tabs** | Tab bar with several open files | Files mode | 5-6 open tabs with different file types, one showing dirty indicator, one showing unread indicator |
| 21 | **workspace-git-panel** | Git operations panel in agent mode | Agent mode | Git panel showing staged files, commit message, smart mode toggle |

### Category 5: Settings & Configuration

| # | Name | Description | Mode | Key Content |
| --- | --- | --- | --- | --- |
| 22 | **settings-general** | Settings view - General panel | Settings mode | App settings with various controls (toggles, dropdowns) |
| 23 | **settings-ai** | Settings view - AI panel | Settings mode | AI provider configuration, model selection |
| 24 | **settings-permissions** | Settings view - Agent Permissions panel | Settings mode | Permission patterns, URL allowlists |
| 25 | **settings-theme** | Settings view - Appearance panel | Settings mode | Theme selector with preview |

### Category 6: Special Features

| # | Name | Description | Mode | Key Content |
| --- | --- | --- | --- | --- |
| 26 | **feature-history-dialog** | Document history dialog (Cmd+Y) | Files mode | History panel showing document revisions with timestamps, preview of selected revision |
| 27 | **feature-search-replace** | Find & Replace bar active | Files mode | Search bar with match count, case/regex toggles, highlighted matches in document |
| 28 | **feature-tracker-header** | Document with status/tracker metadata bar | Files mode | Plan document with status bar showing priority, status, tags fields |
| 29 | **feature-quick-open** | Quick Open dialog (Cmd+P style) | Files mode | File picker overlay with search input and file list |
| 30 | **feature-terminal** | Terminal panel at bottom | Files mode | Bottom panel with terminal showing some command output |

### Category 7: Mobile Companion (stretch)

| # | Name | Description | Notes |
| --- | --- | --- | --- |
| 31 | **mobile-pairing-qr** | QR code pairing screen | If feasible to render this state |

## Simulated Workspace Content

### File Structure
```
marketing-workspace/
  README.md                    # Rich project readme
  CHANGELOG.md                 # Version changelog
  package.json                 # Node project config
  tsconfig.json                # TypeScript config
  src/
    index.ts                   # Main entry point
    server.ts                  # Express/HTTP server
    auth/
      middleware.ts            # Auth middleware
      types.ts                 # Auth types
    api/
      routes.ts                # API route definitions
      handlers.ts              # Request handlers
    utils/
      helpers.ts               # Utility functions
      logger.ts                # Logger module
    models/
      user.ts                  # User model
      project.ts               # Project model
  tests/
    auth.test.ts               # Auth tests
    api.test.ts                # API tests
  data/
    users.csv                  # User data spreadsheet
    config.json                # App configuration
  docs/
    architecture.excalidraw    # Architecture diagram
    api-spec.md                # API documentation
    ui-mockup.mockup.html      # UI mockup
    schema.datamodel           # Database schema
  plans/
    v2-migration.md            # Plan with tracker status bar
  .gitignore
```

### Document Content Quality

Each file needs realistic, professional content that looks like a real project:

- **README.md**: Project name "Acme API Server", description, features list, getting started with code blocks, table of endpoints
- **TypeScript files**: Clean code with interfaces, async functions, error handling, imports
- **CSV**: User/customer data with names, emails, roles, dates
- **Excalidraw**: Pre-built architecture diagram (Client -> API Gateway -> Services -> Database)
- **MockupLM**: Dashboard or settings panel mockup
- **DataModel**: User/Post/Comment schema with relationships
- **Plan doc**: Migration plan with YAML frontmatter and status fields

### AI Session Data

Inject realistic sessions into the database for Agent mode screenshots:

**Session 1 - Active session with transcript** ("Refactor authentication module"):
- User prompt: "Help me refactor the authentication middleware to support both JWT and API key auth"
- Assistant response: explanation + plan
- Tool calls: Read middleware.ts, Write new auth handler, Edit route config
- Tool results with file content
- Follow-up exchange

**Session 2 - Session with diff review** ("Add rate limiting"):
- Shows pending file changes with diff markers

**Session History** (inject 10-15 sessions):
- Varied titles: "Fix database connection pooling", "Add WebSocket support", "Write API documentation", "Optimize query performance", etc.
- Spread across Today, Yesterday, This Week, Older
- Mix of models (claude-sonnet, claude-opus)
- Some with unread indicators, one executing

## Implementation Approach

### Phase 1: Infrastructure
1. Create `packages/electron/marketing/` directory structure
2. Create `playwright.marketing.config.ts` with fixed viewport, output paths
3. Create fixture workspace files with realistic content
4. Create helper utilities for theme switching, screenshot naming, etc.
5. Add `npm run marketing:screenshots` script

### Phase 2: Basic Screenshots (Hero + Editors)
6. Implement hero shots (files mode, agent mode, multi-editor)
7. Implement editor type screenshots (markdown, code, CSV, etc.)
8. Each captures both dark and light variants

### Phase 3: AI Feature Screenshots
9. Build session data injection (sessions + messages into DB)
10. Implement AI transcript screenshots
11. Implement diff review, permission dialog, plan mode screenshots
12. Implement interactive prompt screenshots (AskUserQuestion, etc.)

### Phase 4: Settings & Special Features
13. Settings panel screenshots
14. History dialog, search/replace, quick open, terminal screenshots

### Phase 5: Polish & Automation
15. Runner script with selective capture (`--only=hero`, `--theme=dark`)
16. Documentation
17. CI integration (optional)

## Technical Notes

### Theme Switching
```typescript
// Switch theme via IPC (from theme E2E tests)
await electronApp.evaluate(({ BrowserWindow }) => {
  BrowserWindow.getAllWindows().forEach(window => {
    window.webContents.send('theme-change', 'dark'); // or 'light'
  });
});
```

### Session Data Injection
Sessions can be injected by evaluating JavaScript in the renderer that calls the database APIs, or by using the IPC test helpers to insert sessions and messages directly. The interactive prompt test helpers (`e2e/utils/interactivePromptTestHelpers.ts`) already demonstrate how to:
- Create sessions in the DB
- Insert messages (user prompts, assistant text, tool calls, tool results)
- Insert pending interactive prompts (AskUserQuestion, ToolPermission, etc.)

### Screenshot Naming Convention
```
{name}-{theme}.png
# Examples:
hero-files-mode-dark.png
hero-files-mode-light.png
editor-typescript-dark.png
editor-typescript-light.png
```

### Window Size
- Default: 1440x900 (standard marketing size)
- Retina/HiDPI: Capture at 2x scale for crisp images

### Separate Playwright Config
```typescript
// playwright.marketing.config.ts
export default defineConfig({
  testDir: './marketing/specs',
  outputDir: './marketing/screenshots',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: {
    screenshot: 'off', // We capture manually
    video: 'off',
    trace: 'off',
  },
});
```

## Video Capture System

### Overview

In addition to static screenshots, the system supports capturing **marketing videos** showing the app in use - hero loops, feature walkthroughs, and ambient background videos. Videos are captured using Playwright's built-in recording with a **DOM-injected fake cursor** that shows realistic mouse movement and clicks.

### Why a Fake Cursor

Playwright's `page.click()` operates programmatically - it doesn't move the system cursor. This means:
- **Playwright built-in video**: Records viewport but no cursor visible
- **ffmpeg screen capture**: Records real screen but cursor stays still during Playwright clicks
- **DOM fake cursor**: Fully controlled, smooth animated movement, works in Playwright video

The DOM cursor approach gives us full control over timing, easing, and appearance while being completely automatable with no macOS permissions required.

### Cursor Implementation

A `MarketingCursor` utility injected into the page via `page.evaluate()`:

```typescript
// marketing/utils/cursor.ts

interface CursorOptions {
  /** Duration of movement animation in ms */
  moveDuration?: number;
  /** Easing function: 'ease-in-out' | 'ease-out' | 'linear' */
  easing?: string;
  /** Show click ripple effect */
  showClickEffect?: boolean;
  /** Cursor image: 'arrow' | 'pointer' */
  cursorType?: 'arrow' | 'pointer';
}

/**
 * Inject a fake macOS cursor into the page DOM.
 * Returns control functions for moving, clicking, and hiding.
 */
async function injectCursor(page: Page): Promise<void>

/**
 * Smoothly move the cursor to a target element's center (or offset).
 * Uses CSS transitions with easing for natural-looking movement.
 */
async function moveTo(
  page: Page,
  selector: string,
  options?: { offset?: { x: number; y: number }; duration?: number }
): Promise<void>

/**
 * Move to element then perform a click with a brief ripple animation.
 * Actually clicks the element via Playwright after the visual animation.
 */
async function moveAndClick(
  page: Page,
  selector: string,
  options?: CursorOptions
): Promise<void>

/**
 * Hide the cursor (e.g., during typing sequences).
 */
async function hideCursor(page: Page): Promise<void>

/**
 * Show the cursor again after hiding.
 */
async function showCursor(page: Page): Promise<void>
```

**Visual details:**
- macOS arrow cursor as a small inline SVG (no external assets needed)
- Positioned with `position: fixed; z-index: 999999; pointer-events: none`
- CSS `transition` for smooth movement with `cubic-bezier(0.25, 0.1, 0.25, 1)` easing
- Click effect: subtle expanding circle that fades out (like macOS accessibility click indicator)
- Switches between arrow and pointer cursor image based on hover target (links, buttons)

### Video Types

#### 1. Short Loop (5-10s, GIF/WebM)
Single-feature demonstrations for embedding inline on marketing pages.

| Name | Content | Duration |
| --- | --- | --- |
| **loop-theme-switch** | Click theme toggle, watch colors transition | ~5s |
| **loop-open-file** | Click file in tree, editor loads with content | ~5s |
| **loop-ai-diff** | AI edits appear, user clicks "Keep All" | ~8s |
| **loop-tab-switch** | Click through 3-4 tabs showing different editors | ~6s |
| **loop-excalidraw-draw** | Draw a box and arrow on an Excalidraw canvas | ~8s |

#### 2. Feature Walkthrough (30-60s)
Focused demos of a single major feature.

| Name | Content | Duration |
| --- | --- | --- |
| **walkthrough-ai-coding** | Open file, switch to agent mode, see session with tool calls and file edits, switch back to see diff, accept changes | ~45s |
| **walkthrough-multi-editor** | Open markdown, TypeScript, CSV, Excalidraw in sequence, showing each editor type | ~30s |
| **walkthrough-session-management** | Browse session history, open a session, read transcript, start new session | ~30s |

#### 3. Ambient / Hero Video (15-30s, looping)
Background video for the landing page hero section. Slow, polished, cinematic feel.

| Name | Content | Duration |
| --- | --- | --- |
| **hero-ambient** | Slow pan through: file tree -> open markdown -> AI chat appears -> switch to agent mode -> transcript scrolls -> back to files with diff | ~20s loop |

### Video Capture Pipeline

```
Playwright spec (scripted interactions with cursor)
  ↓
Playwright built-in video recording (WebM)
  ↓
Post-processing with ffmpeg:
  - Trim start/end dead frames
  - Crop to content area (remove title bar if needed)
  - Convert to MP4 (H.264) for web
  - Generate GIF variant for short loops (via gifski for quality)
  - Optionally add subtle motion blur for cinematic feel
  ↓
Output: marketing/videos/{name}-{theme}.{mp4,webm,gif}
```

### Video Spec Structure

Video specs follow the same pattern as screenshot specs but with cursor choreography:

```typescript
// marketing/specs/video-hero-ambient.spec.ts
import { injectCursor, moveAndClick, moveTo } from '../utils/cursor';

test('hero-ambient video', async () => {
  // Start recording
  const video = page.video();

  // Inject fake cursor
  await injectCursor(page);

  // Scene 1: Browse file tree (3s)
  await moveTo(page, '.file-tree-name:has-text("src")');
  await pause(500);
  await moveAndClick(page, '.file-tree-name:has-text("src")');
  await pause(1000);

  // Scene 2: Open a file (3s)
  await moveAndClick(page, '.file-tree-name:has-text("server.ts")');
  await pause(2000); // Let editor load

  // Scene 3: Open AI chat (4s)
  await moveAndClick(page, '[data-testid="ai-chat-toggle"]');
  await pause(3000);

  // Scene 4: Switch to agent mode (4s)
  await moveAndClick(page, '[data-mode="agent"]');
  await pause(3000);

  // ... etc

  // Stop recording - video saved automatically
});
```

### Post-Processing Script

```bash
# marketing/process-videos.sh

# Convert WebM to MP4
ffmpeg -i input.webm -c:v libx264 -crf 20 -preset slow output.mp4

# Generate high-quality GIF (for short loops)
# Using gifski for much better quality than ffmpeg GIF
ffmpeg -i input.webm -vf "fps=15,scale=720:-1" frames/%04d.png
gifski --fps 15 --quality 90 -o output.gif frames/*.png

# Trim dead frames from start/end
ffmpeg -i input.mp4 -ss 0.5 -to 9.5 -c copy trimmed.mp4

# Crop to remove title bar (if needed)
ffmpeg -i input.mp4 -vf "crop=in_w:in_h-38:0:38" cropped.mp4
```

### Implementation Phases (Video)

Video capture builds on the screenshot infrastructure (Phase 1-2) and adds:

**Phase 6: Video Infrastructure**
1. Implement `MarketingCursor` utility (inject, move, click, hide/show)
2. Configure Playwright video recording for marketing specs
3. Create `process-videos.sh` post-processing script

**Phase 7: Video Content**
4. Implement short loop videos (theme switch, open file, AI diff, etc.)
5. Implement feature walkthrough videos
6. Implement hero ambient video

**Phase 8: Video Polish**
7. Tune cursor movement timing and easing
8. Add `--video-only` and `--video=hero-ambient` flags to runner script
9. GIF generation for short loops
