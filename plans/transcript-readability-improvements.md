---
planStatus:
  planId: plan-transcript-readability
  title: Improve Agent Transcript Panel Readability and Density
  status: draft
  planType: feature
  priority: high
  owner: ghinkle
  stakeholders:
    - ghinkle
  tags:
    - ui
    - ux
    - agent-transcript
    - readability
  created: "2025-11-09"
  updated: "2025-11-09T00:40:00.000Z"
  progress: 0
---
# Improve Agent Transcript Panel Readability and Density

## Goals

Improve the readability, information density, and usefulness of the AgentTranscriptPanel tool call display by:

1. **Prioritizing content over tool names** - Focus on what the agent did, not the technical tool name
2. **Improving file path display** - Show project-relative paths and full file names
3. **Reducing visual clutter** - Collapse redundant operations and group related tool calls
4. **Enhancing scannability** - Make it easy to quickly understand what the agent accomplished

## Current Problems

### 1. Tool Name Prominence Over Content
**Problem:** The tool name (e.g., "Bash", "Read", "Glob") is displayed prominently, but what matters more is what the tool did.
- "Bash" is less important than "git log"
- "Read" is less important than which file was read
- "Glob" is less important than what pattern was searched

**Example from screenshot:**
```
🔧 Bash cat > /tmp/session_history_ref...
```
What the user actually wants to know: "Created file session_history_ref.txt"

### 2. Truncated File Paths
**Problem:** File paths are truncated in unhelpful ways, often cutting off the most important part (the file name).

**Example from screenshot:**
```
📄 Read /Users/ghinkle/sources/stravu-...
```
Should show: `packages/electron/src/main/index.ts` (project-relative)

### 3. Redundant Tool Calls
**Problem:** Multiple consecutive calls to the same file are shown separately, creating visual noise.

**Example from screenshot:**
```
📄 Read /Users/ghinkle/sources/stravu-...
📄 Read /Users/ghinkle/sources/stravu-..., 717, 80
📄 Read /Users/ghinkle/sources/stravu-..., 1387, 40
📄 Read /Users/ghinkle/sources/stravu-..., 73, 35
```
Could be collapsed to: "Read multiple sections of [filename]" or show a summary

### 4. Generic Argument Display
**Problem:** Tool arguments are shown as comma-separated truncated values without context.

**Example:** `loadSessions\(\)|setSessionHis..., /Users/ghinkle/sources/stravu-..., content, true`

Hard to understand what this Grep search was actually looking for.

## Proposed Solutions

### Solution 1: Content-First Display Format

**Create tool-specific formatters that prioritize the action/content:**

**Bash Tool:**
- Instead of: `🔧 Bash cat > /tmp/file.txt`
- Show: `📝 Created file: /tmp/file.txt`
- Or: `🔍 Ran: git log --oneline -10`

**Read Tool:**
- Instead of: `📄 Read /Users/ghinkle/sources/..., 717, 80`
- Show: `📖 Read lines 717-797 of packages/electron/src/main/index.ts`
- Or: `📖 Read packages/electron/src/main/index.ts` (if full file)

**Glob Tool:**
- Instead of: `🔧 Glob packages/electron/src/renderer...`
- Show: `🔎 Found files matching: packages/electron/src/renderer/**/*.tsx`

**Grep Tool:**
- Instead of: `🔧 Grep loadSessions\(\)|setSessionHis..., /Users/...`
- Show: `🔍 Searched for "loadSessions()|setSessionHis..." in packages/electron/src/`

**Edit Tool:**
- Instead of: `🔧 Edit /Users/ghinkle/sources/...`
- Show: `✏️ Edited packages/electron/src/main/index.ts`

**Write Tool:**
- Instead of: `🔧 Write /Users/ghinkle/sources/...`
- Show: `📝 Created packages/electron/src/components/NewComponent.tsx`

### Solution 2: Smart File Path Display

**Implement project-relative path resolution:**

1. Detect workspace root from session context
2. Convert absolute paths to project-relative paths
3. Preserve full file name (never truncate the file name)
4. Intelligently shorten directory paths if needed

**Examples:**
- `/Users/ghinkle/sources/stravu-editor/packages/electron/src/main/index.ts`
- Becomes: `packages/electron/src/main/index.ts`

**For very long paths, use ellipsis in the middle:**
- `packages/electron/src/renderer/components/AgentTranscript/components/RichTranscriptView.tsx`
- Becomes: `packages/electron/src/.../RichTranscriptView.tsx`

### Solution 3: Collapse Consecutive Similar Operations

**Group related tool calls into summaries:**

**Multiple Reads of Same File:**
```
Before (4 separate items):
📄 Read /Users/ghinkle/sources/stravu-...
📄 Read /Users/ghinkle/sources/stravu-..., 717, 80
📄 Read /Users/ghinkle/sources/stravu-..., 1387, 40
📄 Read /Users/ghinkle/sources/stravu-..., 73, 35

After (1 collapsed item):
📖 Read 4 sections of packages/electron/src/main/index.ts
  └─ Lines: 1-all, 717-797, 1387-1427, 73-108
  [Click to expand]
```

**Multiple File Operations:**
```
Before (3 separate items):
🔧 Bash cat > /tmp/session_history_ref.txt
🔧 Bash cat > /tmp/session_history_flo.txt
🔧 Bash cat > /tmp/FINDINGS_SUMMARY.txt

After (1 collapsed item):
📝 Created 3 temporary files
  └─ session_history_ref.txt, session_history_flo.txt, FINDINGS_SUMMARY.txt
  [Click to expand]
```

**Implementation Approach:**
1. Detect consecutive tool calls of the same type
2. Check if they operate on the same file/resource
3. If yes, collapse into a summary with expandable details
4. User can click to see individual operations

### Solution 4: Rich Tool Call Summaries

**Add a summary line that explains what was accomplished:**

**Example for Bash:**
- Detect command type (git, npm, cat, grep, etc.)
- Show human-readable summary
- Include exit status indicator

```
✓ git log --oneline -10
  → Retrieved 10 recent commits
  [Click to see output]

✗ npm test
  → Tests failed (3 failures)
  [Click to see output]
```

**Example for Edit:**
- Show what changed (if available)
- Number of lines added/removed

```
✏️ Edited packages/electron/src/main/index.ts
  → +5 lines, -2 lines
  [Click to see diff]
```

### Solution 5: Improved Visual Hierarchy

**Use visual design to improve scannability:**

1. **Two-line format for each tool call:**
  - Line 1: Icon + Action summary (bold, prominent)
  - Line 2: Details (smaller, muted text)

```
   ✏️ Edited RichTranscriptView.tsx
      packages/electron/src/components/AgentTranscript/components/
```

2. **Status indicators:**
  - ✓ Green checkmark for successful operations
  - ✗ Red X for failures
  - ⟳ Yellow arrow for retries
  - ⚠ Warning triangle for warnings

3. **Color coding by operation type:**
  - Blue for reads (information gathering)
  - Green for successful writes/edits
  - Yellow for searches
  - Red for errors
  - Gray for low-priority operations

4. **Collapsible sections:**
  - Allow collapsing entire groups of tool calls by type
  - "Collapse all Read operations"
  - "Show only file modifications"

### Solution 6: Contextual Grouping

**Group tool calls by the higher-level task they accomplish:**

Instead of showing individual tool calls in chronological order, group them by logical task:

```
📋 Task: Implement new feature
  ├─ 🔎 Search Phase
  │   ├─ Searched for "loadSessions" in packages/electron/src/
  │   └─ Found files matching **/*.tsx
  ├─ 📖 Read Phase
  │   ├─ Read 3 files: index.ts, App.tsx, SessionManager.tsx
  │   └─ Read multiple sections of RichTranscriptView.tsx
  └─ ✏️ Edit Phase
      ├─ Edited index.ts (+12, -3)
      └─ Created NewComponent.tsx (+45)

📋 Task: Run tests
  └─ ✗ npm test (3 failures)
```

**Implementation:**
- Use AI agent's thinking/reasoning blocks to detect task boundaries
- Group tool calls between user prompts
- Allow manual expansion to see chronological order

## Additional Improvements

### 7. Quick Actions
Add inline actions for common operations:

- **File paths:** Click to open file
- **Search results:** Click to see full results
- **Commands:** Click to copy command
- **Errors:** Click to jump to error location

### 8. Filtering and Search
Add controls to filter the transcript:

- Show only file operations
- Show only errors
- Hide successful reads
- Search within tool calls
- Group by file

### 9. Statistics Summary
Show aggregate statistics at the top:

```
Session Summary:
• 15 files read
• 3 files edited
• 2 files created
• 8 searches performed
• 12 bash commands executed
• Duration: 2m 15s
```

### 10. Diff Visualization for Edits
When a file is edited, show a mini diff inline:

```
✏️ Edited packages/electron/src/main/index.ts

  @@ Line 142 @@
  - const oldValue = getSetting();
  + const newValue = getUpdatedSetting();
  + const result = processValue(newValue);

  [Click to see full diff]
```

## Implementation Plan

### Phase 1: Core Improvements (High Priority)
1. Implement content-first display formatters for each tool type
2. Add project-relative path resolution
3. Improve visual hierarchy (two-line format, status indicators)

### Phase 2: Smart Collapsing (Medium Priority)
4. Implement consecutive operation detection
5. Add collapsible groups for similar operations
6. Add expand/collapse controls

### Phase 3: Enhanced Features (Lower Priority)
7. Add quick actions (file opening, copy commands)
8. Implement filtering and search
9. Add session statistics summary
10. Add inline diff visualization

## Technical Implementation

### New Components
1. **ToolCallFormatter** - Service to format tool calls based on type
2. **PathResolver** - Utility to convert absolute paths to project-relative
3. **ToolCallGrouper** - Logic to detect and group similar operations
4. **ToolCallSummary** - Component for collapsed tool call groups

### Files to Modify
- `packages/runtime/src/ui/AgentTranscript/components/RichTranscriptView.tsx`
- `packages/runtime/src/ui/AgentTranscript/components/RichTranscriptView.css`
- New: `packages/runtime/src/ui/AgentTranscript/utils/toolCallFormatter.ts`
- New: `packages/runtime/src/ui/AgentTranscript/utils/pathResolver.ts`
- New: `packages/runtime/src/ui/AgentTranscript/utils/toolCallGrouper.ts`
- New: `packages/runtime/src/ui/AgentTranscript/components/ToolCallGroup.tsx`

### Tool Call Formatter Interface

```typescript
interface ToolCallFormatted {
  // Primary display (what the user sees first)
  summary: string;           // "Edited RichTranscriptView.tsx"
  icon: string;              // Icon/emoji to display
  status: 'success' | 'error' | 'warning';

  // Secondary details (shown below or on hover)
  details?: string;          // File path, command args, etc.
  metadata?: {               // Additional context
    linesAdded?: number;
    linesRemoved?: number;
    duration?: number;
    fileSize?: number;
  };

  // Interactive elements
  quickActions?: {
    label: string;
    action: () => void;
  }[];

  // Expansion content (shown when clicked)
  expandedContent?: React.ReactNode;
}

interface ToolCallFormatter {
  format(toolCall: ToolCall, context: SessionContext): ToolCallFormatted;
}

// Tool-specific formatters
class BashFormatter implements ToolCallFormatter { ... }
class ReadFormatter implements ToolCallFormatter { ... }
class EditFormatter implements ToolCallFormatter { ... }
class GrepFormatter implements ToolCallFormatter { ... }
class GlobFormatter implements ToolCallFormatter { ... }
```

### Path Resolver Implementation

```typescript
interface PathResolver {
  /**
   * Convert absolute path to project-relative path
   * @param absolutePath - Full system path
   * @param workspacePath - Workspace root path
   * @returns Project-relative path
   */
  toProjectRelative(absolutePath: string, workspacePath: string): string;

  /**
   * Intelligently shorten a path for display
   * @param path - Path to shorten
   * @param maxLength - Maximum display length
   * @returns Shortened path with file name preserved
   */
  shortenPath(path: string, maxLength?: number): string;
}
```

### Tool Call Grouper Implementation

```typescript
interface ToolCallGroup {
  type: 'single' | 'collapsed';
  toolCalls: ToolCall[];
  summary: string;
  isExpanded: boolean;
}

interface ToolCallGrouper {
  /**
   * Group consecutive similar tool calls
   * @param toolCalls - Array of tool calls to group
   * @returns Array of groups (single or collapsed)
   */
  groupToolCalls(toolCalls: ToolCall[]): ToolCallGroup[];

  /**
   * Check if two tool calls should be grouped together
   * @param a - First tool call
   * @param b - Second tool call
   * @returns True if they should be grouped
   */
  shouldGroup(a: ToolCall, b: ToolCall): boolean;
}
```

## Success Metrics

1. **Reduced visual clutter** - Fewer individual tool call items displayed (target: 30-50% reduction through collapsing)
2. **Improved scannability** - Users can understand what happened without expanding every item
3. **Better file path recognition** - File names are always visible and recognizable
4. **Faster comprehension** - Users can quickly identify errors, edits, and key actions

## User Testing Questions

1. Can you quickly identify which files were edited in this session?
2. Can you tell what the agent was searching for?
3. Are the collapsed groups helpful or confusing?
4. Do you prefer content-first (action) or tool-first (technical) display?
5. What information is still missing or unclear?

## Alternative Approaches Considered

### 1. Timeline View
Group tool calls by time periods (e.g., "Last 30 seconds"). Rejected because tasks don't always align with time periods.

### 2. Tree View
Show tool calls in a hierarchical tree structure. Rejected because it takes more vertical space and is harder to scan.

### 3. Tab-Based Views
Separate tabs for "All", "Files", "Commands", "Searches". Rejected because it fragments the story of what happened.

## Related Work

- VS Code's "Timeline" view for file changes
- GitHub Actions logs with collapsible sections
- Chrome DevTools Network panel (request grouping and filtering)
- Linear's activity feed (smart grouping of related actions)

## Open Questions

1. **Grouping strategy:** Should we group by tool type, by file, or by logical task?
2. **Default collapsed state:** Should similar operations be collapsed by default or expanded?
3. **Line number display:** For Read operations with ranges, show "lines 717-797" or "80 lines from 717"?
4. **Bash command parsing:** How smart should we be about parsing bash commands? (e.g., detecting git, npm, etc.)
5. **Error prominence:** Should errors always be shown prominently even if grouped?

## Next Steps

1. Create mockups of proposed designs
2. Implement Phase 1 core improvements
3. Gather user feedback on new format
4. Iterate on collapsing/grouping logic
5. Implement Phase 2 and 3 based on feedback
