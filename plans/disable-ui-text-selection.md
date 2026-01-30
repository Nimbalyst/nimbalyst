---
planStatus:
  planId: plan-disable-ui-text-selection
  title: Disable UI Text Selection
  status: in-review
  planType: improvement
  priority: medium
  owner: ghinkle
  stakeholders: []
  tags:
    - ux
    - css
    - extensions
  created: "2026-01-30"
  updated: "2026-01-30T12:30:00.000Z"
  progress: 100
  startDate: "2026-01-30"
---

# Disable UI Text Selection

## Implementation Progress

- [x] Add global `user-select: none` to `#root` in index.css
- [x] Add `select-text` to AI message content in RichTranscriptView.tsx
- [x] Add `select-text` to markdown content in MarkdownRenderer.tsx
- [x] Add `select-text` to diff line content in DiffViewer.tsx
- [x] Add `select-text` to bash command output in BashWidget.tsx
- [x] Add documentation to CLAUDE.md

## Problem

Many parts of the Nimbalyst UI allow text selection when they shouldn't. This is common in web-based IDEs/design tools - button labels, sidebar items, panel headers, etc. become selectable, causing awkward UX when users Cmd+A or accidentally drag-select.

Currently, the codebase applies `select-none` on a case-by-case basis (found ~35 instances in TSX files), but new UI components default to selectable. This is error-prone and inconsistent.

## Solution

Invert the default: make all UI non-selectable by default, then explicitly opt-in content areas that should allow selection.

### Implementation

#### 1. Global Default in index.css

Add `user-select: none` to the root container:

```css
#root {
  height: 100vh;
  overflow: hidden;
  user-select: none;  /* NEW: Default all UI to non-selectable */
}
```

**File:** `packages/electron/src/renderer/index.css`

#### 2. Opt-In Content Areas

Add `select-text` (Tailwind) to content areas that need selection. Based on code review:

| Area | File | Current State | Action |
|------|------|---------------|--------|
| Lexical editor | `ContentEditable.tsx` | Handled internally | No change |
| Monaco editor | Internal | Handled internally | No change |
| Terminal (xterm.js) | Internal | Handled internally | No change |
| AI message content | `RichTranscriptView.tsx` | No `select-text` | **Add `select-text`** |
| Markdown rendered content | `MarkdownRenderer.tsx` | No `select-text` | **Add `select-text`** |
| Diff code lines | `DiffViewer.tsx` | No `select-text` | **Add `select-text`** |
| Bash command output | `BashWidget.tsx` | No `select-text` | **Add `select-text`** |
| Input fields | HTML native | Handled by browser | No change |

**Note:** Many existing `select-none` usages on UI chrome will become redundant but harmless. We can clean them up later if desired.

#### 3. Extension SDK Guidelines

Extensions receive `EditorHost` which provides the file path and lifecycle hooks. The extension's root element will inherit `user-select: none` from the app.

**For extension custom editors:**
- The EditorHost container inherits `user-select: none`
- Extensions MUST add `select-text` to content areas where selection makes sense
- Example: CSV editor cells might be selectable, row headers shouldn't be

**For extension panels:**
- Panel chrome (headers, toolbars) non-selectable by default
- Content areas that display copyable text need explicit `select-text`

This will be documented in the extension SDK and CLAUDE.md.

#### 4. Tailwind Utility Classes

The codebase already has Tailwind configured. The relevant classes are:
- `select-none` - Prevents text selection (will be the default, can be used for emphasis)
- `select-text` - Allows text selection (opt-in for content)
- `select-all` - Selects all text on click (useful for code snippets to copy)

#### 5. Update CLAUDE.md

Add a new section to the Cross-Cutting Patterns documenting this approach so agents maintain the pattern.

**Location:** `/CLAUDE.md` - Add to "Shared UI Patterns" section after "Common Tailwind Class Misuse"

---

## Files to Modify

### Core Changes

1. **`packages/electron/src/renderer/index.css`**
   - Add `user-select: none` to `#root` selector

### Content Area Opt-Ins

2. **`packages/runtime/src/ui/AgentTranscript/components/RichTranscriptView.tsx`**
   - Add `select-text` to the message content wrapper (around line 800-900 where message text renders)
   - NOT to the header, avatar, or metadata areas

3. **`packages/runtime/src/ui/AgentTranscript/components/MarkdownRenderer.tsx`**
   - Add `select-text` to the `.markdown-content` wrapper element

4. **`packages/runtime/src/ui/AgentTranscript/components/DiffViewer.tsx`**
   - Add `select-text` to the diff line content spans (NOT to line numbers or markers)
   - File header should remain non-selectable

5. **`packages/runtime/src/ui/AgentTranscript/components/CustomToolWidgets/BashWidget.tsx`**
   - Add `select-text` to the command output display area
   - Keep prompt symbol (`$`) and status indicators non-selectable

### Documentation

6. **`/CLAUDE.md`**
   - Add "Text Selection: Default to Non-Selectable" subsection to Shared UI Patterns

---

## CLAUDE.md Addition

Add this to `/CLAUDE.md` in the "Shared UI Patterns" section:

```markdown
#### Text Selection: Default to Non-Selectable

The app defaults to `user-select: none` on the `#root` container. This prevents awkward text selection on UI chrome (buttons, sidebar items, headers).

**Content areas must opt-in to selection:**
- Use `select-text` (Tailwind) or `user-select: text` (CSS) on content that users should be able to select/copy
- Editor content areas (Lexical, Monaco, terminals) handle selection internally - no action needed

**Where to allow selection:**
- Editor content (handled automatically by editors)
- AI chat message bodies (not headers, avatars, or metadata)
- Code blocks and terminal output in transcripts
- Error messages users might copy
- Diff line content (not line numbers or markers)

**Never allow selection on:**
- Buttons, tabs, navigation items
- Panel headers and toolbars
- Sidebar items (file tree, session list)
- Status indicators and badges
- Line numbers, diff markers

**Extension developers:** Custom editors and panels inherit `user-select: none` from the app root. Add `select-text` to your content areas where selection is appropriate.

| Anti-Pattern | Problem | Solution |
| --- | --- | --- |
| Forgetting `select-text` on content | Users can't copy text | Add `select-text` to content wrappers |
| `select-text` on entire component | Headers/buttons become selectable | Only apply to content, not chrome |
| `select-none` on every element | Redundant, clutters code | Let global default handle it |
```

---

## Verification

After implementation, test these scenarios:

1. **UI Chrome (should NOT select):**
   - Cmd+A in the app should NOT select button labels, sidebar text
   - Triple-click on navigation items shouldn't select them
   - Drag across file tree items shouldn't create selection

2. **Content Areas (SHOULD select):**
   - Text in AI chat messages CAN be selected and copied
   - Text in markdown code blocks CAN be selected
   - Text in diff viewers CAN be selected (not line numbers)
   - Code in bash output CAN be selected
   - Error messages CAN be selected

3. **Editors (should work normally):**
   - Monaco/Lexical editors work normally
   - Terminal selection works normally
   - CSV editor cell selection works

4. **Extensions:**
   - DataModelLM editor - field names selectable
   - Excalidraw - no text selection on UI buttons
   - PDF viewer - text layer selection works

---

## Cleanup (Future, Optional)

After the global default is in place, the ~35 existing `select-none` usages on UI elements become redundant. We could remove them for code cleanliness, but they're harmless to leave. Low priority.

---

## Rollback

If this causes issues, simply remove the `user-select: none` from `#root` in index.css. The explicit `select-text` additions are harmless either way.
