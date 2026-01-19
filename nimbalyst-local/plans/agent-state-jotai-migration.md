---
planStatus:
  planId: plan-agent-state-jotai-migration
  title: Agent Mode State Migration to Jotai
  status: in-development
  planType: refactor
  priority: critical
  owner: ghinkle
  stakeholders:
    - ghinkle
  tags:
    - state-management
    - jotai
    - agent-mode
    - sessions
    - worktrees
    - performance
    - architecture
  created: "2026-01-16"
  updated: "2026-01-19T00:00:00.000Z"
  progress: 45
  startDate: "2026-01-16"
---
# Agent Mode State Migration to Jotai

## Priority: App.tsx State Extraction

**The immediate focus is removing state from App.tsx that belongs in child views.**

App.tsx currently has 30+ useState variables, many of which are passed as props to child components. This causes:
1. **Full App.tsx re-renders** when any of these states change
2. **Prop drilling** - state that belongs in child views leaks into App.tsx
3. **Tight coupling** - child components depend on App.tsx rather than managing their own state

**Next Steps (Phases 4-7):**
- Phase 4: Content Mode (`activeMode`, `sidebarView`) - mode switching state
- Phase 5: Agent Mode state (`aiChatWidth`, `planningMode`, `sessionToLoad`, etc.)
- Phase 6: Settings Navigation (`settingsInitialCategory`, `settingsInitialScope`)
- Phase 7: Extension Panels (`activeExtensionPanel`)

Note: Bottom panel state (`bottomPanel`, `bottomPanelHeight`) is intentionally kept in App.tsx as it's truly global state shared across all modes.

---

## Implementation Progress

### Phase 1: Session List Atom Usage
- [x] Add `initSessionList(workspacePath)` to sessions.ts
- [x] Add `refreshSessionListAtom` action for explicit refresh
- [x] SessionHistory uses `useAtomValue(sessionListAtom)` instead of IPC
- [x] Remove `availableSessions` useState from AgenticPanel
- [ ] Session list loads from atom, not IPC
- [ ] New session appears in list without refresh
- [ ] Deleted session disappears without refresh

### Phase 2: Agent Mode Layout State
- [x] Create `agentMode.ts` with layout atoms
- [x] Remove layout useState from AgenticPanel (width, collapsed, groups, sort)
- [x] SessionHistory uses atoms for collapsed groups, sort order (via props from AgenticPanel)
- [ ] Layout persists across app restart (needs testing)

### Phase 3: Sending/Running State to Atoms
- [x] sessionProcessingAtom already exists - ensured all code paths set it
- [x] Remove `sendingSessions`, `runningSessions` useState (keep ref for sync checks)
- [x] Update message handlers to set atoms instead of useState
- [x] SessionHistory doesn't receive status props - SessionListItem subscribes to atoms
- [x] SessionDropdown updated to use SessionStatusIndicator with atoms
- [x] AgentSessionHeader updated to subscribe to sessionProcessingAtom

### Phase 4: App.tsx State Extraction - Content Mode (COMPLETED)
**Goal:** Remove cross-cutting state from App.tsx. Child views should own their state.

- [x] Create `contentMode.ts` with `activeModeAtom`, `sidebarViewAtom`
- [x] App.tsx uses atoms instead of useState for activeMode, sidebarView
- [x] Init function loads mode from workspace state
- [ ] NavigationGutter subscribes to atoms instead of receiving props (optional optimization)

### Phase 5: App.tsx State Extraction - Bottom Panel (SKIPPED - global state)
Bottom panel is intentionally kept in App.tsx as it's truly global state shared across all modes.

### Phase 6: App.tsx State Extraction - Agent Mode State
- [ ] Move `isAIChatCollapsed`, `aiChatWidth` to `agentMode.ts`
- [ ] Move `aiPlanningModeEnabled` to `agentMode.ts`
- [ ] Move `sessionToLoad`, `currentAISessionId` to `sessions.ts`
- [ ] Move `agentPlanReference` to `agentMode.ts`
- [ ] EditorMode and AgenticPanel subscribe to atoms directly

### Phase 7: App.tsx State Extraction - Settings Navigation (COMPLETED)
- [x] Create `settingsNavigation.ts` with settings deep-link atoms
- [x] App.tsx uses atoms instead of useState for settings navigation
- [x] All setSettingsKey usages updated to incrementSettingsKey()
- [x] clearSettingsNavigation() used on settings close

### Phase 8: App.tsx State Extraction - Extension Panels
- [ ] Move `activeExtensionPanel` to atoms
- [ ] NavigationGutter and PanelContainer subscribe directly
- [ ] Remove prop drilling for extension panel state

### Phase 9: Worktree State Atoms (DEFERRED)
- [ ] Create `worktrees.ts` with worktree atoms
- [ ] Remove `worktreeCache` useState from SessionHistory
- [ ] Worktree data loads on demand via atoms

### Phase 10: Session Tabs State (DEFERRED - Per-Session Editor Tabs)
- [ ] Add `sessionTabsAtomFamily` to sessions.ts
- [ ] Create `session_tabs` database table with migration
- [ ] Create IPC handlers for session tabs
- [ ] Add embedded tab bar component to AISessionView
- [ ] Open file in session creates tab
- [ ] Tab persists across app restart

### Phase 11: AgenticPanel Session Tabs Cleanup
- [ ] Add `openSessionTabsAtom` and `activeSessionTabIdAtom`
- [ ] Remove `sessionTabs`, `activeTabId`, `closedSessions` useState
- [ ] Session tabs persist across refresh

### Phase 12: Documentation
- [ ] Update CLAUDE.md with agent state atom patterns
- [ ] Document session atom family usage
- [ ] Document scale considerations for atom families

## Overview

This plan covers migrating the remaining major application state from React useState/prop drilling to Jotai atoms. This is a continuation of the settings migration (see `settings-jotai-migration.md`) and focuses specifically on the "agent mode" state including sessions, worktrees, and the new per-session editor tabs feature.

### Context

The codebase has been incrementally adopting Jotai to solve state management problems:

**Completed:**
- Voice mode settings (atoms in `appSettings.ts`)
- Notification settings (atoms in `appSettings.ts`)
- Per-session status indicators (`sessions.ts` atom families)
- File tabs in files mode (`TabsContext.tsx` with useSyncExternalStore pattern)
- Project state (atoms in `projectState.ts`)
- Theme (atoms in `theme.ts`)

**In Progress:**
- Settings migration (Phases 3-7 in `settings-jotai-migration.md`)

**Problematic:**
- Agent mode session state (useState in AgenticPanel)
- App.tsx mode switching state
- Session list loading (IPC instead of atoms)
- Worktree cache (component-local state)

## Problem Statement

### 1. AgenticPanel State Explosion

`AgenticPanel.tsx` maintains 25+ useState variables for session management:

```typescript
const [sessionTabs, setSessionTabs] = useState<SessionTab[]>([]);
const [activeTabId, setActiveTabId] = useState<string | null>(null);
const [availableSessions, setAvailableSessions] = useState<SessionListItem[]>([]);
const [closedSessions, setClosedSessions] = useState<SessionTab[]>([]);
const [sendingSessions, setSendingSessions] = useState<Set<string>>(new Set());
const [runningSessions, setRunningSessions] = useState<Set<string>>(new Set());
const [pendingPromptSessions, setPendingPromptSessions] = useState<Set<string>>(new Set());
const [historyPosition, setHistoryPosition] = useState<Map<string, number>>(new Map());
const [savedDraft, setSavedDraft] = useState<Map<string, string>>(new Map());
const [sessionHistoryWidth, setSessionHistoryWidth] = useState(240);
const [sessionHistoryCollapsed, setSessionHistoryCollapsed] = useState(mode === 'chat');
const [collapsedGroups, setCollapsedGroups] = useState<string[]>([]);
const [sortOrder, setSortOrder] = useState<'updated' | 'created'>('updated');
const [worktreeModes, setWorktreeModes] = useState<Map<string, WorktreeContentMode>>(new Map());
// ... and more
```

**Problems:**
- Any state change causes AgenticPanel to re-render
- SessionHistory receives new Set references on every parent render
- AISessionView components must memo-check extensively
- No cross-window synchronization

### 2. App.tsx Re-render Cascade (CRITICAL)

App.tsx holds 40+ useState variables. **Any change triggers re-render of the entire component tree.** This is one of the most damaging architectural issues in the codebase.

**Complete inventory of App.tsx useState (as of 2026-01-16):**

```typescript
// === MUST MOVE TO ATOMS (cross-cutting state) ===
const [activeMode, setActiveModeRaw] = useState<ContentMode>('files');           // Line 315
const [sessionToLoad, setSessionToLoad] = useState<...>();                        // Line 268
const [currentAISessionId, setCurrentAISessionId] = useState<string | null>(null); // Line 269
const [sidebarView, setSidebarView] = useState<SidebarView>('files');            // Line 299
const [bottomPanel, setBottomPanel] = useState<TrackerBottomPanelType | null>(null); // Line 350
const [bottomPanelHeight, setBottomPanelHeight] = useState<number>(300);         // Line 351
const [activeExtensionPanel, setActiveExtensionPanel] = useState<string | null>(null); // Line 302
const [isAIChatCollapsed, setIsAIChatCollapsed] = useState(false);               // Line 256
const [aiChatWidth, setAIChatWidth] = useState<number>(350);                     // Line 257
const [aiPlanningModeEnabled, setAIPlanningModeEnabled] = useState<boolean>(true); // Line 264
const [agentPlanReference, setAgentPlanReference] = useState<string | null>(null); // Line 354

// === SHOULD MOVE TO ATOMS (UI layout/settings) ===
const [settingsInitialCategory, setSettingsInitialCategory] = useState<...>();   // Line 294
const [settingsInitialScope, setSettingsInitialScope] = useState<...>();         // Line 295
const [settingsKey, setSettingsKey] = useState(0);                               // Line 296
const [forceShowTrustToast, setForceShowTrustToast] = useState(false);          // Line 267

// === ACCEPTABLE AS LOCAL STATE (dialog open/close) ===
const [isQuickOpenVisible, setIsQuickOpenVisible] = useState(false);             // Line 251
const [isSessionQuickOpenVisible, setIsSessionQuickOpenVisible] = useState(false); // Line 252
const [isAgentPaletteVisible, setIsAgentPaletteVisible] = useState(false);       // Line 253
const [isKeyboardShortcutsDialogOpen, setIsKeyboardShortcutsDialogOpen] = useState(false); // Line 258
const [isDiscordInvitationOpen, setIsDiscordInvitationOpen] = useState(false);   // Line 259
const [isPostHogSurveyOpen, setIsPostHogSurveyOpen] = useState(false);          // Line 260
const [isWindowsClaudeCodeWarningOpen, setIsWindowsClaudeCodeWarningOpen] = useState(false); // Line 261
const [isApiKeyDialogOpen, setIsApiKeyDialogOpen] = useState(false);             // Line 265
const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);                 // Line 284
const [isFeatureWalkthroughOpen, setIsFeatureWalkthroughOpen] = useState(false); // Line 287
const [showCommandsToast, setShowCommandsToast] = useState(false);               // Line 290
const [diffError, setDiffError] = useState<...>();                               // Line 270
const [projectSelection, setProjectSelection] = useState<...>();                 // Line 276

// === INITIALIZATION STATE (acceptable) ===
const [extensionsReady, setExtensionsReady] = useState(false);                   // Line 118
const [isInitializing, setIsInitializing] = useState(true);                      // Line 245
const [workspaceMode, setWorkspaceMode] = useState(false);                       // Line 247
const [workspacePath, setWorkspacePath] = useState<string | null>(null);         // Line 248
const [workspaceName, setWorkspaceName] = useState<string | null>(null);         // Line 249
const [isAIChatStateLoaded, setIsAIChatStateLoaded] = useState(false);          // Line 262
```

**The core problem:** When `activeMode` changes (e.g., switching from 'files' to 'agent'), App.tsx re-renders. This causes:
1. All 1900+ lines of App.tsx to re-execute
2. All child components to receive new prop references
3. Re-renders cascading through EditorMode, AgenticPanel, and all their children
4. Even components hidden via `display: none` must reconcile

**Why props are the problem:** Every function or object passed as a prop (like `onContentModeChange={setActiveMode}`) creates a new reference on each App.tsx render, potentially triggering child re-renders even with memo.

### 3. Session List Not Using Atoms

Despite `sessionListAtom` existing in `sessions.ts`, SessionHistory loads sessions via IPC:

```typescript
// SessionHistory component
const sessions = await window.electronAPI.invoke('sessions:list', workspacePath);
```

This defeats the purpose of having a centralized atom for session list state.

### 4. Per-Session Tabs (New Requirement)

Users want to open and edit files within the context of an AI session or worktree. This requires:
- Each session manages its own set of open file tabs
- Tab state must persist per-session
- Scale consideration: Users may have 1000+ sessions

### 5. Worktree State Scattered

Worktree data is loaded on-demand and cached in component-local state:

```typescript
// SessionHistory
const [worktreeCache, setWorktreeCache] = useState<Map<string, WorktreeInfo>>();
```

No shared worktree atom exists for cross-component access.

## Target Architecture

### Jotai Atom Structure

```
store/atoms/
├── sessions.ts (expand existing)
│   ├── sessionListAtom (already exists - needs proper usage)
│   ├── activeSessionIdAtom (already exists - needs proper usage)
│   ├── sessionProcessingAtom(sessionId) (already exists)
│   ├── sessionUnreadAtom(sessionId) (already exists)
│   ├── sessionPendingPromptAtom(sessionId) (already exists)
│   │
│   ├── sessionTabsAtomFamily(sessionId) -- NEW: per-session open tabs
│   ├── sessionActiveTabAtomFamily(sessionId) -- NEW: active tab per session
│   ├── sessionDraftAtomFamily(sessionId) -- NEW: draft input per session
│   │
│   ├── runningSessionsAtom -- NEW: derived from sessionListAtom
│   └── sendingSessionsAtom -- NEW: derived from processing state
│
├── worktrees.ts (new file)
│   ├── worktreeListAtom
│   ├── worktreeAtomFamily(worktreeId)
│   ├── worktreeSessionsAtomFamily(worktreeId) -- sessions in worktree
│   └── initWorktrees() function
│
├── agentMode.ts (new file)
│   ├── agentModeLayoutAtom
│   │   └── { sessionHistoryWidth, sessionHistoryCollapsed, collapsedGroups, sortOrder }
│   ├── setAgentModeLayoutAtom -- setter with persistence
│   └── initAgentModeLayout() function
│
└── contentMode.ts (new file - or add to projectState.ts)
    ├── activeModeAtom -- 'files' | 'agent' | 'settings'
    └── modeTransitionInProgressAtom
```

### Component Architecture Changes

**Before (prop drilling):**
```
App.tsx (40+ useState)
    ├── activeMode, sessionToLoad, currentAISessionId
    └── AgenticPanel (25+ useState)
        ├── sessionTabs, activeTabId, sendingSessions, etc.
        └── SessionHistory (receives Sets as props)
            └── SessionListItem
```

**After (atom subscription):**
```
App.tsx (minimal useState for UI-only state)
    └── AgenticPanel (minimal useState)
        └── Uses atoms directly

SessionHistory
    └── useAtomValue(sessionListAtom) -- subscribes directly

SessionListItem
    └── useAtomValue(sessionProcessingAtom(id)) -- subscribes directly

AISessionView
    └── useAtomValue(sessionTabsAtomFamily(sessionId)) -- per-session tabs
```

### Per-Session Tabs Design

Each session gets its own tab management via atom family:

```typescript
interface SessionTabData {
  id: string;
  filePath: string;
  fileName: string;
  isDirty: boolean;
  // Note: content is NOT stored here - EditorHost pattern
}

interface SessionTabsState {
  tabs: SessionTabData[];
  tabOrder: string[];
  activeTabId: string | null;
}

// Atom family keyed by session ID
export const sessionTabsAtomFamily = atomFamily(
  (sessionId: string) => atom<SessionTabsState>({
    tabs: [],
    tabOrder: [],
    activeTabId: null,
  })
);
```

**Scale Considerations (1000+ sessions):**
- Atom families only create atoms for accessed sessions
- Tab state is NOT loaded until session is opened
- Persisted to database, not all in memory
- Cleanup: `sessionTabsAtomFamily.remove(sessionId)` when session deleted

### Persistence Strategy

| Data Type | Storage | Load Strategy |
| --- | --- | --- |
| Session list | PGLite | Load on workspace open, hydrate `sessionListAtom` |
| Per-session tabs | PGLite (`session_tabs` table) | Load on session open, hydrate atom family instance |
| Agent layout (widths, collapsed) | workspace-settings | Load once, persist debounced |
| Worktree cache | PGLite | Load batch on demand, cache in atom |
| Active mode | workspace-settings | Load on mount, persist on change |

## Implementation Plan

### Phase Order Rationale

The phases are ordered to build incrementally, but **Phase 9 (App.tsx cleanup) is the highest-impact change**. Consider whether to tackle it earlier:

**Arguments for doing Phase 9 early:**
- App.tsx re-renders are the root cause of most cascade issues
- Fixing it first stops the bleeding, making other phases easier to validate
- It's mostly additive (new atom files) rather than changing complex logic

**Arguments for current order:**
- Session atoms (Phase 1-3) are lower risk and establish patterns
- AgenticPanel cleanup first means fewer things depend on App.tsx props
- Gradual migration reduces debugging surface area

**Recommendation:** Start with Phases 1-3 (lower risk), then jump to Phase 9, then return to 4-8.

---

### Phase 1: Session List Atom Usage

**Goal:** SessionHistory uses `sessionListAtom` instead of IPC polling.

**Files to Modify:**
1. `packages/electron/src/renderer/store/atoms/sessions.ts`
  - Add `initSessionList(workspacePath)` function
  - Add `refreshSessionListAtom` action for explicit refresh

2. `packages/electron/src/renderer/index.tsx` (or app init)
  - Call `initSessionList()` after workspace path known

3. `packages/electron/src/renderer/components/AgenticCoding/SessionHistory.tsx`
  - Replace `useState` session list with `useAtomValue(sessionListAtom)`
  - Remove IPC `sessions:list` calls
  - Receive updates via atom subscription

4. `packages/electron/src/renderer/components/UnifiedAI/AgenticPanel.tsx`
  - Remove `availableSessions` useState
  - Use atom for session operations

**Validation:**
- [ ] Session list loads from atom, not IPC
- [ ] New session appears in list without refresh
- [ ] Deleted session disappears without refresh
- [ ] Session rename reflects immediately

### Phase 2: Agent Mode Layout State

**Goal:** Session history layout (width, collapsed, sort) managed via atoms.

**Files to Create/Modify:**
1. `packages/electron/src/renderer/store/atoms/agentMode.ts` (new)
```typescript
   export interface AgentModeLayout {
     sessionHistoryWidth: number;
     sessionHistoryCollapsed: boolean;
     collapsedGroups: string[];
     sortOrder: 'updated' | 'created';
   }

   export const agentModeLayoutAtom = atom<AgentModeLayout>({
     sessionHistoryWidth: 240,
     sessionHistoryCollapsed: false,
     collapsedGroups: [],
     sortOrder: 'updated',
   });

   export const setAgentModeLayoutAtom = atom(
     null,
     async (get, set, updates: Partial<AgentModeLayout>) => {
       const current = get(agentModeLayoutAtom);
       const newLayout = { ...current, ...updates };
       set(agentModeLayoutAtom, newLayout);
       scheduleAgentLayoutPersist(newLayout);
     }
   );

   export async function initAgentModeLayout(workspacePath: string) {
     const saved = await window.electronAPI.invoke('workspace:get-state', workspacePath);
     if (saved?.agentLayout) {
       store.set(agentModeLayoutAtom, saved.agentLayout);
     }
   }
```

2. `packages/electron/src/renderer/components/UnifiedAI/AgenticPanel.tsx`
  - Remove: `sessionHistoryWidth`, `sessionHistoryCollapsed`, `collapsedGroups`, `sortOrder` useState
  - Use: `useAtom(agentModeLayoutAtom)` or derived atoms

3. `packages/electron/src/renderer/components/AgenticCoding/SessionHistory.tsx`
  - Use atoms for collapsed groups, sort order

**Validation:**
- [ ] Layout persists across app restart
- [ ] Changing sort order doesn't cause AgenticPanel re-render
- [ ] Width resize doesn't cause session list re-render

### Phase 3: Sending/Running State to Atoms

**Goal:** Move `sendingSessions`, `runningSessions`, `pendingPromptSessions` to atoms.

**Rationale:** These are already partially in atoms (`sessionProcessingAtom`) but AgenticPanel duplicates with useState Sets.

**Files to Modify:**
1. `packages/electron/src/renderer/store/atoms/sessions.ts`
  - Add `sessionSendingAtom(sessionId)` atom family
  - Add derived `anySendingAtom`
  - Ensure all status atoms are properly typed and documented

2. `packages/electron/src/renderer/components/UnifiedAI/AgenticPanel.tsx`
  - Remove: `sendingSessions`, `runningSessions`, `pendingPromptSessions` useState
  - Use atom families directly where needed
  - Update message handlers to set atoms instead of useState

3. `packages/electron/src/renderer/components/AgenticCoding/SessionHistory.tsx`
  - Remove status Set props
  - Use atoms directly (already partially done via SessionStatusIndicator)

**Validation:**
- [ ] SessionHistory doesn't re-render when session status changes
- [ ] Processing indicator still works
- [ ] Unread indicator still works

### Phase 4: Worktree State Atoms

**Goal:** Create centralized worktree state management.

**Files to Create:**
1. `packages/electron/src/renderer/store/atoms/worktrees.ts`
```typescript
   export interface WorktreeInfo {
     id: string;
     workspacePath: string;
     worktreePath: string;
     branchName: string;
     displayName?: string;
     createdAt: number;
   }

   export const worktreeMapAtom = atom<Map<string, WorktreeInfo>>(new Map());

   export const worktreeAtomFamily = atomFamily(
     (worktreeId: string) => atom(
       (get) => get(worktreeMapAtom).get(worktreeId) ?? null
     )
   );

   export const loadWorktreeBatchAtom = atom(
     null,
     async (get, set, worktreeIds: string[]) => {
       const current = get(worktreeMapAtom);
       const missing = worktreeIds.filter(id => !current.has(id));
       if (missing.length === 0) return;

       const loaded = await window.electronAPI.invoke('worktree:get-batch', missing);
       const newMap = new Map(current);
       loaded.forEach((wt: WorktreeInfo) => newMap.set(wt.id, wt));
       set(worktreeMapAtom, newMap);
     }
   );
```

2. `packages/electron/src/renderer/components/AgenticCoding/SessionHistory.tsx`
  - Remove: `worktreeCache` useState
  - Use: `useSetAtom(loadWorktreeBatchAtom)` for loading
  - Use: `useAtomValue(worktreeAtomFamily(id))` for reading

**Validation:**
- [ ] Worktree data loads on demand
- [ ] Worktree data shared across components
- [ ] Worktree rename reflects immediately

### Phase 5: Session Tabs State (NEW)

**Goal:** Each session manages its own set of open file tabs.

**Files to Create/Modify:**
1. `packages/electron/src/renderer/store/atoms/sessions.ts`
```typescript
   export interface SessionTabData {
     id: string;
     filePath: string;
     fileName: string;
     isDirty: boolean;
     isPinned: boolean;
   }

   export interface SessionTabsState {
     tabs: Map<string, SessionTabData>;
     tabOrder: string[];
     activeTabId: string | null;
   }

   export const sessionTabsAtomFamily = atomFamily(
     (sessionId: string) => atom<SessionTabsState>({
       tabs: new Map(),
       tabOrder: [],
       activeTabId: null,
     })
   );

   // Derived atom for specific session's active tab
   export const sessionActiveTabAtomFamily = atomFamily(
     (sessionId: string) => atom(
       (get) => {
         const state = get(sessionTabsAtomFamily(sessionId));
         return state.activeTabId ? state.tabs.get(state.activeTabId) ?? null : null;
       }
     )
   );
```

2. **Database Schema Update** (new table)
```sql
   CREATE TABLE session_tabs (
     id TEXT PRIMARY KEY,
     session_id TEXT NOT NULL REFERENCES ai_sessions(id) ON DELETE CASCADE,
     file_path TEXT NOT NULL,
     file_name TEXT NOT NULL,
     is_dirty INTEGER DEFAULT 0,
     is_pinned INTEGER DEFAULT 0,
     position INTEGER NOT NULL,
     created_at INTEGER DEFAULT (unixepoch() * 1000)
   );
   CREATE INDEX idx_session_tabs_session ON session_tabs(session_id);
```

3. `packages/electron/src/renderer/components/UnifiedAI/AISessionView.tsx`
  - Add embedded tab bar component
  - Use `useAtom(sessionTabsAtomFamily(sessionId))`
  - EditorHost pattern for tab content

4. New component: `SessionTabBar.tsx`
  - Renders tabs within session context
  - Tab actions: add, remove, switch, pin
  - Integrates with session-specific EditorHost

5. **IPC Handlers** (main process)
  - `session-tabs:list` - Load tabs for session
  - `session-tabs:add` - Add tab
  - `session-tabs:remove` - Remove tab
  - `session-tabs:update` - Update tab (dirty, pin)
  - `session-tabs:reorder` - Reorder tabs

**Persistence Strategy:**
- Tabs persist to database on change (debounced)
- Load on session open (not all at once)
- Cleanup on session delete (CASCADE)

**Scale Considerations:**
- Max 1000+ sessions with tabs
- Only load tabs for open sessions
- Atom family instances created lazily
- Cleanup atoms when sessions closed

**Validation:**
- [ ] Open file in session creates tab
- [ ] Tab persists across app restart
- [ ] Multiple sessions have independent tabs
- [ ] Tab dirty state tracks correctly
- [ ] Session delete cleans up tabs

### Phase 6: Active Mode Atom

**Goal:** Move `activeMode` from App.tsx useState to atom.

**Rationale:** Mode changes should NOT cause full App.tsx re-render. Only the mode-specific panel needs to know about mode changes.

**Files to Modify:**
1. `packages/electron/src/renderer/store/atoms/projectState.ts` (or new contentMode.ts)
```typescript
   export type ContentMode = 'files' | 'agent' | 'settings';

   export const activeModeAtom = atom<ContentMode>('files');

   export const setActiveModeAtom = atom(
     null,
     async (get, set, mode: ContentMode) => {
       set(activeModeAtom, mode);
       // Persist to workspace state
       const workspacePath = get(workspacePathAtom);
       if (workspacePath) {
         await window.electronAPI.invoke('workspace:update-state', workspacePath, {
           activeMode: mode,
         });
       }
     }
   );
```

2. `packages/electron/src/renderer/App.tsx`
  - Remove: `activeMode` useState
  - Use: `useAtomValue(activeModeAtom)` for reading
  - Use: `useSetAtom(setActiveModeAtom)` for writing
  - Mode panels subscribe independently

3. `packages/electron/src/renderer/components/NavigationGutter.tsx`
  - Use atom for active mode indicator

**Validation:**
- [ ] Mode switch doesn't re-render App.tsx
- [ ] Mode persists across restart
- [ ] Keyboard shortcuts still work

### Phase 7: Session Tabs in AgenticPanel

**Goal:** Replace AgenticPanel `sessionTabs` useState with atoms.

This is the largest change - moving the open session tabs from component state to atoms.

**Files to Modify:**
1. `packages/electron/src/renderer/store/atoms/sessions.ts`
```typescript
   export interface OpenSessionTab {
     sessionId: string;
     name: string;
     isPinned: boolean;
     draftInput?: string;
     mode?: 'planning' | 'agent';
   }

   // All open session tabs (like file tabs in TabsContext)
   export const openSessionTabsAtom = atom<OpenSessionTab[]>([]);
   export const activeSessionTabIdAtom = atom<string | null>(null);

   // Actions
   export const addSessionTabAtom = atom(null, (get, set, sessionId: string) => { ... });
   export const removeSessionTabAtom = atom(null, (get, set, sessionId: string) => { ... });
   export const switchSessionTabAtom = atom(null, (get, set, sessionId: string) => { ... });
```

2. `packages/electron/src/renderer/components/UnifiedAI/AgenticPanel.tsx`
  - Remove: `sessionTabs`, `activeTabId`, `closedSessions` useState
  - Use: atoms for session tabs
  - Significantly reduce component state

3. `packages/electron/src/renderer/components/UnifiedAI/SessionTabBar.tsx` (if exists)
  - Use atoms directly

**Validation:**
- [ ] Session tabs persist across refresh
- [ ] Tab switch doesn't re-render all AISessionViews
- [ ] Closed session can be reopened

### Phase 8: AgenticPanel Cleanup

**Goal:** AgenticPanel becomes a thin orchestration shell.

After phases 1-7, AgenticPanel should have minimal useState:
- UI-only state (loading spinners, error messages)
- Refs for imperative operations

**Target State Count:** < 5 useState variables (down from 25+)

**Remaining useState (acceptable):**
- `loading` - initial load spinner
- `error` - error message display
- Dialog states (import dialog, onboarding modal)

**Files to Modify:**
1. `packages/electron/src/renderer/components/UnifiedAI/AgenticPanel.tsx`
  - Audit all remaining useState
  - Move any cross-cutting state to atoms
  - Ensure no prop drilling to children

### Phase 9: App.tsx State Extraction (MAJOR)

**Goal:** Extract all cross-cutting state from App.tsx to atoms. App.tsx becomes a thin layout shell.

This is a critical phase that addresses the core architectural problem. **Every useState in App.tsx that leaves the file as a prop must be migrated.**

**State to Move to Atoms:**

| State Variable | Current | Target Atom File | Rationale |
| --- | --- | --- | --- |
| `activeMode` | useState | `contentMode.ts` | Cross-cutting, causes full re-render |
| `sidebarView` | useState | `contentMode.ts` | Sidebar needs to read without App.tsx re-render |
| `bottomPanel` | useState | `bottomPanel.ts` | TrackerBottomPanel reads it |
| `bottomPanelHeight` | useState | `bottomPanel.ts` | Same as above |
| `activeExtensionPanel` | useState | `extensionPanels.ts` | NavigationGutter, PanelContainer read it |
| `isAIChatCollapsed` | useState | `agentMode.ts` | EditorMode passes to child |
| `aiChatWidth` | useState | `agentMode.ts` | Same as above |
| `aiPlanningModeEnabled` | useState | `agentMode.ts` | AgenticPanel reads it |
| `sessionToLoad` | useState | `sessions.ts` | Agent-specific, triggers mode switch |
| `currentAISessionId` | useState | `sessions.ts` | Agent-specific |
| `agentPlanReference` | useState | `agentMode.ts` | Passed to AgenticPanel |
| `settingsInitialCategory` | useState | `settingsNavigation.ts` | Settings deep linking |
| `settingsInitialScope` | useState | `settingsNavigation.ts` | Same as above |
| `forceShowTrustToast` | useState | `projectState.ts` | Trust system state |

**Files to Create/Modify:**

1. **`packages/electron/src/renderer/store/atoms/contentMode.ts`** (new)
```typescript
   import { atom } from 'jotai';
   import { atomWithStorage } from 'jotai/utils';

   export type ContentMode = 'files' | 'agent' | 'settings';
   export type SidebarView = 'files' | 'settings';

   // Active content mode (files, agent, settings)
   export const activeModeAtom = atom<ContentMode>('files');

   // Sidebar view within files mode
   export const sidebarViewAtom = atom<SidebarView>('files');

   // Setter with persistence
   export const setActiveModeAtom = atom(
     null,
     async (get, set, mode: ContentMode) => {
       set(activeModeAtom, mode);
       // Persist handled separately by workspace state effect
     }
   );
```

2. **`packages/electron/src/renderer/store/atoms/bottomPanel.ts`** (new)
```typescript
   import { atom } from 'jotai';

   export type BottomPanelType = 'plan' | 'bug' | 'task' | 'idea' | null;

   export const bottomPanelAtom = atom<BottomPanelType>(null);
   export const bottomPanelHeightAtom = atom<number>(300);

   export const toggleBottomPanelAtom = atom(
     null,
     (get, set, panelType: BottomPanelType) => {
       const current = get(bottomPanelAtom);
       set(bottomPanelAtom, current === panelType ? null : panelType);
     }
   );
```

3. **`packages/electron/src/renderer/store/atoms/settingsNavigation.ts`** (new)
```typescript
   import { atom } from 'jotai';
   import type { SettingsCategory } from '../components/Settings/SettingsSidebar';
   import type { SettingsScope } from '../components/Settings/SettingsView';

   export const settingsInitialCategoryAtom = atom<SettingsCategory | undefined>(undefined);
   export const settingsInitialScopeAtom = atom<SettingsScope | undefined>(undefined);
   export const settingsKeyAtom = atom(0);

   // Navigate to specific settings panel
   export const navigateToSettingsAtom = atom(
     null,
     (get, set, { category, scope }: { category: SettingsCategory; scope?: SettingsScope }) => {
       set(settingsInitialCategoryAtom, category);
       set(settingsInitialScopeAtom, scope);
       set(settingsKeyAtom, (k) => k + 1);
       set(activeModeAtom, 'settings');
     }
   );
```

4. **Update ****`packages/electron/src/renderer/App.tsx`**
  - Remove all migrated useState variables
  - Replace with `useAtomValue` for reading, `useSetAtom` for writing
  - Remove props that drill atoms down - children use atoms directly
  - Dramatically reduce component complexity

5. **Update all consumers:**
  - `NavigationGutter.tsx` - Use `useAtomValue(activeModeAtom)` instead of props
  - `EditorMode.tsx` - Use atoms for mode, chat collapsed state
  - `AgenticPanel.tsx` - Use atoms for mode, planning enabled
  - `TrackerBottomPanel.tsx` - Use atoms for panel state
  - `SettingsView.tsx` - Use atoms for navigation state

**Before/After App.tsx:**

```typescript
// BEFORE: 40+ useState, props drilled everywhere
function App() {
  const [activeMode, setActiveMode] = useState<ContentMode>('files');
  // ... 39 more useState ...

  return (
    <NavigationGutter
      contentMode={activeMode}              // PROP
      onContentModeChange={setActiveMode}   // PROP (new function reference each render)
      bottomPanel={bottomPanel}             // PROP
      onTogglePlansPanel={() => {...}}      // PROP (new function each render)
      // ... many more props
    />
  );
}

// AFTER: Minimal useState, children subscribe to atoms
function App() {
  // Only initialization and dialog state
  const [isInitializing, setIsInitializing] = useState(true);
  const [isQuickOpenVisible, setIsQuickOpenVisible] = useState(false);
  // ... dialog states only ...

  return (
    <NavigationGutter
      workspacePath={workspacePath}
      // NO mode props - NavigationGutter uses atoms directly
    />
  );
}

// NavigationGutter.tsx - subscribes to atoms
function NavigationGutter({ workspacePath }) {
  const activeMode = useAtomValue(activeModeAtom);
  const setActiveMode = useSetAtom(setActiveModeAtom);
  const bottomPanel = useAtomValue(bottomPanelAtom);
  const toggleBottomPanel = useSetAtom(toggleBottomPanelAtom);
  // No re-render when App.tsx re-renders for unrelated reasons!
}
```

**Target State Count:**

| Category | Current Count | Target Count |
| --- | --- | --- |
| Cross-cutting state | 15 | 0 |
| Dialog open/close | 12 | 12 (acceptable) |
| Initialization | 5 | 5 (acceptable) |
| Total useState | ~40 | ~17 |

**Validation:**
- [ ] App.tsx doesn't re-render when activeMode changes
- [ ] NavigationGutter updates independently of App.tsx
- [ ] Bottom panel toggle doesn't cascade to EditorMode
- [ ] Settings deep link works via atoms
- [ ] No prop drilling for mode/panel state

### Phase 10: CLAUDE.md Updates

**Goal:** Document Jotai patterns for agent state.

Add to CLAUDE.md:
- Agent state atom patterns
- Session atom family usage
- When to use per-session atoms vs global atoms
- Scale considerations for atom families

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Breaking session persistence | Incremental migration with extensive testing |
| Performance regression from atom overhead | Benchmark before/after; atom families are lazy |
| Memory leaks from atom families | Implement cleanup when sessions deleted |
| Database migration issues | Add `session_tabs` table with migration script |
| Cross-window sync complexity | Focus on single-window first, add cross-window later |

## Testing Strategy

### Unit Tests
- Atom actions (add session, remove session, update tabs)
- Derived atom calculations
- Persistence functions

### Integration Tests
- Session list loads correctly
- Tab state persists and restores
- Status indicators update

### E2E Tests
- Create session, verify in list
- Open file in session, verify tab
- Switch modes, verify no data loss
- Restart app, verify state restored

## Success Metrics

1. **Performance:**
  - AgenticPanel renders < 5x per minute during idle
  - Mode switch completes in < 100ms
  - Session list updates without full re-render

2. **Developer Experience:**
  - useState count in AgenticPanel < 5
  - No prop drilling for session state
  - Clear atom patterns for new features

3. **User Experience:**
  - Session tabs persist across restart
  - Instant feedback on session status
  - Files can be opened within sessions

## Dependencies

- Completes after settings migration Phase 2 (notifications)
- Independent of settings migration Phases 3-7
- Database migration for `session_tabs` table

## References

- `nimbalyst-local/plans/settings-jotai-migration.md` - Companion plan for settings
- `packages/electron/src/renderer/store/atoms/sessions.ts` - Existing session atoms
- `packages/electron/src/renderer/contexts/TabsContext.tsx` - Pattern to follow for tabs
- `packages/electron/src/renderer/store/atoms/projectState.ts` - Blob atom pattern
