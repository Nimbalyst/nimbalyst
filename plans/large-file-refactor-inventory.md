---
planStatus:
  planId: plan-large-file-refactor
  title: Large File Refactor Inventory
  status: draft
  planType: refactor
  priority: medium
  owner: ghinkle
  stakeholders: []
  tags:
    - refactor
    - ai-agent-ergonomics
    - code-quality
  created: "2026-02-20"
  updated: "2026-02-20T00:00:00.000Z"
  progress: 0
---
# Large File Refactor Inventory

## Motivation

Many source files exceed 1,000 lines, making them difficult for AI agents (and humans) to reason about in a single context window. The goal is to break these files along natural seams -- grouping related functionality into cohesive modules -- while also DRYing out duplicated patterns discovered during the audit.

**Total codebase:** ~192K lines of TypeScript/TSX (excluding tests, e2e, node_modules, dist).

---

## Inventory: Files Over 800 Lines

| Lines | File | Package |
| --- | --- | --- |
| 4,258 | `main/mcp/httpServer.ts` | electron |
| 3,461 | `main/services/ai/ClaudeCodeProvider.ts` | electron |
| 2,399 | `main/mcp/extensionDevServer.ts` | electron |
| 2,657 | `renderer/components/TabEditor/TabEditor.tsx` | electron |
| 2,029 | `plugins/TablePlugin/TablePlugin.tsx` | rexical |
| 1,958 | `renderer/components/AgentMode/AgentMode.tsx` | electron |
| 1,816 | `plugins/ToolbarPlugin/ToolbarPlugin.tsx` | rexical |
| 1,728 | `main/services/ai/AIService.ts` | electron |
| 1,568 | `renderer/components/UnifiedAI/ChatMessages.tsx` | electron |
| 1,478 | `runtime/src/ai/server/types.ts` | runtime |
| 1,375 | `renderer/components/AgenticCoding/SessionListItem.tsx` | electron |
| 1,350 | `runtime/src/sync/SyncClientV3.ts` | runtime |
| 1,306 | `rexical/src/RexicalEditor.tsx` | rexical |
| 1,289 | `renderer/components/NavigationGutter/NavigationGutter.tsx` | electron |
| 1,259 | `plugins/TablePlugin/TableCellActionMenuPlugin.tsx` | rexical |
| 1,237 | `main/services/ai/ClaudeCodePermissions.ts` | electron |
| 1,234 | `renderer/components/TabEditor/TabEditor.tsx` | electron |
| 1,119 | `renderer/components/Settings/VoiceModePanel.tsx` | electron |
| 1,080 | `renderer/components/UnifiedAI/AIInput.tsx` | electron |
| 1,061 | `main/window/WindowManager.ts` | electron |
| 1,044 | `plugins/DragDropPlugin/DragDropPlugin.tsx` | rexical |
| 1,043 | `main/database/worker.js` | electron |
| 1,032 | `renderer/components/UnifiedAI/ToolCallDisplay.tsx` | electron |
| 1,029 | `rexical/src/themes/registry.ts` | rexical |
| 1,000 | `renderer/store/atoms/agenticCodingState.ts` | electron |
| 988 | `main/ipc/WorkspaceHandlers.ts` | electron |
| 950 | `main/services/voice/VoiceModeService.ts` | electron |
| 935 | `plugins/TablePlugin/TableHoverActionsPlugin.tsx` | rexical |
| 934 | `renderer/components/FileTree/FileTree.tsx` | electron |
| 929 | `plugins/SlashMenuPlugin/SlashMenuPlugin.tsx` | rexical |
| 925 | `renderer/components/AgenticCoding/AgenticCodingSidebar.tsx` | electron |
| 918 | `runtime/src/extensions/ExtensionLoader.ts` | runtime |
| 916 | `main/services/voice/RealtimeAPIClient.ts` | electron |
| 916 | `collabv3/src/session-sync.ts` | collabv3 |
| 907 | `main/services/ai/ClaudeCodeToolWidgets.ts` | electron |
| 879 | `renderer/components/QuickOpenDialog/QuickOpenDialog.tsx` | electron |
| 862 | `main/ipc/FileHandlers.ts` | electron |
| 843 | `capacitor/src/components/SessionDetail/SessionDetailView.tsx` | capacitor |
| 824 | `renderer/components/Settings/SettingsDialog.tsx` | electron |
| 812 | `main/ipc/AIHandlers.ts` | electron |
| 810 | `extensions/mockuplm/src/MockupEditor.tsx` | extensions |
| 800 | `main/services/ai/ClaudeCodeMCPServers.ts` | electron |

---

## Cluster Analysis

### Cluster 0: MCP Server Layer (9,708 lines total) -- PRIORITY: HIGHEST

**Directory:** `packages/electron/src/main/mcp/`

The heaviest directory in the project, previously missed from the inventory. Contains the internal MCP servers that expose Nimbalyst tools to Claude Code.

#### 0a. httpServer.ts (4,258 lines) -- PRIORITY: HIGHEST

The single largest file in the entire project. A monolith containing:
- Image compression utility (lines 32-149)
- Module-level state maps for transports, sessions, workspace mappings (lines 151-181)
- Window/workspace resolution logic (lines 183-606)
- Extension tool management (lines 266-438)
- Server lifecycle (cleanup, shutdown, startup) (lines 608-762)
- `createSharedMcpServer()` which contains:
  - Tool schema definitions (~550 lines of inline JSON in ListToolsRequestSchema handler)
  - Giant switch statement for tool execution (~2,500 lines in CallToolRequestSchema handler)
    - applyDiff, streamContent, open_workspace, capture_editor_screenshot
    - display_to_user (350 lines of validation)
    - voice_agent_speak, voice_agent_stop
    - AskUserQuestion (230 lines with IPC + DB polling)
    - get_session_edited_files
    - developer_git_commit_proposal (440 lines with auto-commit)
    - tracker_list, tracker_get, tracker_create, tracker_update, tracker_link_session
    - Extension tool execution (default case)
- HTTP transport routing (SSE + Streamable HTTP) (lines 3939-4258)

| Extractable Module | Est. Lines | Description |
| --- | --- | --- |
| `mcpToolSchemas.ts` | ~550 | Tool schema definitions. Export `getBuiltInToolSchemas()` that returns the tools array. |
| `tools/trackerToolHandlers.ts` | ~510 | tracker_list/get/create/update/link_session. Self-contained DB queries. |
| `tools/interactiveToolHandlers.ts` | ~670 | AskUserQuestion + developer_git_commit_proposal. Both wait for user response via IPC promises. |
| `tools/editorToolHandlers.ts` | ~350 | applyDiff, streamContent, capture_editor_screenshot, open_workspace, get_session_edited_files. |
| `tools/displayToolHandler.ts` | ~350 | display_to_user validation and result formatting. |
| `tools/voiceToolHandlers.ts` | ~90 | voice_agent_speak, voice_agent_stop. Thin wrappers around VoiceModeService. |
| `mcpWorkspaceResolver.ts` | ~440 | Window/workspace resolution, extension tool registration/filtering, worktree path cache. |
| `mcpImageCompression.ts` | ~120 | `compressImageIfNeeded()` using Electron nativeImage. |

**Net effect:** httpServer.ts drops from 4,258 to ~600 lines (state maps, server lifecycle, `createSharedMcpServer()` dispatch skeleton, HTTP transport routing).

#### 0b. extensionDevServer.ts (2,399 lines) -- PRIORITY: MEDIUM

Second largest MCP server. Similar structure to httpServer.ts (tool schemas + handlers in one file). Future candidate for the same treatment.

### Cluster 1: AI Provider Layer (9,627 lines total)

**Directory:** `packages/electron/src/main/services/ai/`

This is the single heaviest area. It has already been partially decomposed (permissions, tool widgets, MCP servers, stream processor split out), but the two largest files remain massive.

#### 1a. ClaudeCodeProvider.ts (3,461 lines) -- PRIORITY: HIGH

The largest file in the project. Contains a single class with ~45 methods spanning 8+ distinct concerns.

**`sendMessage()`**** alone is \~1,900 lines** -- it handles streaming, tool execution, permissions, teammate routing, continuation logic, and message logging all in one method.

| Extractable Module | Est. Lines | Description |
| --- | --- | --- |
| `ClaudeCodeStreamProcessor.ts` | ~800 | Stream chunk processing (text, tool_calls, errors, metadata). Currently nested if-statements inside `sendMessage()`. Would receive callbacks for logging and event emission. |
| `ClaudeCodeAttachmentProcessor.ts` | ~100 | Image compression, PDF handling, text file attachment building. Reusable for other providers. |
| `ClaudeCodeSystemPrompt.ts` | ~150 | `buildSystemPrompt()` - modular building of MCP config, Claude settings, shell env, additional directories. Already self-contained. |
| `ClaudeCodeBinaryResolver.ts` | ~60 | `findCliPath()` - asar unpacking, path validation. Pure utility. |
| `ClaudeCodeTeammateWorkflow.ts` | ~200 | Teammate lifecycle (draining, continuation, abandonment, message formatting). Currently scattered across `sendMessage()`, `interruptWithMessage()`, constructor. |
| `ClaudeCodeUserInteraction.ts` | ~200 | ExitPlanMode confirmations + AskUserQuestion handlers. Pending maps, resolution logic, promise management. |
| `ClaudeCodeConfiguration.ts` | ~350 | 16+ static setter methods for dependency injection. Could be consolidated into a configuration registry pattern. |
| `ClaudeCodeToolAuthorization.ts` | ~290 | `canUseTool()` - permission logic, trust checking, pattern management. Already depends on external services. |

**Net effect:** ClaudeCodeProvider.ts drops from 3,461 to ~1,300 lines (the core `sendMessage()` loop, constructor, lifecycle).

#### 1b. AIService.ts (1,728 lines) -- PRIORITY: HIGH

Central IPC hub for all AI functionality. ~3,000 of its lines are IPC handler registrations inside `setupIpcHandlers()`.

| Extractable Module | Est. Lines | Description |
| --- | --- | --- |
| `AISessionIpcHandlers.ts` | ~400 | Session CRUD IPC handlers (create, load, delete, list, search). |
| `AIMessageIpcHandlers.ts` | ~500 | Message sending, streaming, completion, abort handlers. |
| `AISettingsIpcHandlers.ts` | ~200 | Configuration/settings/model endpoints. |
| `AIQueueIpcHandlers.ts` | ~150 | Queued prompt operations (create, claim, complete). |
| `AIClaudeCodeIpcHandlers.ts` | ~200 | Claude Code specific handlers (questions, permissions, context). |
| `MessagePreprocessing.ts` | ~140 | `extractFileMentions()`, `isBinaryFile()`, `attachMentionedFiles()`, `detectNimbalystSlashCommand()`. |
| `AnalyticsBucketing.ts` | ~50 | All `bucket*()` functions for PostHog event properties. |
| `MobileQueueManager.ts` | ~200 | `processQueuedPrompt()`, mobile sync handler initialization. |

**Net effect:** AIService.ts drops from 1,728 to ~400 lines (constructor, initialization, provider management, destroy).

---

### Cluster 2: Agent Mode UI (4,258 lines total)

#### 2a. AgentMode.tsx (1,958 lines) -- PRIORITY: HIGH

The largest React component. Contains 15 `useCallback` declarations, many of which duplicate session operations found in other components.

| Extractable Module | Est. Lines | Description |
| --- | --- | --- |
| `useSessionActions.ts` (hook) | ~300 | **DRY OPPORTUNITY.** Consolidates create, delete, archive, rename, branch operations. Currently duplicated across AgentMode, SessionHistory, AgentWorkstreamPanel, and ChatSidebar (~15 duplicate IPC call sites for `sessions:update-metadata` alone). |
| `useWorktreeActions.ts` (hook) | ~200 | Worktree creation, session-to-worktree association, blitz creation. Currently 3 near-identical callbacks in AgentMode. |
| `useNavigationTracking.ts` (hook) | ~30 | Navigation entry push logic. |
| `useGitRepoDetection.ts` (hook) | ~20 | Git repo status checking effect. |

**Net effect:** AgentMode.tsx drops from 1,958 to ~1,400 lines. More importantly, `useSessionActions` eliminates duplication across 4-5 components.

**Cross-component impact of \****`useSessionActions`**\*\*:**

| Component | Current Session Op Lines | After Hook |
| --- | --- | --- |
| AgentMode.tsx | ~300 | ~20 (hook call) |
| SessionHistory.tsx | ~200 | ~20 |
| AgentWorkstreamPanel.tsx | ~200 | ~20 |
| ChatSidebar.tsx | ~80 | ~20 |
| SessionTranscript.tsx | ~100 | ~20 |

#### 2b. SessionListItem.tsx (1,375 lines) -- PRIORITY: MEDIUM

| Extractable Module | Est. Lines | Description |
| --- | --- | --- |
| `SessionStatusIndicator.tsx` | ~60 | Already a memoized sub-component. Clean extraction. |
| `useSessionDragDrop.ts` (hook) | ~100 | Drag-drop validation and handlers. |
| `useSessionContextMenu.ts` (hook) | ~80 | Context menu positioning and state. |

---

### Cluster 3: Chat/UnifiedAI UI (3,680 lines total)

#### 3a. ChatMessages.tsx (1,568 lines) -- PRIORITY: MEDIUM

| Extractable Module | Est. Lines | Description |
| --- | --- | --- |
| `MessageRenderer.tsx` | ~400 | Message type dispatching (streaming status, tool calls, regular messages). Complex conditional tree. |
| `ChatEmptyState.tsx` | ~50 | Empty state UI for "no document" and "document open" variants. |
| `StreamingIndicator.tsx` | ~30 | Loading dots animation. |

#### 3b. AIInput.tsx (1,080 lines) -- PRIORITY: LOW

Already has several sub-components extracted (ModelSelector, EffortLevelSelector, SlashCommandSuggestions). The remaining code is cohesive input handling logic. Low priority for splitting.

#### 3c. ToolCallDisplay.tsx (1,032 lines) -- PRIORITY: MEDIUM

Large component rendering different tool call visualizations. Could split by tool type into separate renderers.

---

### Cluster 4: Rexical Editor Plugins (7,000+ lines across TablePlugin dir)

#### 4a. ToolbarPlugin.tsx (1,816 lines) -- PRIORITY: MEDIUM

| Extractable Module | Est. Lines | Description |
| --- | --- | --- |
| `BlockFormatDropDown.tsx` | ~100 | Block type selection dropdown. |
| `ElementFormatDropdown.tsx` | ~120 | Text alignment and indentation dropdown. |
| `FormattingButtons.tsx` | ~80 | Bold/italic/underline/etc. button group. |
| `InsertDropdown.tsx` | ~110 | Insert elements dropdown (images, tables, etc.). |
| `AdditionalFormattingDropdown.tsx` | ~140 | Strikethrough, subscript, code, etc. |
| `CodeLanguageDropdown.tsx` | ~30 | Code block language selector. |

**Net effect:** ToolbarPlugin.tsx drops from 1,816 to ~600 lines (state management, update listeners, layout).

#### 4b. TablePlugin.tsx (2,029 lines) -- PRIORITY: LOW

The TablePlugin directory already has 5+ files. The main file at 2,029 lines contains table node definitions, utilities, and the plugin component. Lexical's table implementation is inherently complex and tightly coupled. Lower priority because splitting may not improve agent ergonomics much (the logic is deeply interrelated).

---

### Cluster 5: Core Editor Infrastructure

#### 5a. TabEditor.tsx (1,234 lines) -- PRIORITY: MEDIUM

| Extractable Module | Est. Lines | Description |
| --- | --- | --- |
| `useAutosave.ts` (hook) | ~150 | Autosave debounce/timer implementation. |
| `useFileWatcher.ts` (hook) | ~100 | File change detection and handling. |
| `useHistorySnapshots.ts` (hook) | ~80 | History/snapshot creation logic. |
| `useDiffApplication.ts` (hook) | ~150 | Diff application and stream editing. |

#### 5b. WindowManager.ts (1,061 lines) -- PRIORITY: LOW

| Extractable Module | Est. Lines | Description |
| --- | --- | --- |
| `WindowFactory.ts` | ~300 | `createWindow()` with cascade positioning, state recovery. |
| `WindowEventHandlers.ts` | ~200 | before-unload, closed, crashed, unresponsive handlers. |
| `WindowStateManager.ts` | ~150 | State persistence and recovery functions. |

---

### Cluster 6: Voice Mode (3,770 lines total)

#### VoiceModePanel.tsx (1,119 lines) -- PRIORITY: LOW

| Extractable Module | Est. Lines | Description |
| --- | --- | --- |
| `voiceConfig.ts` | ~40 | `VOICE_OPTIONS` and `VOICE_GROUPS` constants. |
| `useProjectSummary.ts` (hook) | ~60 | Project summary file management. |
| `useVoicePreview.ts` (hook) | ~50 | Voice preview audio playback. |
| `TurnDetectionSection.tsx` | ~100 | Turn detection configuration UI. |

---

### Cluster 7: Runtime Types

#### types.ts (1,478 lines) -- PRIORITY: HIGH

This file has **poor cohesion** -- it contains 11 distinct type groups that have no reason to live together. Splitting it improves both agent ergonomics and import clarity.

| Extractable Module | Description |
| --- | --- |
| `documentContext.ts` | DocumentContext, ChatAttachment |
| `toolTypes.ts` | ToolCall, ToolHandler, DiffArgs, DiffResult |
| `messageTypes.ts` | Message, AIProviderType, AI_PROVIDER_TYPES |
| `modelTypes.ts` | CLAUDE_CODE_VARIANTS, resolveClaudeCodeModelVariant, AIModel, SessionType, SessionMode |
| `sessionTypes.ts` | SessionData, QueuedPrompt, TokenUsageCategory |
| `providerTypes.ts` | ProviderConfig, ProviderCapabilities, ProviderSettings |
| `streamTypes.ts` | StreamChunk |
| `fileLinkTypes.ts` | FileLinkType, FileLink, metadata interfaces |
| `agentMessageTypes.ts` | AgentMessage, CreateAgentMessageInput |
| `interactivePromptTypes.ts` | All interactive prompt types, type guards, utilities |

Re-export everything from a barrel `types.ts` to maintain backward compatibility.

---

### Cluster 8: IPC Handlers

#### WorkspaceHandlers.ts (988 lines) -- PRIORITY: MEDIUM

| Extractable Module | Est. Lines | Description |
| --- | --- | --- |
| `RipgrepService.ts` | ~150 | Ripgrep path resolution, search execution. |
| `QuickOpenService.ts` | ~200 | File name search with caching. |
| `FileOperationHandlers.ts` | ~200 | Read, write, delete IPC handlers. |
| `GitOperationHandlers.ts` | ~100 | Git-related workspace handlers. |

#### FileHandlers.ts (862 lines) -- PRIORITY: LOW

Could extract `getFileType()` and `categorizeError()` to shared utilities (see DRY section).

---

## Cross-Cutting DRY Opportunities

### 1. Session Management Operations -- HIGHEST IMPACT

**Problem:** `sessions:update-metadata`, `sessions:create`, `sessions:delete`, and `sessions:branch` IPC calls are duplicated across 5+ renderer components with near-identical logic.

**Solution:** Create `useSessionActions()` hook returning `{ create, delete, archive, unarchive, rename, branch, updateMode }`.

**Files affected:** AgentMode.tsx, SessionHistory.tsx, AgentWorkstreamPanel.tsx, ChatSidebar.tsx, SessionTranscript.tsx

**Estimated lines saved:** ~600 across all components.

### 2. `getFileType()` Utility -- Confirmed Duplication

**Problem:** Identical function in both `FileHandlers.ts` and `WorkspaceHandlers.ts`.

**Solution:** Extract to `packages/electron/src/main/utils/fileUtils.ts`.

### 3. `deepMerge()` Utility

**Problem:** Defined inline in WorkspaceHandlers.ts. Documented in CLAUDE.md as a critical pattern but not extracted.

**Solution:** Extract to `packages/electron/src/main/utils/objectUtils.ts`.

### 4. Cache with TTL Pattern

**Problem:** SessionHandlers.ts defines two identical cache implementations (`GitStatusCache`, `SessionFilesCache`) with the same TTL structure.

**Solution:** Create generic `TtlCache<K, V>` class in `packages/electron/src/main/utils/TtlCache.ts`.

### 5. `categorizeError()` Utility

**Problem:** Defined in FileHandlers.ts, useful for other IPC handler files.

**Solution:** Extract to `packages/electron/src/main/utils/errorUtils.ts`.

### 6. Binary File Detection

**Problem:** `BINARY_EXTENSIONS` set defined inline in WorkspaceHandlers.ts.

**Solution:** Extract to `packages/electron/src/main/utils/fileUtils.ts` alongside `getFileType()`.

---

## Recommended Execution Order

Ordered by impact and risk, with independent work items that can be parallelized.

### Phase 0: httpServer.ts Decomposition (IN PROGRESS)

The largest file in the project (4,258 lines). Extract tool schemas, tool handlers by domain, workspace resolution, and image compression into separate files.

### Phase 1: High-Impact, Low-Risk Extractions

These are "pure extraction" refactors with no behavioral changes. Can be done in parallel.

1. **`useSessionActions`**** hook** -- Eliminates ~600 lines of duplication across 5 components. Start here because it touches the most files and has the highest DRY payoff.

2. **`runtime/src/ai/server/types.ts`**** split** -- Split into 10 domain files with barrel re-export. Zero behavioral change, pure file reorganization.

3. **Shared utilities extraction** -- `getFileType()`, `deepMerge()`, `categorizeError()`, `BINARY_EXTENSIONS`, `TtlCache`. Small, safe, unblocks later phases.

### Phase 2: AI Service Layer Decomposition

4. **AIService.ts IPC handler extraction** -- Split `setupIpcHandlers()` into domain-specific handler files. Each handler file registers its own handlers, AIService orchestrates.

5. **ClaudeCodeProvider.ts decomposition** -- Extract stream processor, attachment processor, system prompt builder, binary resolver, teammate workflow, user interaction handlers, configuration, tool authorization.

### Phase 3: UI Component Decomposition

6. **ToolbarPlugin.tsx decomposition** -- Extract 6 dropdown/button-group sub-components.

7. **AgentMode.tsx simplification** -- After `useSessionActions` (Phase 1), extract worktree actions and navigation tracking hooks.

8. **TabEditor.tsx hook extraction** -- Extract autosave, file watcher, history snapshot, and diff application hooks.

9. **ChatMessages.tsx decomposition** -- Extract MessageRenderer, ChatEmptyState, StreamingIndicator.

### Phase 4: Lower-Priority Extractions

10. **WindowManager.ts decomposition** -- Extract WindowFactory, event handlers, state manager.
11. **WorkspaceHandlers.ts decomposition** -- Extract RipgrepService, QuickOpenService.
12. **VoiceModePanel.tsx decomposition** -- Extract config, hooks, and section components.
13. **SessionListItem.tsx decomposition** -- Extract status indicator, drag-drop hook, context menu hook.

---

## Principles

1. **Extract along seams, not arbitrarily.** Each new file should have a clear single responsibility.
2. **Barrel re-exports for backward compatibility.** When splitting a types file, re-export from the original path so existing imports keep working.
3. **Hooks for shared logic, components for shared UI.** Session operations become hooks. UI fragments become components.
4. **One PR per cluster.** Keep changes reviewable. Each cluster section above is roughly one PR.
5. **Test after each extraction.** Run unit tests and verify the app builds after each file split.
6. **No behavioral changes.** These are purely structural refactors. No new features, no bug fixes mixed in.
