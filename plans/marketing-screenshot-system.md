---
planStatus:
  planId: plan-marketing-screenshot-system
  title: Marketing Screenshot System for nimbalyst.com
  status: completed
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
  updated: "2026-02-20"
  progress: 100
---
# Marketing Screenshot System for nimbalyst.com

## Status: Completed

All phases implemented and tested. 31/31 Playwright tests passing (~4 minutes).

See [docs/MARKETING_SCREENSHOTS.md](/docs/MARKETING_SCREENSHOTS.md) for the complete reference documentation including output inventory, utility APIs, and instructions for adding new screenshots and videos.

## Overview

Playwright-based screenshot and video automation system for the Electron desktop app, modeled after the iOS marketing screenshot system. Screenshots are captured in both **dark and light themes** for use on nimbalyst.com (with a theme toggle feature on the marketing site). Fully separate from E2E tests.

## What Was Built

### Directory Structure
```
packages/electron/marketing/
  playwright.marketing.config.ts   # Separate Playwright config (60s timeout, serial)
  fixtures/workspace/              # "Acme API Server" - 26 realistic project files
  utils/
    helpers.ts                     # App launch, theme switching, file tree navigation
    cursor.ts                      # DOM fake cursor for video (macOS arrow/pointer SVGs)
    sessionData.ts                 # AI session/message injection via IPC
  specs/
    hero-shots.spec.ts             # 3 hero screenshots
    editor-types.spec.ts           # 8 editor type screenshots
    ai-features.spec.ts            # 7 AI feature screenshots
    settings-and-features.spec.ts  # 9 settings/feature screenshots
    video-hero.spec.ts             # Hero ambient video (dark + light, separate app instances)
    video-loops.spec.ts            # 3 short loop videos
  screenshots/{dark,light}/        # Output PNGs (1440x900)
  videos/{dark,light}/             # Output WebMs (Playwright raw)
  take-screenshots.sh              # Runner script with --grep and --list
  process-videos.sh                # ffmpeg WebM -> MP4/GIF conversion
```

### Output: 26 Screenshots x 2 Themes

**Hero Shots:**
- `hero-files-mode.png` - File tree + README + AI chat sidebar
- `hero-agent-mode.png` - Agent mode with session list + transcript
- `hero-multi-editor.png` - Tab bar with multiple file types open

**Editor Types (8):**
- `editor-markdown.png`, `editor-code-typescript.png`, `editor-csv-spreadsheet.png`, `editor-json.png`, `editor-mockup.png`, `editor-datamodel.png`, `editor-excalidraw.png`, `editor-api-spec.png`

**AI Features (7):**
- `ai-chat-sidebar.png`, `ai-agent-transcript.png`, `ai-session-history.png`, `ai-diff-review.png`, `ai-permission-dialog.png`, `ai-ask-user-question.png`, `ai-plan-mode.png`

**Settings (4):**
- `settings-general.png`, `settings-ai.png`, `settings-permissions.png`, `settings-appearance.png`

**Features (4):**
- `feature-tracker-header.png`, `feature-search-replace.png`, `feature-workspace-file-tree.png`, `feature-multiple-tabs.png`

### Output: 5 Video Recordings

- `hero-ambient` dark (~25s) - Cursor browses files, opens editors, switches to agent mode
- `hero-ambient` light (~25s) - Same choreography in light theme
- `loop-open-file` dark (~7s) - Expand folders, click file, editor loads
- `loop-tab-switch` dark (~13s) - Click through editor tabs
- `loop-ai-diff` dark (~3s) - AI edits appear in editor

### Key Design Decisions

1. **Separate from E2E tests**: Own Playwright config, own specs directory, own npm scripts
2. **Both themes**: Each screenshot captured twice via IPC theme switching
3. **Realistic fixture workspace**: "Acme API Server" with TypeScript, CSV, Prisma, MockupLM, Excalidraw, markdown
4. **DOM fake cursor for video**: macOS arrow/pointer SVGs injected into DOM, CSS transitions with easing, click ripple animation - works with Playwright's built-in video recording
5. **Separate app instances for video themes**: Dark and light hero videos use independent app launches so Playwright records to the correct output directory
6. **Auto-expanding file tree**: `openFile()` helper recursively expands collapsed directories to find nested files
7. **Packaged build detection**: `findDevServer()` detects `ELECTRON_RUN_AS_NODE` and gives clear instructions to switch to dev mode

### Running

```bash
cd packages/electron && npm run dev    # start dev server first

npm run marketing:screenshots                         # capture all
npm run marketing:screenshots:grep -- "hero-"         # capture by category
npm run marketing:screenshots:grep -- "video-"        # videos only
bash marketing/process-videos.sh                      # WebM -> MP4/GIF
```

## Implementation Log

### Phase 1: Infrastructure (completed)
- Created `marketing/` directory structure and `playwright.marketing.config.ts`
- Created fixture workspace (26 files: TypeScript API server project)
- Built helper utilities: app launch, theme switching, file navigation, screenshot capture
- Added `npm run marketing:screenshots` scripts to package.json

### Phase 2: Hero + Editor Screenshots (completed)
- 3 hero screenshots (files mode, agent mode, multi-editor)
- 8 editor type screenshots (all supported editor types)
- Both dark and light theme variants

### Phase 3: AI Feature Screenshots (completed)
- Session data injection via `test:insert-session` / `test:insert-message` IPC
- 7 AI feature screenshots: chat sidebar, agent transcript, session history, diff review, permission dialog, ask-user-question, plan mode

### Phase 4: Settings & Features (completed)
- 4 settings screenshots (general, AI, permissions, appearance)
- 4 feature screenshots (tracker header, search/replace, file tree, multiple tabs)

### Phase 5: Runner Script (completed)
- `take-screenshots.sh` with `--grep`, `--list`, `--help` flags
- Dev server detection

### Phase 6: Video Infrastructure (completed)
- DOM fake cursor with macOS SVGs, CSS transitions, click ripple animation
- Playwright locator-based element targeting (supports `:has-text()` and other Playwright selectors)
- `process-videos.sh` for ffmpeg post-processing (WebM -> MP4, optional GIF via gifski)

### Phase 7: Video Content (completed)
- Hero ambient video with full cursor choreography (dark + light, separate app instances)
- 3 short loop videos (open file, tab switch, AI diff)

### Phase 8: Documentation (completed)
- `docs/MARKETING_SCREENSHOTS.md` comprehensive reference
- CLAUDE.md: development commands + documentation reference table entry
- README.md: marketing screenshots section
- Quick start guide for non-developers added to MARKETING_SCREENSHOTS.md

### Bugs Fixed During Implementation
- **File tree expansion**: `openFile()` initially didn't expand collapsed folders; fixed with recursive expansion of all collapsed directories
- **Playwright selector in DOM**: `moveTo()` used `document.querySelector()` with Playwright's `:has-text()` pseudo-selector (not valid CSS); fixed to use Playwright locator for bounding box, pass coordinates to DOM
- **Video theme directory**: Both dark/light videos recorded to `dark/` because they shared one app instance; fixed by splitting into separate `test.describe` blocks with independent app launches
- **Context destruction**: `setTheme()` failed during initial page load; fixed with retry logic and stabilization wait
- **Multiple element selectors**: `waitForSelector('.monaco-editor')` resolved to stale elements from previous tests; fixed by removing explicit waits (tab appearance is sufficient)
- **Tree state bleed**: Light video test toggled expanded folders because dark test left them open; fixed by collapsing all folders between tests
- **Packaged build detection**: Running from packaged Nimbalyst sets `ELECTRON_RUN_AS_NODE` which breaks Electron launch; fixed by stripping env vars and adding clear error message
