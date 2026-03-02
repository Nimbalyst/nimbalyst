---
planStatus:
  planId: plan-agent-session-file-link
  title: Link open document when starting agent session from header
  status: draft
  planType: feature
  priority: medium
  owner: ghinkle
  stakeholders: []
  tags: [feature, agent-mode]
  created: "2026-03-02"
  updated: "2026-03-02T00:00:00.000Z"
  progress: 0
---

# Link open document when starting agent session from file header

## Goal

When clicking "Start new agent session" from the AI sessions dropdown in the editor header bar (`ai-session-start-container`), the new agent session should be pre-populated with an `@` file reference to the currently open document, so the AI has context about which file the user wants to work on.

## Current Behavior

1. User clicks the AI sessions button in the editor header bar
2. User clicks "Start new agent session" at the bottom of the dropdown
3. `handleStartAgentSession` calls `onSwitchToAgentMode(filePath)` where `filePath` is the absolute path
4. `handleSwitchToAgentMode` in `App.tsx` (line 704) receives `planDocumentPath`, switches to agent mode, then calls `agentModeRef.current.createNewSession()` -- **discarding the file path**
5. A blank session is created with no initial prompt

## Desired Behavior

Same flow, but step 4-5 should:
1. Create the new session
2. Convert the absolute file path to a workspace-relative path
3. Pre-populate the session's draft input with `@relative/path/to/file.md ` so the file is referenced

This matches the existing `@` mention syntax users already use to reference files in the AI input.

## Implementation

### Changes

**File: `packages/electron/src/renderer/App.tsx`** (~line 704)

Modify `handleSwitchToAgentMode` to, when `planDocumentPath` is provided:

1. Create a new session (same as now via `agentModeRef.current.createNewSession()` -- but we need the session ID back)
2. Compute relative path: `path.relative(workspacePath, planDocumentPath)` (using the `path` import or string manipulation since we're in the renderer)
3. Set draft input on the new session with `@relativePath ` using `setSessionDraftInputAtom`

However, `createNewSession` currently does not return the session ID. There are two approaches:

**Approach A -- Modify `createNewSession` to accept an optional initial draft and return the session ID:**

Add an optional parameter to `createNewSession` in `AgentMode.tsx`:
```ts
const createNewSession = useCallback(async (initialDraft?: string): Promise<string | undefined> => {
```

After creating the session and selecting it, if `initialDraft` is provided, set the draft input via `setSessionDraftInputAtom`. Return the session ID.

Then in App.tsx, compute the relative path and call:
```ts
const relativePath = planDocumentPath.startsWith(workspacePath)
  ? planDocumentPath.slice(workspacePath.length + 1)
  : planDocumentPath;
agentModeRef.current.createNewSession(`@${relativePath} `);
```

Update `AgentModeRef` interface to reflect the new signature.

**Approach B -- Use the `open-ai-session` custom event pattern (like GitOperationsPanel):**

Create the session directly in `handleSwitchToAgentMode` and dispatch `open-ai-session` with `draftInput`. This avoids modifying `createNewSession` but duplicates session creation logic.

### Recommended: Approach A

Approach A is simpler and keeps session creation in one place. The changes are minimal:

1. **`AgentMode.tsx`** -- `createNewSession` accepts optional `initialDraft?: string`, returns `string | undefined` (the session ID). After creating the session, if `initialDraft` is provided, calls `store.set(setSessionDraftInputAtom, { sessionId, draftInput: initialDraft, workspacePath, persist: true })`.

2. **`AgentMode.tsx`** -- Update `AgentModeRef` interface: `createNewSession: (initialDraft?: string) => Promise<string | undefined>`

3. **`App.tsx`** -- In `handleSwitchToAgentMode`, when `planDocumentPath` is provided, compute the relative path and pass it as initial draft:
   ```ts
   if (planDocumentPath) {
     const relativePath = planDocumentPath.startsWith(workspacePath + '/')
       ? planDocumentPath.slice(workspacePath!.length + 1)
       : planDocumentPath;
     agentModeRef.current.createNewSession(`@${relativePath} `);
   }
   ```

### Files Changed

| File | Change |
|------|--------|
| `packages/electron/src/renderer/components/AgentMode/AgentMode.tsx` | Add optional `initialDraft` param to `createNewSession`, set draft input atom, return session ID, update `AgentModeRef` interface |
| `packages/electron/src/renderer/App.tsx` | Compute relative path from `planDocumentPath` and pass as `initialDraft` to `createNewSession` |

### Edge Cases

- **File outside workspace**: If `planDocumentPath` doesn't start with `workspacePath`, fall back to using the absolute path (or just the filename). This shouldn't happen in practice since the file is open in the workspace editor.
- **Path separators**: Use forward slashes since `@` mentions use forward-slash relative paths.
