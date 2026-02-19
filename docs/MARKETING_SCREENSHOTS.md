# Marketing Screenshots & Video Capture

Playwright-based system for capturing marketing assets for nimbalyst.com. Separate from E2E tests - these use simulated data and are optimized for visual quality, not functional testing.

## Architecture

Modeled after the iOS marketing screenshot system (`ScreenshotDataProvider.swift`). Key differences: uses Playwright instead of XCTest, injects data via IPC instead of in-memory DB, includes video capture with a DOM fake cursor.

```
packages/electron/marketing/
  playwright.marketing.config.ts   # Separate Playwright config (60s timeout, serial)
  fixtures/workspace/              # "Acme API Server" - realistic project files
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

## Running

Requires the dev server on port 5273:

```bash
cd packages/electron && npm run dev    # in one terminal

# Capture everything (31 tests, ~4 minutes)
npm run marketing:screenshots

# Capture by category
npm run marketing:screenshots:grep -- "hero-"
npm run marketing:screenshots:grep -- "editor-"
npm run marketing:screenshots:grep -- "ai-"
npm run marketing:screenshots:grep -- "settings-"
npm run marketing:screenshots:grep -- "feature-"
npm run marketing:screenshots:grep -- "video-"

# Or use the shell script
bash marketing/take-screenshots.sh
bash marketing/take-screenshots.sh --grep=hero
bash marketing/take-screenshots.sh --list
```

## Output Inventory

All screenshots are captured in both `dark/` and `light/` themes. Filenames are identical between themes - swap the directory for theme toggle on the marketing site.

### Screenshots (26 images x 2 themes = 52 PNGs)

**Hero Shots** - full app compositions for landing page:

| File | Content |
| --- | --- |
| `hero-files-mode.png` | File tree + README in editor + AI chat sidebar |
| `hero-agent-mode.png` | Agent mode with session list + transcript |
| `hero-multi-editor.png` | Tab bar with multiple file types open (README, TS, CSV, JSON) |

**Editor Types** - one per supported editor:

| File | Content |
| --- | --- |
| `editor-markdown.png` | Rich markdown (README.md) in Lexical |
| `editor-code-typescript.png` | TypeScript in Monaco |
| `editor-csv-spreadsheet.png` | CSV data in RevoGrid spreadsheet |
| `editor-json.png` | JSON config in Monaco |
| `editor-mockup.png` | MockupLM HTML preview |
| `editor-datamodel.png` | Prisma schema in DataModelLM |
| `editor-excalidraw.png` | Excalidraw diagram |
| `editor-api-spec.png` | Markdown API docs in Lexical |

**AI Features**:

| File | Content |
| --- | --- |
| `ai-chat-sidebar.png` | Files mode with AI chat panel open |
| `ai-agent-transcript.png` | Agent mode showing tool calls and responses |
| `ai-session-history.png` | Session list with multiple past sessions |
| `ai-diff-review.png` | File with pending AI edits (diff markers) |
| `ai-permission-dialog.png` | Tool permission confirmation widget |
| `ai-ask-user-question.png` | Interactive question widget with options |
| `ai-plan-mode.png` | Plan approval widget |

**Settings**:

| File | Content |
| --- | --- |
| `settings-general.png` | General settings panel |
| `settings-ai.png` | AI configuration panel |
| `settings-permissions.png` | Agent permissions panel |
| `settings-appearance.png` | Theme/appearance panel |

**Features**:

| File | Content |
| --- | --- |
| `feature-tracker-header.png` | Document with status/tracker header bar |
| `feature-search-replace.png` | Find & Replace bar active |
| `feature-workspace-file-tree.png` | Expanded project file tree |
| `feature-multiple-tabs.png` | Tab bar with several open files |

### Videos

Raw output is WebM with hashed filenames (Playwright default). Run `process-videos.sh` to convert to named MP4/GIF files.

| Spec | Theme | Duration | Content |
| --- | --- | --- | --- |
| `hero-ambient` | dark + light | ~25s each | Cursor browses file tree, opens files, switches to agent mode, views session, returns |
| `loop-open-file` | dark | ~7s | Expand folders, click file, editor loads |
| `loop-tab-switch` | dark | ~13s | Click through editor tabs (README, TS, CSV, JSON) |
| `loop-ai-diff` | dark | ~3s | AI edits appear in editor |

## Importing into the Marketing Website

For a dark/light theme toggle, reference both variants by swapping the directory:

```
screenshots/dark/hero-files-mode.png   # shown when user selects dark
screenshots/light/hero-files-mode.png  # shown when user selects light
```

For videos, the hero ambient has both dark and light versions in their respective directories. Loop videos are dark-only (can be used regardless of site theme or duplicated for light if needed).

## Fixture Workspace

The `fixtures/workspace/` directory contains a realistic "Acme API Server" project:

- `src/` - TypeScript source (Express server, auth middleware, API handlers, models)
- `data/` - Sample data (users.csv, config.json)
- `docs/` - Documentation (api-spec.md, schema.prisma, ui-mockup.mockup.html, architecture.excalidraw)
- `tests/` - Test files (auth.test.ts, api.test.ts)
- `plans/` - Plan doc with YAML frontmatter (v2-migration.md)
- Root files: README.md, package.json, tsconfig.json, CHANGELOG.md

This workspace is copied to a temp directory for each test run to avoid mutations.

## Key Utilities

### helpers.ts

- `launchMarketingApp(options?)` - Launch Electron with fixture workspace, dev server check, initial theme
- `captureScreenshotBothThemes(app, page, name)` - Capture dark + light to `screenshots/{theme}/{name}.png`
- `setTheme(app, theme)` - Switch theme via IPC with retry on context destruction
- `openFile(page, fileName)` - Auto-expands collapsed directories to find the file
- `expandFolder(page, folderName)` - Expand a specific folder (checks aria-expanded)
- `switchToAgentMode/switchToFilesMode/switchToSettings(page)` - Mode switching
- `openAIChatSidebar(page)` - Toggle AI chat panel

### cursor.ts (video only)

DOM-injected fake macOS cursor for video capture. Playwright clicks don't move the system cursor, so this creates a visible cursor element.

- `injectCursor(page)` - Add cursor div + click effect + styles
- `moveTo(page, selector, options?)` - CSS transition movement with easing, auto arrow/pointer switch
- `moveAndClick(page, selector, options?)` - Move + click ripple + actual Playwright click
- `hideCursor/showCursor/resetCursor(page)` - Visibility control

Uses Playwright locators for element targeting (supports `:has-text()` etc.), passes coordinates to DOM for animation.

### sessionData.ts

Injects AI session data via `test:insert-session` and `test:insert-message` IPC handlers:

- `populateMarketingSessions(page, workspacePath)` - Creates 12 sessions with a primary session containing full transcript (user prompt, assistant plan, Read/Write tool calls with results)
- `insertAskUserQuestion/insertToolPermission/insertExitPlanMode(page, sessionId, ...)` - Interactive prompt injection

## Adding New Screenshots

1. Choose the appropriate spec file (or create a new one)
2. Add a test that sets up the desired UI state
3. Call `captureScreenshotBothThemes(electronApp, page, 'my-screenshot-name')`
4. Run with `npm run marketing:screenshots:grep -- "my-screenshot"` to verify
5. Update this doc's output inventory

## Adding New Videos

1. Add to `video-hero.spec.ts` or `video-loops.spec.ts` (or create a new spec)
2. Use `injectCursor` + `moveTo`/`moveAndClick` for choreography
3. For a new theme variant, use a separate `test.describe` block with its own `launchMarketingApp({ recordVideo: true, theme: '...' })`
4. Run with `npm run marketing:screenshots:grep -- "my-video"` to verify
5. Update `process-videos.sh` if adding new named output files
