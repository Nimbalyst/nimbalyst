---
planStatus:
  planId: plan-codex-acp-provider-integration
  title: Codex ACP Provider as Alternative Transport
  status: in-development
  planType: feature
  priority: high
  owner: ghinkle
  stakeholders: []
  tags:
    - ai
    - codex
    - acp
    - file-history
    - transcripts
  created: "2026-04-27"
  startDate: "2026-04-27"
  updated: "2026-04-27T19:42:00.000Z"
  progress: 80
---
# Codex ACP Provider As Alternative Transport

## Implementation Progress

- [x] Phase 0: Validate bundled `@openai/codex-sdk` binary supports `--acp --stdio` (confirmed: it doesn't, scope expanded to use `@zed-industries/codex-acp` package)
- [x] Phase 1: Port `CodexACPProtocol` from `d38c58c72` onto current `AgentProtocol` interface (dropped `unstable_resumeSession`, kept `loadSession` fallback path)
- [x] Phase 1: Port `mockCodexAcpAgent.mjs` fixture and `CodexACPProtocol.test.ts` (2 tests passing end-to-end)
- [x] Phase 2: Add `openai-codex-acp` to `AI_PROVIDER_TYPES` and `isAgentProvider`
- [x] Phase 2: Create `OpenAICodexACPProvider` (thin wrapper extending `BaseAgentProvider`, delegates to `CodexACPProtocol`)
- [x] Phase 2: Wire provider into `ProviderFactory.createProvider` and `ModelRegistry`
- [x] Phase 2: Wire model variants into `DEFAULT_MODELS` (shares Codex SDK fallback catalog)
- [x] Phase 3: Add `'openai-codex-acp'` provider settings entry in `appSettings.ts` (default `enabled: false`)
- [x] Phase 3: Add "Enable ACP transport (experimental)" toggle to `OpenAICodexPanel`
- [x] Phase 3: Update `ModelSelector` + `AgentModelPicker` labels so "OpenAI Codex (ACP)" appears as a peer provider
- [x] Phase 4: Create `CodexACPRawParser` implementing `IRawMessageParser` (handles `agent_message_chunk`, `tool_call`, `tool_call_update`, `session/request_permission`, etc.)
- [x] Phase 4: Wire parser into `TranscriptTransformer.createParser`
- [x] Phase 4: Add `CodexACPRawParser.test.ts` (14 tests passing)
- [x] Phase 5: Add `'openai-codex-acp'` to `MessageStreamingHandler.ts` pre-edit hook with `CODEX_ACP_EDIT_TOOLS = ['Edit', 'Write', 'ApplyPatch', 'edit', 'write', 'apply_patch']`
- [ ] Phase 6: Bridge ACP `requestPermission` callbacks into `ToolPermissionService` (placeholder allow-once handler in place; needs proper request-shape mapping)
- [ ] Phase 7: Packaging validation (verify in `npm run dev` and `npm run build:mac:local`)
- [ ] Phase 8: Add E2E test using `aiToolSimulator.ts` for the toggle + new-session creation path
- [ ] Phase 8: Add provider-level tests for `OpenAICodexACPProvider` mirroring `OpenAICodexProvider.test.ts`
- [ ] Phase 8: Add transcript reload integration test verifying canonical events match between live and reloaded sessions
- [x] Wire main-process static injectors (`SessionNamingService`, `ExtensionDevService`, `MetaAgentService`, `index.ts` MCP/permission/env loaders)

## Verification

- `npm run typecheck` clean in both `packages/runtime` and `packages/electron`
- `npx vitest run packages/runtime/src/ai/server/` -- all 480 tests pass (1 pre-existing skip)
- `CodexACPProtocol.test.ts` -- 2/2 tests pass (creates session, streams events, handles permission allow + deny)
- `CodexACPRawParser.test.ts` -- 14/14 tests pass (input/output messages, tool_call mapping, MCP server detection, dedup)



## Goal

Add `openai-codex-acp` as a separately-enableable first-class provider that uses Codex via ACP (Agent Control Protocol over stdio) as an alternative to the existing `@openai/codex-sdk` integration. The OpenAI Codex settings panel surfaces an "Enable ACP transport (experimental)" toggle. When enabled, `OpenAI Codex (ACP)` appears as its own option in the model selector and session creator alongside `OpenAI Codex`. Users pick the transport explicitly per session. Both can be enabled simultaneously.

The motivation is file-edit fidelity. The Codex SDK does not expose pre/post tool-use hooks, so Nimbalyst cannot reliably:

- create pre-edit local-history baselines before a write lands
- attribute edits to the producing session deterministically
- render exact unified diffs in the live transcript and after reload

ACP exposes those hooks natively through the Codex CLI's `--acp` mode. This plan adds a parallel provider for users who want that fidelity, while keeping the SDK provider as the default.

## Non-Goals

- Do not deprecate or remove the SDK-backed `openai-codex` provider.
- Do not migrate existing Codex sessions between providers when the user flips the toggle.
- Do not make ACP the default until edit fidelity, transcript reload, and packaged builds are validated end-to-end.
- Do not change OpenCode behavior. OpenCode remains a separate provider for multi-model edit-tracked agentic work; expanding its GPT-5 support is a follow-up.
- Do not share a raw transformer between Codex SDK and Codex ACP. Their event shapes are unrelated.

## Background

Three Codex-adjacent paths now exist or will exist:

| Provider ID | Transport | Edit hooks | Status after this plan |
|---|---|---|---|
| `openai-codex` | `@openai/codex-sdk` | Reactive watcher only | Default, unchanged |
| `openai-codex-acp` | `codex --acp --stdio` over JSON-RPC | Native pre/post hooks | New, opt-in |
| `opencode` | `@opencode-ai/sdk` (HTTP+SSE subprocess) | Plugin-emitted pre/post hooks | Unchanged |

ACP is already a first-class protocol abstraction in the runtime. `CopilotACPProtocol` (`packages/runtime/src/ai/server/protocols/CopilotACPProtocol.ts`) implements `AgentProtocol` and proves the shape: spawn `<cli> --acp --stdio`, do JSON-RPC framing over stdin/stdout, normalize ACP events into `ProtocolEvent`. `CodexACPProtocol` follows the same shape.

A previous branch (`codex-acp-integration`) landed a working `CodexACPProtocol` at commit `d38c58c72` (1137 lines, with tests and a `mockCodexAcpAgent.mjs` fixture). That commit predates the raw-versus-canonical transcript split, so it ports the protocol cleanly but the transcript wiring needs to be redone for the current architecture.

OpenCode's pre-edit flow at `MessageStreamingHandler.ts:1086-1126` is the reference for the Codex ACP edit-tracking contract:

- pre-edit triggered on tool_call (status=running)
- read `beforeContent` from cache or disk
- workspace-bounded path validation
- create tag via `historyManager.createTag(workspace, file, tagId, beforeContent, sessionId, toolUseId)` BEFORE the edit lands
- deterministic `tagId = ai-edit-pending-${sessionId}-${editToolUseId}`

The Codex ACP provider must reach functional parity with that flow.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ OpenAI Codex Settings Panel                                 │
│   ┌──────────────────────────────────────────────┐          │
│   │ [x] Enable ACP transport (experimental)      │          │
│   └──────────────────────────────────────────────┘          │
└────────────────┬────────────────────────────────────────────┘
                 │ writes provider['openai-codex-acp'].enabled = true
                 ▼
       Model picker / Session creator
                 │
        ┌────────┴────────────────┐
        ▼                         ▼
   "OpenAI Codex"        "OpenAI Codex (ACP)"
   (always visible)      (visible iff enabled)
        │                         │
        │ user picks per session  │
        ▼                         ▼
        ProviderFactory.createProvider(type)
                 │
        ┌────────┴────────┐
        ▼                 ▼
OpenAICodexProvider  OpenAICodexACPProvider
        │                 │
        ▼                 ▼
CodexSDKProtocol     CodexACPProtocol
        │                 │
        ▼                 ▼
  @openai/codex-sdk   codex --acp --stdio
```

### Provider Boundary

A new top-level provider is added rather than a transport sub-toggle on `OpenAICodexProvider`. Reasons:

- different runtime dependencies (SDK npm package vs CLI binary at `--acp`)
- different raw event formats (no shared parser)
- different approval/permission flows
- different session ID semantics (SDK thread IDs vs ACP session IDs)
- different packaging requirements (ACP needs the `codex` binary, not the SDK's npm-bundled binary)
- ACP is experimental; isolating it as a provider keeps it cleanly removable

The two providers share the `BaseAgentProvider` foundation. They do not share their protocol layer or their raw transformer.

### Shared Downstream Model

Separate providers do **not** mean separate transcript or history systems. Both providers feed into:

- `ai_agent_messages` (raw log) via `logAgentMessageBestEffort`
- `ai_transcript_events` (canonical events) via `TranscriptTransformer`
- `SessionFileTracker` for edited-files tracking
- `HistoryManager` for pre/post-edit local-history tags
- The same transcript widgets (DiffViewer, EditToolResultCard, BashWidget) for rendering

Only the raw parser is provider-specific. Once events reach the canonical layer, all downstream code is shared.

## Type System Changes

`packages/runtime/src/ai/server/types.ts:131`:

```ts
export const AI_PROVIDER_TYPES = [
  'claude',
  'claude-code',
  'openai',
  'openai-codex',
  'openai-codex-acp',  // new
  'lmstudio',
  'opencode',
  'copilot-cli',
] as const;

export function isAgentProvider(provider: string | null | undefined):
  provider is 'claude-code' | 'openai-codex' | 'openai-codex-acp' | 'opencode' | 'copilot-cli' {
  return provider === 'claude-code'
    || provider === 'openai-codex'
    || provider === 'openai-codex-acp'
    || provider === 'opencode'
    || provider === 'copilot-cli';
}
```

The `assertExhaustiveProvider` switch in `ProviderFactory.createProvider` gets a new branch for `'openai-codex-acp'` returning `new OpenAICodexACPProvider()`.

## Settings Model

ACP is enabled independently of the SDK provider. The OpenAI Codex panel toggle controls whether `'openai-codex-acp'` is a registered, picker-visible provider:

```ts
interface ProviderSettings {
  'openai-codex': { enabled: boolean; ... };       // existing
  'openai-codex-acp': { enabled: boolean; ... };   // new, default disabled
}
```

The ACP provider has its own `enabled` field in the existing per-provider settings shape. When `false`, the provider does not appear in the model selector, session creator, or any other picker. When `true`, it appears as `OpenAI Codex (ACP)` -- a peer of `OpenAI Codex` -- and the user picks per session.

There is no `codexTransport` field and no automatic mapping of `'openai-codex'` to `'openai-codex-acp'`. The user explicitly chooses which provider to use when creating a session.

### Per-Session Provider Identity

Each `ai_sessions` row stores its actual provider as today. The two providers are independent:

- sessions created with `provider = 'openai-codex'` always run on `OpenAICodexProvider`
- sessions created with `provider = 'openai-codex-acp'` always run on `OpenAICodexACPProvider`
- disabling either provider in settings hides it from new-session pickers but does not affect existing sessions
- no migration, no retroactive routing

## UI Configuration

The toggle lives on `OpenAICodexPanel.tsx` as a section below the existing API key configuration. Enabling it registers `OpenAI Codex (ACP)` as its own peer provider in pickers:

```
┌─────────────────────────────────────────────────────────────┐
│ ACP Transport                                               │
│                                                             │
│   ┌──────────────────────────────────────────────┐          │
│   │ [ ]  Enable ACP transport (experimental)     │          │
│   └──────────────────────────────────────────────┘          │
│                                                             │
│   When enabled, "OpenAI Codex (ACP)" becomes available as   │
│   a separate provider in the model selector. ACP gives      │
│   Nimbalyst native file-edit hooks for accurate pre-edit    │
│   baselines, exact diffs in the transcript, and reliable    │
│   session-linked local history.                             │
│                                                             │
│   You can keep both transports enabled and choose per       │
│   session.                                                  │
│                                                             │
│   Experimental: transcript reload and packaged-build        │
│   support are still being validated. Requires the Codex     │
│   CLI installed separately.                                 │
└─────────────────────────────────────────────────────────────┘
```

Implementation lives in `packages/electron/src/renderer/components/GlobalSettings/panels/OpenAICodexPanel.tsx`, alongside the existing usage-indicator toggle. The toggle writes to the `'openai-codex-acp'` provider's `enabled` field in the existing per-provider settings shape.

The settings sidebar may also surface `OpenAI Codex (ACP)` as a separate entry once enabled, mirroring how other providers each get their own panel. Decision deferred to implementation time -- could be reused settings panel or its own.

## Provider Implementation

### File Layout

```
packages/runtime/src/ai/server/
├── providers/
│   ├── OpenAICodexProvider.ts          (existing, unchanged)
│   ├── OpenAICodexACPProvider.ts       (new)
│   └── codex/
│       ├── codexBinaryPath.ts          (existing, may need ACP variant)
│       ├── codexSdkLoader.ts           (existing, unchanged)
│       └── codexAcpBinaryPath.ts       (new, if needed)
├── protocols/
│   ├── CodexSDKProtocol.ts             (existing, unchanged)
│   └── CodexACPProtocol.ts             (new, port from d38c58c72)
└── transcript/
    └── parsers/
        ├── CodexRawParser.ts           (existing, handles SDK events)
        └── CodexACPRawParser.ts        (new)
```

### OpenAICodexACPProvider

Mirrors `OpenAICodexProvider` in shape but:

- holds a `CodexACPProtocol` instead of `CodexSDKProtocol`
- `getProviderName()` returns `'openai-codex-acp'`
- `getDisplayName()` returns `'OpenAI Codex (ACP)'`
- delegates raw event storage to the same `logAgentMessageBestEffort` path
- emits the same `StreamChunk` shapes for `text`, `tool_call`, `tool_call.result`, `complete`, `error`
- reuses `documentContextUtils`, `buildClaudeCodeSystemPrompt`, `McpConfigService`
- reuses `AgentProtocolTranscriptAdapter` if the protocol's `ProtocolEvent` shape matches; otherwise its own minimal adapter

The provider does not own ACP-specific framing. All JSON-RPC, process spawning, and ACP event normalization live in `CodexACPProtocol`.

### CodexACPProtocol

Port from commit `d38c58c72` with these adjustments:

1. Remove any "fall back to most recent active session" mapping. Session binding must be deterministic at creation time; ACP callbacks must always carry an explicit session correlation.
2. Adapt the `ProtocolEvent` emission to whatever the current `ProtocolInterface.ts` defines (the interface gained fields after that commit).
3. Reuse the existing JSON-RPC framing and process lifecycle code as-is.
4. Keep the `mcp-remote` bridging that converts SSE-based Nimbalyst MCP servers to stdio so ACP can consume them.

### CodexACPRawParser

New parser implementing `IRawMessageParser`. Reads raw ACP messages from `ai_agent_messages` and emits `CanonicalEventDescriptor[]`. Normalizes:

- assistant text chunks → `text` canonical events
- reasoning chunks → `reasoning` canonical events
- ACP tool calls → `tool_call_started` / `tool_call_completed` (with the OpenCode-validated shape: `tool_call` family, edit metadata in arguments)
- ACP file-edit notifications → `tool_call_started` + `tool_call_completed` for `file_edit` (matching OpenCode's `parseFileEdited` exactly)
- ACP permission requests → existing `AskUserQuestion` canonical event
- session completion → `turn_ended`
- session error → `error_event`

Authoritative reference for ACP's raw event names is `CodexACPProtocol.parseACPEvent()` (mirroring how `OpenCodeRawParser` references `OpenCodeSDKProtocol.parseSSEEvent()`).

`TranscriptTransformer` adds a provider→parser entry mapping `'openai-codex-acp'` to `CodexACPRawParser`.

### File Edit Hook Integration

`MessageStreamingHandler.ts:1086` currently special-cases `provider === 'opencode'` for OpenCode edit tools. Add a parallel block for `provider === 'openai-codex-acp'`:

```ts
const CODEX_ACP_EDIT_TOOLS = ['edit', 'write', 'create', 'apply_patch'];
if (CODEX_ACP_EDIT_TOOLS.includes(trackToolName)
    && session.provider === 'openai-codex-acp') {
  // identical baseline-capture + tag creation flow as OpenCode
}
```

ACP emits tool_call with status=running before the file is modified, matching OpenCode's contract. The same `historyManager.createTag` call pattern works without modification.

If multiple edit-tool name vocabularies are seen in practice (Codex ACP may use `apply_patch` while OpenCode uses `patch`), keep the lists separate per provider rather than merging them.

## Approval and Permission Flow

ACP carries its own permission request semantics that differ from the Codex SDK's "ask" mode. Commit `d38c58c72` already includes:

- workspace path resolution from session (not `process.cwd`)
- session ID propagation through permission callbacks
- mapping of Codex "ask" → "auto" so the model attempts writes and triggers permission callbacks

Port these as-is, but verify against the current `ToolPermissionService` and `AskUserQuestionPrompt` shape -- both have evolved.

## Packaging

ACP requires the `codex` binary on disk and executable. Phase 0 first checks whether the bundled `@openai/codex-sdk` binary already supports `--acp --stdio`; if it does, that's the simplest path (no new packaging work, ACP just spawns the binary the SDK already handles via `asarUnpack` in `packages/electron/package.json`).

If the bundled binary does not support `--acp` (or supports a stale ACP version), the fallback is **separate installation**: the user installs Codex CLI globally, similar to how `claude-code` requires `@anthropic-ai/claude-agent-sdk` to be installed locally. The OpenAI Codex panel adds an "Install Codex CLI" button or installation instructions, modeled on the Claude Code panel's `CLIInstaller` flow. The provider resolves the binary via PATH at session start, surfacing a clear error in settings if not found.

This decouples SDK and ACP versions, keeps the bundle small, and is the only path that works if OpenAI ships a newer ACP version than what's bundled in `@openai/codex-sdk`.

## Implementation Plan

### Phase 0: Validate Bundled Binary Supports ACP

Before any porting work, run the bundled `@openai/codex-sdk` binary with `--acp --stdio` and confirm it responds with the expected JSON-RPC initialize handshake. If yes, proceed with option 1 packaging. If no, scope grows to include a `CLIInstaller` flow.

### Phase 1: Port Protocol

1. Create `CodexACPProtocol.ts` by porting `d38c58c72` with the following changes:
   - rebase on the current `AgentProtocol` interface
   - remove the "latest active session" fallback
   - keep the JSON-RPC framing, process lifecycle, and `mcp-remote` bridging unchanged
2. Port the test fixtures (`mockCodexAcpAgent.mjs`) and the protocol-level tests (`CodexACPProtocol.test.ts`).
3. Add `CodexACPProtocol` to `packages/runtime/src/ai/server/protocols/index.ts`.

### Phase 2: Add Provider

1. Add `'openai-codex-acp'` to `AI_PROVIDER_TYPES` in `types.ts`.
2. Update `isAgentProvider` and `assertExhaustiveProvider`.
3. Create `OpenAICodexACPProvider` mirroring `OpenAICodexProvider`'s shape.
4. Wire it into `ProviderFactory.createProvider`.
5. Wire it into the model registry (`DEFAULT_MODELS`, `modelConstants`) -- model variants identical to the SDK provider.

### Phase 3: Settings + Picker Visibility

1. Add `'openai-codex-acp'` to the per-provider settings shape with `enabled: false` default.
2. Add the "Enable ACP transport (experimental)" toggle to `OpenAICodexPanel.tsx`. It writes `enabled` on the ACP provider's settings entry.
3. Update model-selector / session-creator picker logic so `OpenAI Codex (ACP)` appears as a peer of `OpenAI Codex` when its `enabled` flag is true.
4. Verify that disabling ACP hides it from new-session pickers without affecting existing sessions.

### Phase 4: Raw → Canonical Parser

1. Create `CodexACPRawParser.ts` implementing `IRawMessageParser`.
2. Use `OpenCodeRawParser.ts` as the reference for canonical event shapes (especially file_edit and tool_call families).
3. Wire it into `TranscriptTransformer` provider-to-parser mapping.
4. Verify reload renders the same content as live for assistant text, reasoning, tools, file edits.

### Phase 5: File Edit Hook Integration

1. Add `'openai-codex-acp'` to the pre-edit special-case in `MessageStreamingHandler.ts:1086`.
2. Define `CODEX_ACP_EDIT_TOOLS = ['edit', 'write', 'create', 'apply_patch']` (refine based on actual ACP tool names observed in development).
3. Verify pre-edit tags are created before writes land for both worktree and non-worktree sessions.
4. Verify post-edit snapshots and diff payloads via existing `SessionFileTracker.trackToolExecution` flow.

### Phase 6: Permission Flow

1. Port permission handling from `d38c58c72` into the new provider.
2. Adapt to current `ToolPermissionService` and `AskUserQuestionPrompt` shapes.
3. Verify worktree path resolution and explicit session binding.

### Phase 7: Packaging Validation

1. Verify ACP works in `npm run dev`.
2. Verify ACP works in `npm run build:mac:local` packaged builds.
3. If using option 1 (shared binary), confirm `asarUnpack` rules already cover the binary.
4. If using option 2 (separate install), add CLIInstaller flow and a check for binary presence at provider initialization.

### Phase 8: E2E + Tests

1. Add provider-level tests for `OpenAICodexACPProvider` mirroring `OpenAICodexProvider.test.ts`.
2. Add a transcript reload integration test verifying canonical events match between live and reloaded sessions.
3. Add an E2E test using `aiToolSimulator.ts` that exercises the toggle + new session creation path.

## Files Touched

### New
- `packages/runtime/src/ai/server/providers/OpenAICodexACPProvider.ts`
- `packages/runtime/src/ai/server/providers/__tests__/OpenAICodexACPProvider.test.ts`
- `packages/runtime/src/ai/server/protocols/CodexACPProtocol.ts`
- `packages/runtime/src/ai/server/protocols/__tests__/CodexACPProtocol.test.ts`
- `packages/runtime/src/ai/server/protocols/__tests__/fixtures/mockCodexAcpAgent.mjs`
- `packages/runtime/src/ai/server/transcript/parsers/CodexACPRawParser.ts`
- `packages/runtime/src/ai/server/transcript/parsers/__tests__/CodexACPRawParser.test.ts`

### Modified
- `packages/runtime/src/ai/server/types.ts` -- add provider type to union
- `packages/runtime/src/ai/server/ProviderFactory.ts` -- add factory branch
- `packages/runtime/src/ai/server/protocols/index.ts` -- export new protocol
- `packages/runtime/src/ai/server/transcript/TranscriptTransformer.ts` -- wire new parser
- `packages/runtime/src/ai/modelConstants.ts` -- add model defaults
- `packages/electron/src/main/services/ai/MessageStreamingHandler.ts` -- pre-edit hook special case
- `packages/electron/src/main/utils/store.ts` (or app-settings schema location) -- add `'openai-codex-acp'` provider settings entry
- `packages/electron/src/renderer/components/GlobalSettings/panels/OpenAICodexPanel.tsx` -- ACP enable toggle + (if needed) install instructions
- `packages/electron/src/renderer/components/Settings/SettingsSidebar.tsx` -- conditional sidebar entry for the ACP provider when enabled
- `packages/electron/src/renderer/components/UnifiedAI/ModelSelector.tsx` -- include ACP as a peer provider when enabled
- `packages/electron/src/renderer/store/atoms/appSettings.ts` -- atoms + IPC sync for ACP provider settings
- `docs/AI_PROVIDER_TYPES.md` -- document the new provider
- `docs/POSTHOG_EVENTS.md` -- if any new analytics events
- `packages/runtime/CLAUDE.md` -- document the new provider

## Risks

- Phase 0 may reveal the bundled `@openai/codex-sdk` binary doesn't support `--acp` (or supports a different ACP version). Scope expands to include a separate install path.
- The `d38c58c72` commit predates the canonical transcript split. Phase 4's parser may be larger than estimated if ACP raw event shapes don't fit cleanly into the canonical schema OpenCode validated.
- Concurrent ACP Codex sessions could attach edits or approvals to the wrong session if the `mcp-remote` bridge or permission callback path lose session correlation. Phase 2's removal of the "latest active session" fallback is critical.
- ACP raw event format is a public-preview protocol. Format churn may require parser updates.
- The toggle UX is simple but means users with both ACP and SDK sessions in their session list see them as the same "OpenAI Codex" provider. Session detail UI may need to surface which transport was used for debugging.

## Success Criteria

- The OpenAI Codex panel has a "Use ACP transport (experimental)" toggle, default off.
- Flipping the toggle changes which provider is used for **new** Codex sessions; existing sessions are unaffected.
- New ACP sessions create pre-edit local-history tags before writes land, identical to OpenCode's flow.
- ACP sessions render exact diffs in the transcript live and after reload.
- Concurrent ACP and SDK Codex sessions keep edits, permissions, and transcript events attached to the correct session.
- ACP works in development mode and packaged Mac builds.
- Existing `openai-codex` SDK behavior is unchanged.

## Decisions

Resolved 2026-04-27:

- **Provider visibility**: ACP is a separately-enableable first-class provider in pickers, not a hidden transport. Users explicitly choose `OpenAI Codex` vs `OpenAI Codex (ACP)` per session. Both can be enabled simultaneously.
- **Packaging**: If Phase 0 shows the bundled SDK binary doesn't support `--acp`, require separate Codex CLI installation rather than bundling a second binary. Decouples versions; smaller bundle.
- **Edit-tool whitelist**: Hardcoded `['edit', 'write', 'create', 'apply_patch']` mirroring OpenCode's pattern. Refine based on actual Codex CLI tool names observed during Phase 1.
- **Session distinction**: Display name `OpenAI Codex (ACP)` carries through the session detail header and provider chip naturally. No separate badge needed; the provider name itself disambiguates.

## Remaining Open Questions

- Phase 0 result: does the bundled `@openai/codex-sdk` binary respond to `--acp --stdio` with a valid initialize handshake? If yes, packaging is trivial; if no, scope grows by the install-flow work.
- Should `OpenAI Codex (ACP)` get its own settings panel in `SettingsSidebar`, or stay as a sub-section of the OpenAI Codex panel? Defer to implementation; sidebar entry is cleaner if model selection / API key configuration meaningfully diverge from the SDK provider, otherwise sub-section is fine.
- Does ACP support the same Codex model variants (`gpt-5.3-codex`, `gpt-5.2-codex`, etc.) the SDK exposes, or does the model list differ? Confirm during Phase 1 protocol port.
