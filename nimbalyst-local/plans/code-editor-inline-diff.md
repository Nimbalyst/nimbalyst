---
planStatus:
  planId: plan-code-editor-inline-diff
  title: Monaco Code Editor Integration with Inline Diff Support
  status: in-development
  planType: feature
  priority: high
  owner: ghinkle
  stakeholders:
    - ghinkle
  tags:
    - code-editor
    - diff-viewer
    - syntax-highlighting
    - monaco-editor
    - tab-editor
  created: "2025-11-10"
  updated: "2025-11-12T01:10:00.000Z"
  progress: 25
  dueDate: null
  startDate: "2025-11-12"
---
## Implementation Progress

### Phase 1: Basic Monaco Integration
- [x] Install Monaco dependencies (@monaco-editor/react, monaco-editor)
- [x] Create FileTypeDetector utility (getFileType, getMonacoLanguage)
- [x] Create MonacoThemeMapper utility
- [x] Create MonacoCodeEditor component (normal mode only)
- [x] Modify TabEditor to branch on file type
- [x] Build completed successfully with Monaco integration
- [x] Fix: Guard Lexical operations for code files (diff tags, theme switching, file reloads)
- [x] Fix: Guard FixedTabHeaderContainer and DiffApprovalBar for Monaco editors
- [x] Rebuild successful after all fixes
- [x] Phase 1 committed to feature/monaco-code-editor branch (commit 6a0bf98)
- [ ] Manual test: .ts, .js, .py files open with syntax highlighting
- [ ] Manual test: Code files display in TabEditor alongside markdown
- [ ] Manual test: Autosave works for code files
- [ ] Manual test: Manual save works for code files
- [ ] Manual test: File watching detects external changes
- [ ] Manual test: Multiple code files in tabs simultaneously
- [ ] Manual test: Theme changes apply to Monaco
- [ ] Manual test: Switching between markdown and code tabs works
- [ ] Manual test: No impact on markdown editing

### Phase 2: Diff Mode Integration
- [ ] Extend MonacoCodeEditor with diff mode support
- [ ] Add diff accept/reject UI overlay
- [ ] Integrate with TabEditor pending-approval logic
- [ ] Test: AI edit shows inline diff
- [ ] Test: Diff shows additions/deletions clearly
- [ ] Test: Accept All works
- [ ] Test: Reject All works
- [ ] Test: Tag status updates correctly
- [ ] Test: Normal editing resumes after diff exit
- [ ] Test: Tab switching preserves diff state
- [ ] Test: File watching works during diff mode

### Phase 3: Polish & Production Ready
- [ ] Customize Monaco themes to match Nimbalyst
- [ ] Handle large files (>1MB)
- [ ] Handle binary files (error message)
- [ ] E2E test coverage for code editing
- [ ] E2E test coverage for diff workflow
- [ ] Update CLAUDE.md documentation

# Monaco Code Editor Integration with Inline Diff Support

## Goals

- Integrate Monaco Editor into TabEditor for code files (non-markdown)
- Provide syntax-highlighted code editing for JS, TS, Python, CSS, JSON, etc.
- Support inline diff viewing for AI edits using existing document history system
- Reuse existing "pending-approval" workflow from markdown (accept/reject UI)
- Maintain zero impact on existing StravuEditor/Lexical markdown editing
- Enable future side-by-side diff view in agent mode (out of scope for initial implementation)

## Problem Statement

Currently, TabEditor only supports markdown files via StravuEditor (Lexical). When users need to edit code files:
- No syntax highlighting available
- No language-aware features (autocomplete, error detection)
- AI edits to code files are tracked in document history but can't be visualized as diffs
- Users can't properly review AI code changes before accepting

The existing document history system already tracks all AI edits (including code files) with pre-edit tags and pending-approval status. We need to:
1. Display code files with proper syntax highlighting in TabEditor
2. Show inline diffs when AI edits code files (using existing history tags)
3. Support the same accept/reject workflow as markdown

## Existing Architecture Understanding

### TabEditor Component
TabEditor is the container component that manages a single file's editor instance. Currently:
- Renders StravuEditor (Lexical) for markdown files
- Handles autosave, file watching, dirty state, manual save
- Integrates with document history system (creates snapshots)
- Manages "pending-approval" state via `pendingAIEditTagRef`
- Applies diffs using Lexical's `APPLY_MARKDOWN_REPLACE_COMMAND`
- Listens for `APPROVE_DIFF_COMMAND` and `REJECT_DIFF_COMMAND`

### Document History System
The existing history system (HistoryManager + document_history table):
- Creates snapshots for all file changes (manual, auto, AI edits)
- Tags AI edits with `ai-edit-pre` (before edit) and tracks pending status
- Supports incremental approval with `incremental-approval` tags
- Stores content as compressed binary data (BYTEA)
- Works for **all file types**, not just markdown

### Pending-Approval Workflow
When AI edits a file:
1. Pre-edit snapshot created with `ai-edit-pre` tag, status = `pending`
2. AI writes new content to disk
3. TabEditor detects pending tag via `getPendingTags(filePath)`
4. TabEditor applies diff visualization (oldContent vs newContent)
5. User accepts/rejects via UI (dispatches commands)
6. Tag status updated to `reviewed` and editor exits diff mode

**Key insight:** This workflow is file-type agnostic. We just need Monaco to visualize the diffs instead of Lexical.

## Implementation Approach

### Architecture Decision: Monaco with Inline Diff Mode

We'll use **Monaco's DiffEditor in inline mode** for code files with pending AI edits, similar to the markdown approach:

1. **TabEditor branches on file type**
  - Markdown files → StravuEditor (Lexical) - unchanged
  - Code files → MonacoCodeEditor wrapper component (new)

2. **MonacoCodeEditor component** (packages/electron/src/renderer/components/MonacoCodeEditor/)
  - Wraps @monaco-editor/react
  - Two modes: **normal editing** and **diff viewing**
  - Normal mode: `monaco.editor.create()` - standard code editing
  - Diff mode: `monaco.editor.createDiffEditor()` with inline view - shows AI changes
  - Switches modes based on `pendingAIEditTagRef` (same pattern as markdown)

3. **Reuse existing TabEditor logic**
  - File watching, autosave, dirty state - all unchanged
  - Pending tag detection - works for any file type
  - Accept/reject handlers - work with Monaco instead of Lexical
  - Document history integration - no changes needed

4. **Theme synchronization**
  - Map Nimbalyst themes (light, dark, crystal-dark) to Monaco themes
  - Apply theme changes to both Lexical and Monaco editors

### Key Technical Decisions

**✅ Chosen: Monaco DiffEditor with inline mode**
- Uses Monaco's built-in diff capabilities
- Inline mode shows changes within single column (like markdown)
- Accept/reject implemented via Monaco's decorations API
- Can switch between normal editor and diff editor instances

**❌ Rejected: Custom decorations-only approach**
- Would require reimplementing diff algorithm
- More complex to maintain
- Monaco's DiffEditor already provides what we need

**❌ Deferred: Side-by-side diff view**
- Out of scope for initial implementation
- Can be added later for agent mode
- Initial focus: inline diff in TabEditor only

## Components to Create/Modify

### New Components

**MonacoCodeEditor.tsx** (packages/electron/src/renderer/components/MonacoCodeEditor/)
- Wrapper component for Monaco editor
- Props: `filePath`, `fileName`, `initialContent`, `theme`, `onContentChange`, `onGetContent`, `onEditorReady`
- State: `isDiffMode` (boolean)
- Normal mode: Renders `<Editor>` from @monaco-editor/react
- Diff mode: Renders `<DiffEditor>` with inline view
- Exposes `getContent()`, `setContent(content)`, `showDiff(oldContent, newContent)`, `exitDiffMode()` methods
- Handles accept/reject via custom decorations/actions

**MonacoThemeMapper.ts** (packages/electron/src/renderer/utils/)
- Maps Nimbalyst themes to Monaco themes
- Converts CSS variables to Monaco's theme format
- Supports light, dark, crystal-dark themes

**FileTypeDetector.ts** (packages/electron/src/renderer/utils/)
- Detects file type from extension
- Returns `'markdown' | 'code'`
- Maps extensions to Monaco language IDs (ts, js, py, css, json, etc.)

### Modified Components

**TabEditor.tsx**
- Add conditional rendering: `{isMarkdown ? <StravuEditor /> : <MonacoCodeEditor />}`
- Keep all existing logic (autosave, file watching, dirty state, etc.)
- Accept/reject handlers work with both editor types
- Pass same props/callbacks to both editor components

**packages/electron/package.json**
- Add dependencies: `@monaco-editor/react`, `monaco-editor`

### No Changes Needed
- HistoryManager - already file-type agnostic
- Document history database - stores any content type
- IPC handlers - work with any file content
- AI editing services - write to disk, history system handles the rest

## Technical Details

### File Type Detection
```typescript
function getFileType(filePath: string): 'markdown' | 'code' {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.md' || ext === '.markdown') return 'markdown';
  return 'code';
}

function getMonacoLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const langMap = {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.py': 'python',
    '.json': 'json',
    '.css': 'css',
    '.html': 'html',
    '.yml': 'yaml',
    '.yaml': 'yaml',
    // ... etc
  };
  return langMap[ext] || 'plaintext';
}
```

### Monaco Theme Mapping
Convert Nimbalyst CSS variables to Monaco theme:
```typescript
function getMonacoTheme(nimbalystTheme: ConfigTheme): string {
  // Return built-in Monaco theme name
  if (nimbalystTheme === 'light') return 'vs';
  if (nimbalystTheme === 'dark') return 'vs-dark';
  if (nimbalystTheme === 'crystal-dark') return 'vs-dark'; // customize further
}
```

### Diff Accept/Reject Implementation
Monaco DiffEditor doesn't have built-in accept/reject UI. We need to:
1. Use DiffEditor to visualize changes (read-only mode initially)
2. Add custom overlay UI with "Accept All" / "Reject All" buttons (similar to FixedTabHeaderContainer for markdown)
3. On accept: write modified content to disk, mark tag as reviewed
4. On reject: write original content to disk, mark tag as reviewed
5. Exit diff mode and reload normal editor

**Note:** Incremental accept/reject (per-hunk) is deferred to future work. Initial implementation: accept all or reject all only.

### Performance Considerations
- **Bundle size:** Monaco is ~5MB minified. Use code splitting via dynamic imports.
- **Lazy loading:** Only load Monaco when first code file is opened
- **Memory:** Dispose editor instances when tabs close
- **Large files:** Monaco handles up to ~10MB files reasonably well

## Implementation Plan

### Phase 1: Basic Monaco Integration (Normal Editing)
**Goal:** Code files open with syntax highlighting in TabEditor

1. Install dependencies
  - Add `@monaco-editor/react` and `monaco-editor` to packages/electron/package.json
  - Configure webpack/vite to handle Monaco's web workers

2. Create FileTypeDetector utility
  - Implement `getFileType(filePath)` and `getMonacoLanguage(filePath)`
  - Add to packages/electron/src/renderer/utils/

3. Create MonacoThemeMapper utility
  - Map Nimbalyst themes to Monaco themes
  - Initially use built-in themes (vs, vs-dark)

4. Create MonacoCodeEditor component (normal mode only)
  - Render `<Editor>` from @monaco-editor/react
  - Expose `getContent()`, `setContent()` methods via ref
  - Handle `onContentChange` callback
  - Apply theme and language

5. Modify TabEditor to branch on file type
  - Detect file type on mount
  - Render StravuEditor for markdown, MonacoCodeEditor for code
  - Pass same callbacks (onContentChange, onSaveComplete, etc.)

6. Test basic editing
  - Open .ts, .js, .py files
  - Verify syntax highlighting
  - Verify autosave works
  - Verify manual save works

### Phase 2: Diff Mode Integration
**Goal:** AI edits to code files show inline diffs with accept/reject

1. Extend MonacoCodeEditor to support diff mode
  - Add `isDiffMode` state
  - Render `<DiffEditor>` when in diff mode
  - Add `showDiff(oldContent, newContent)` method
  - Add `exitDiffMode()` method

2. Add diff accept/reject UI
  - Create overlay component with Accept All / Reject All buttons
  - Position similar to FixedTabHeaderContainer for markdown
  - Wire up to call parent accept/reject handlers

3. Integrate with TabEditor's pending-approval logic
  - When `pendingAIEditTagRef` exists for code file, call `showDiff()`
  - Accept handler: write new content, mark tag reviewed, exit diff mode
  - Reject handler: write old content, mark tag reviewed, exit diff mode
  - Reuse all existing tag management logic from markdown

4. Test diff workflow
  - Simulate AI edit to .ts file
  - Verify diff displays inline
  - Verify Accept All works
  - Verify Reject All works
  - Verify tag status updates correctly

### Phase 3: Polish & Edge Cases
**Goal:** Production-ready code editing with diffs

1. Theme refinement
  - Customize Monaco themes to match Nimbalyst better
  - Handle theme switching while editors are open

2. Handle edge cases
  - Very large files (>1MB)
  - Binary files (show error message)
  - File watching during diff mode
  - Tab switching with active diffs

3. Testing
  - E2E tests for code file editing
  - E2E tests for diff accept/reject workflow
  - Test with various file types

4. Documentation
  - Update CLAUDE.md with code editor architecture
  - Document Monaco integration patterns

## Acceptance Criteria

### Phase 1: Basic Editing
- [ ] .ts, .js, .py, .json, .css, .html files open with proper syntax highlighting
- [ ] Code files display in TabEditor alongside markdown files
- [ ] Autosave works for code files (dirty indicator appears/disappears)
- [ ] Manual save (Cmd+S) works for code files
- [ ] File watching detects external changes to code files
- [ ] Multiple code files can be open in tabs simultaneously
- [ ] Theme changes apply to Monaco editor (light/dark/crystal-dark)
- [ ] Switching between markdown and code tabs works smoothly
- [ ] No impact on existing markdown editing functionality

### Phase 2: Diff Viewing
- [ ] When AI edits code file, inline diff displays automatically
- [ ] Diff shows additions (green) and deletions (red) clearly
- [ ] "Accept All" button accepts changes and exits diff mode
- [ ] "Reject All" button reverts to original and exits diff mode
- [ ] Tag status updates to 'reviewed' after accept/reject
- [ ] Normal editing resumes after exiting diff mode
- [ ] Tab switching preserves diff state (can switch away and back)
- [ ] File watching works correctly during diff mode

### Phase 3: Production Ready
- [ ] Monaco bundle loads lazily (not on app startup)
- [ ] Files up to 10MB edit smoothly
- [ ] Memory cleanup when tabs close
- [ ] E2E test coverage for code editing workflow
- [ ] E2E test coverage for diff accept/reject workflow
- [ ] Documentation updated in CLAUDE.md

## Deferred Features

These are explicitly **out of scope** for initial implementation:

- ❌ Incremental accept/reject (per-hunk) - Accept All / Reject All only initially
- ❌ Side-by-side diff view - Inline only initially
- ❌ LSP integration - Basic Monaco features only
- ❌ Custom Monaco themes - Built-in themes only initially
- ❌ Collaborative editing for code - Not in scope
- ❌ Code formatting on save - Not in scope
- ❌ Advanced Monaco features (go-to-definition, refactoring) - Future work

## Dependencies

**New:**
- `@monaco-editor/react` - React wrapper for Monaco
- `monaco-editor` - Core Monaco editor library

**Existing (no changes):**
- StravuEditor/Rexical - For markdown editing
- Document history system - Already file-type agnostic
- TabEditor - Container for both editor types
- Theme system - Will extend to support Monaco

## Risks & Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| **Bundle size** - Monaco adds ~5MB | Slower initial load | Use code splitting, lazy load only when needed |
| **Two editor systems** - Increased complexity | Harder to maintain | Keep interfaces identical, reuse TabEditor logic |
| **DiffEditor inline mode** - May not look native | Poor UX | Use Monaco's built-in inline mode, customize styling |
| **Theme mapping** - Colors may not match perfectly | Inconsistent look | Start with built-in themes, refine iteratively |
| **Large files** - Monaco may struggle with huge files | Performance issues | Set reasonable limits, warn users |
| **Breaking markdown** - Changes to TabEditor could break Lexical | Production bugs | Thorough testing, no changes to markdown code paths |

## Success Metrics

After implementation, we should see:
- **Code files editable** - Users can open and edit .ts, .js, .py files with syntax highlighting
- **AI diffs visible** - AI edits to code files display as reviewable diffs
- **Zero markdown impact** - No regressions in markdown editing functionality
- **Performance acceptable** - No noticeable lag with typical code files (<1MB)
- **User adoption** - Users start editing code files in Nimbalyst instead of external editors
