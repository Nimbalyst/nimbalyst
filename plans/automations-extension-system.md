---
planStatus:
  planId: plan-automations-extension-system
  title: Automations Extension System
  status: draft
  planType: feature
  priority: medium
  owner: ghinkle
  stakeholders: []
  tags: [extensions, automation, scheduling, ai]
  created: "2026-02-20"
  updated: "2026-02-20T00:00:00.000Z"
  progress: 0
---

# Automations Extension System

## Overview

A file-based automation system for Nimbalyst, implemented as a **Nimbalyst extension** (`packages/extensions/automations/`). Users create markdown files with YAML frontmatter that define schedules and behavior, and the extension manages scheduling, execution, and output.

**Example use case:** Run a script every weekday at 9:25am (5 min before standup) that collects what the user accomplished since the previous standup and writes a summary.

## Core Concepts

### Automation Files

An automation is a `.md` file in `nimbalyst-local/automations/` with frontmatter that describes the schedule and configuration, and a markdown body that serves as the **prompt** (the instructions for the AI agent).

```markdown
---
automationStatus:
  id: standup-summary
  title: Daily Standup Summary
  enabled: true
  schedule:
    type: weekly           # "interval" | "daily" | "weekly"
    days: [mon, tue, wed, thu, fri]
    time: "09:25"          # 24h local time
  output:
    mode: append           # "new-file" | "append" | "replace"
    location: nimbalyst-local/automations/standup-summary/  # folder for output
    fileNameTemplate: "{{date}}-standup.md"   # only used in new-file mode
  lastRun: "2026-02-19T09:25:00.000Z"
  nextRun: "2026-02-20T09:25:00.000Z"
  runCount: 42
---

# Standup Summary

Collect my accomplishments since the last standup. Look at:
- Recent git commits in this workspace
- Files I modified
- AI sessions I completed
- Any tracker items I closed

Summarize in a brief, conversational format suitable for a standup meeting.
```

### Schedule Types

| Type | Fields | Description |
|------|--------|-------------|
| `interval` | `intervalMinutes` | Run every N minutes while Nimbalyst is open |
| `daily` | `time` | Run once daily at the specified time |
| `weekly` | `days`, `time` | Run on specific days at the specified time |

### Output Modes

| Mode | Behavior |
|------|----------|
| `new-file` | Creates a new file for each run using `fileNameTemplate` |
| `append` | Appends to a single output file (with date headers) |
| `replace` | Overwrites a single output file each run |

### Directory Structure

```
nimbalyst-local/
  automations/
    standup-summary.md          # automation definition
    standup-summary/            # output folder (same name as file, no .md)
      2026-02-19-standup.md     # output from new-file mode
      2026-02-20-standup.md
    weekly-report.md            # another automation
    weekly-report/
      output.md                 # single file for append/replace mode
```

## Architecture

### Extension Structure

The entire system lives in `packages/extensions/automations/`:

```
packages/extensions/automations/
  manifest.json                    # Extension manifest
  src/
    index.ts                       # activate() / deactivate(), AI tools
    scheduler/
      AutomationScheduler.ts       # Timer management, discovery, execution
      scheduleUtils.ts             # Next-run calculation, cron-like logic
    frontmatter/
      types.ts                     # AutomationStatus types
      parser.ts                    # Parse/update automation frontmatter
    components/
      AutomationDocumentHeader.tsx # Document header component
    output/
      OutputWriter.ts              # Write results in new-file/append/replace modes
  claude-plugin/                   # Claude Agent SDK plugin
    commands/
      automation.md                # /automation command
  dist/                            # Built output
```

### How Extension Capabilities Map to Requirements

| Requirement | Extension Capability |
|-------------|---------------------|
| Document header UI | `contributions.documentHeaders` + exported component |
| Schedule management | `activate()` hook sets up `setTimeout` chains |
| File discovery | `services.filesystem.findFiles('nimbalyst-local/automations/*.md')` |
| Read/write automation files | `services.filesystem.readFile/writeFile` |
| Write output files | `services.filesystem.writeFile` |
| Notifications | `services.ui.showInfo/showWarning/showError` |
| Settings panel | `contributions.settingsPanel` for global config |
| New file menu | `contributions.newFileMenu` |
| AI tools for management | `aiTools` contribution |
| Claude commands | `contributions.claudePlugin` |
| Persistent config | `ExtensionStorage` (workspace + global) |

### 1. Extension Manifest

```json
{
  "id": "com.nimbalyst.automations",
  "name": "Automations",
  "version": "1.0.0",
  "description": "Schedule recurring AI-powered tasks",
  "author": "Nimbalyst",
  "main": "dist/index.js",
  "apiVersion": "1.0.0",
  "permissions": {
    "filesystem": true,
    "ai": true
  },
  "contributions": {
    "documentHeaders": [
      {
        "id": "automation-header",
        "filePatterns": ["*/nimbalyst-local/automations/*.md"],
        "displayName": "Automation Schedule",
        "component": "AutomationDocumentHeader",
        "priority": 100
      }
    ],
    "newFileMenu": [
      {
        "extension": ".md",
        "displayName": "Automation",
        "icon": "auto_mode",
        "defaultContent": "---\nautomationStatus:\n  id: new-automation\n  title: New Automation\n  enabled: false\n  schedule:\n    type: daily\n    time: \"09:00\"\n  output:\n    mode: new-file\n    location: nimbalyst-local/automations/new-automation/\n    fileNameTemplate: \"{{date}}-output.md\"\n  runCount: 0\n---\n\n# New Automation\n\nDescribe what this automation should do...\n"
      }
    ],
    "aiTools": [
      "automations.list",
      "automations.run",
      "automations.create"
    ],
    "settingsPanel": {
      "component": "AutomationSettings",
      "title": "Automations",
      "icon": "auto_mode"
    },
    "claudePlugin": {
      "path": "claude-plugin",
      "displayName": "Automation Tools",
      "description": "Create and manage scheduled automations",
      "enabledByDefault": true,
      "commands": [
        {
          "name": "automation",
          "description": "Create or manage an automation"
        }
      ]
    }
  }
}
```

### 2. Scheduler (`activate()` hook)

The scheduler initializes in the extension's `activate()` function and manages timers in the renderer process:

```typescript
// src/index.ts
export async function activate(context: ExtensionContext) {
  const scheduler = new AutomationScheduler(context.services);

  // Discover and schedule all automations
  await scheduler.initialize();

  // Re-scan periodically for file changes (automations added/removed/edited)
  const pollInterval = setInterval(() => scheduler.rescan(), 30_000);

  context.subscriptions.push({
    dispose: () => {
      clearInterval(pollInterval);
      scheduler.dispose();
    }
  });
}
```

**`AutomationScheduler`:**
- On `initialize()`: calls `services.filesystem.findFiles('nimbalyst-local/automations/*.md')`, parses frontmatter, sets up `setTimeout` for each enabled automation
- Uses `setTimeout` chains (not `setInterval`) - after each run, calculates next run time
- On `rescan()`: re-reads automation files, adds/removes/updates timers for changed schedules
- On timer fire: reads the automation file, extracts the markdown body, triggers execution

### 3. AI Session Execution

**This is the gap in the current extension SDK.** Extensions can register AI tools (Claude calls the extension), but cannot currently *create* AI sessions (the extension calls the AI). We need one of these approaches:

**Option A: New `services.ai.sendPrompt()` API (recommended)**

Add a new method to `ExtensionAIService`:

```typescript
interface ExtensionAIService {
  // Existing
  registerTool(tool: ExtensionAITool): Disposable;
  registerContextProvider(provider: ExtensionContextProvider): Disposable;

  // NEW: Create and send a prompt to an AI session
  sendPrompt(options: {
    prompt: string;
    sessionName?: string;
    sessionType?: string;       // 'automation'
    provider?: 'claude-code' | 'claude';
  }): Promise<{
    sessionId: string;
    response: string;
  }>;
}
```

This would be backed by an IPC handler that calls `AIService.processQueuedPrompt()` in the main process. The extension SDK surface stays clean, and the extension doesn't need to know about the internal session/queued-prompt machinery.

**Option B: Use Claude Plugin commands**

The extension's `claudePlugin` contribution provides `/automation` as a Claude Code command. When an automation fires, the scheduler could use `services.ai.sendPrompt()` (same as Option A) but with the prompt wrapped in the context of the automation command. This provides the AI with structured instructions about output format and location.

**Option C: IPC passthrough**

Add a generic `services.ipc.invoke(channel, ...args)` to the extension SDK. More flexible but less safe - would need allowlisting of channels.

**Recommendation: Option A.** It's the smallest, most purposeful API addition. The implementation on the main process side can use the existing `processQueuedPrompt()` pattern.

### 4. Document Header: `AutomationDocumentHeader`

Registered via `contributions.documentHeaders` in the manifest with `filePatterns: ["*/nimbalyst-local/automations/*.md"]`. The `ExtensionDocumentHeaderBridge` handles registration with `DocumentHeaderRegistry` automatically.

The component receives standard `DocumentHeaderComponentProps`:
- `getContent()` to read current frontmatter
- `contentVersion` to react to external changes
- `onContentChange()` to update frontmatter when user toggles/edits settings

**UI Elements:**
- **Enable/Disable toggle** - turns automation on/off
- **Schedule summary** - human-readable display (e.g., "Weekdays at 9:25 AM")
- **Schedule editor** - type selector, day-of-week chips, time picker
- **Output config** - mode selector, output path, file name template
- **Status area** - last run timestamp + status, next run, run count
- **"Run Now" button** - manually triggers via scheduler

**Note:** The "Run Now" button needs a way to call back into the scheduler. Since the document header component and the scheduler both live in the extension, they can share state via a module-level reference or event emitter within the extension bundle.

### 5. New File Menu

The manifest `newFileMenu` contribution adds "Automation" to the New File menu. However, `newFileMenu` currently creates files in the current directory. For automations, we want files created in `nimbalyst-local/automations/`. This could be handled by:

1. Using the `newFileMenu` contribution as-is (user navigates to automations folder first)
2. Adding an AI tool `automations.create` that creates the file in the right location
3. The `/automation` Claude command creates files in the right place

Option 2+3 are the most ergonomic. The `newFileMenu` entry is still useful as a secondary path.

## Implementation Plan

### Phase 1: Extension Scaffold + Document Header

1. **Scaffold the extension** - `manifest.json`, `src/index.ts`, build config
2. **Define types** - `AutomationStatus`, `AutomationSchedule`, `AutomationOutput` in `src/frontmatter/types.ts`
3. **Build frontmatter parser** - Parse `automationStatus` from markdown, update it back
4. **Build `AutomationDocumentHeader`** - React component with schedule controls, toggle, status display
5. **Register via manifest** - `documentHeaders` contribution with `filePatterns`
6. **Build and install** - Verify the header renders when opening an automation file

### Phase 2: Scheduler

7. **Build `AutomationScheduler`** - Discovery, timer management, rescan
8. **Implement `scheduleUtils.ts`** - Next-run calculation for interval/daily/weekly
9. **Wire up `activate()`** - Initialize scheduler on extension load
10. **Add "Run Now" from header** - Connect header button to scheduler

### Phase 3: Execution + New SDK Capability

11. **Add `services.ai.sendPrompt()` to extension SDK** - Type definitions
12. **Implement IPC handler** - `automation:send-prompt` backed by `AIService.processQueuedPrompt()`
13. **Wire into ExtensionLoader** - Provide the new API to extensions that have `permissions.ai`
14. **Build `OutputWriter`** - new-file, append, replace modes using `services.filesystem.writeFile`
15. **Connect scheduler to AI** - On timer fire, read prompt, call `sendPrompt()`, write output
16. **Update frontmatter after run** - `lastRun`, `nextRun`, `runCount`, `lastRunStatus`

### Phase 4: AI Tools + Commands

17. **Build AI tools** - `automations.list`, `automations.run`, `automations.create`
18. **Build Claude plugin** - `/automation` command for creating/managing automations
19. **Build settings panel** - Global automation settings (missed run policy, default provider)

### Phase 5: Polish

20. **Run notifications** - Toast when automations complete via `services.ui.showInfo()`
21. **Run history** - Track last N runs in extension storage
22. **Missed run handling** - Check `lastRun` vs schedule on extension activate, optionally run missed
23. **Error display** - Show errors in document header status area

## Design Decisions

### Why file-based (not database)?

- Users can version control their automations with git
- Easy to share, copy, and modify
- Consistent with the Nimbalyst philosophy of files as the source of truth
- The prompt/instructions are naturally part of the file (markdown body)
- Frontmatter provides structured metadata while staying human-readable

### Why a dedicated document header (not generic frontmatter)?

The generic frontmatter header shows raw fields. The automation header provides:
- A toggle switch instead of a boolean checkbox
- Day-of-week picker chips instead of a text array
- Time picker instead of a text field
- Human-readable schedule summary
- "Run Now" button
- Status indicators

### Why an extension?

- **Modularity** - can be enabled/disabled per workspace
- **Follows existing patterns** - 13 extensions already exist with the same structure
- **Natural fit** - the extension SDK already supports document headers, AI tools, settings panels, new file menu, and Claude plugins
- **Clean separation** - automation logic doesn't add to core bundle size
- **SDK improvement** - the one new capability needed (`services.ai.sendPrompt()`) benefits other extensions too

### Document header detection: file patterns vs frontmatter

The `ExtensionDocumentHeaderBridge` currently matches by **file path pattern** (e.g., `*.astro`), not by frontmatter content. For automations, we use `*/nimbalyst-local/automations/*.md` as the pattern. This means:

- Any `.md` file in the automations folder gets the header (even without proper frontmatter)
- The header component itself checks for valid `automationStatus` and renders nothing if missing
- This is the same approach used by the Astro extension

An alternative would be enhancing the bridge to support content-based matching (like the built-in `TrackerDocumentHeader` does), but the path-based approach is simpler and sufficient for now since automations have a dedicated directory.

## New SDK Capability: `services.ai.sendPrompt()`

### Extension SDK Side

```typescript
// In ExtensionAIService
interface ExtensionAIService {
  registerTool(tool: ExtensionAITool): Disposable;
  registerContextProvider(provider: ExtensionContextProvider): Disposable;

  /** Create an AI session and send a prompt. Returns when the session completes. */
  sendPrompt(options: SendPromptOptions): Promise<SendPromptResult>;
}

interface SendPromptOptions {
  /** The prompt text to send */
  prompt: string;
  /** Session display name (default: "Extension: {extensionName}") */
  sessionName?: string;
  /** Provider to use (default: 'claude-code') */
  provider?: 'claude-code' | 'claude';
  /** Custom session metadata */
  metadata?: Record<string, string>;
}

interface SendPromptResult {
  /** The session ID that was created */
  sessionId: string;
  /** The AI's response text */
  response: string;
  /** Whether the session completed successfully */
  success: boolean;
  /** Error message if success is false */
  error?: string;
}
```

### Main Process Side

Implementation in `ExtensionHandlers.ts` or a new `ExtensionAIBridge.ts`:

```typescript
safeHandle('extension:send-prompt', async (_event, extensionId: string, options: SendPromptOptions) => {
  // Validate extension has ai permission
  // Create session via AIService
  // Insert queued prompt
  // Process and await completion
  // Return response text
});
```

This reuses the existing `AIService.processQueuedPrompt()` infrastructure. The extension never directly touches PGLite or `AIService` - it goes through the SDK.

## Frontmatter Schema (TypeScript)

```typescript
interface AutomationStatus {
  id: string;                    // unique identifier (kebab-case)
  title: string;                 // human-readable name
  enabled: boolean;              // whether the automation is active

  schedule: AutomationSchedule;
  output: AutomationOutput;
  provider?: 'claude-code' | 'chat';  // default: 'claude-code' (full tool access)

  lastRun?: string;              // ISO 8601 timestamp
  lastRunStatus?: 'success' | 'error';
  lastRunError?: string;         // error message if last run failed
  nextRun?: string;              // ISO 8601 timestamp (computed)
  runCount: number;              // total successful runs
}

type AutomationSchedule =
  | { type: 'interval'; intervalMinutes: number }
  | { type: 'daily'; time: string }        // "HH:MM" 24h
  | { type: 'weekly'; days: DayOfWeek[]; time: string };

type DayOfWeek = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

interface AutomationOutput {
  mode: 'new-file' | 'append' | 'replace';
  location: string;              // relative path from workspace root
  fileNameTemplate?: string;     // for new-file mode, supports {{date}}, {{time}}, {{id}}
}
```

## UI Mockup

The document header would look something like this when editing an automation file:

![Automation Document Header](automation-header-screenshot.png){mockup:nimbalyst-local/mockups/automation-document-header.mockup.html}

## Open Questions

1. **Cost controls**: Should there be a token budget per automation run? A max duration?
2. **Concurrent runs**: What if an automation is still running when its next scheduled time arrives? Skip the new run? Queue it?
3. **Cross-workspace**: Should automations be workspace-scoped or global? Current design is workspace-scoped (files live in the workspace).
4. **Mobile sync**: Should automation definitions sync to mobile (read-only view of outputs)?
5. **`sendPrompt` scope**: Should the new `services.ai.sendPrompt()` API be available to all extensions with `ai` permission, or gated behind a new `automation` permission?
