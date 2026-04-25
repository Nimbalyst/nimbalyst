---
planStatus:
  planId: plan-copilot-cli-agent-provider
  title: GitHub Copilot CLI agent provider
  status: in-review
  planType: design
  priority: high
  owner: ghinkle
  stakeholders: []
  tags:
    - ai
    - agents
    - copilot
    - github
    - mcp
    - transcripts
    - permissions
  created: "2026-04-21"
  updated: "2026-04-23T12:00:00.000Z"
  startDate: "2026-04-23"
  progress: 100
---
# GitHub Copilot CLI Agent Provider

## Implementation Progress

- [x] Add `copilot-cli` to AI_PROVIDER_TYPES, isAgentProvider, and exhaustive switches
- [x] Add provider defaults in settings state and model constants
- [x] Add provider labels, icons, and settings category support
- [x] Extend CLIManager install/check logic for copilot CLI
- [x] Create CopilotCLI settings panel
- [x] Wire SettingsView and SettingsSidebar for copilot-cli
- [x] Implement CopilotACPProtocol adapter (spawn copilot --acp --stdio)
- [x] Implement CopilotCLIProvider extending BaseAgentProvider
- [x] Register provider in ProviderFactory
- [x] Wire MCP ports and config loaders in electron main process
- [x] Add copilot-cli to transcript parser routing
- [x] Add alpha feature gate for copilot-cli
- [x] Typecheck passes

## Goal

Add `copilot-cli` as a first-class agent provider in Nimbalyst alongside
`claude-code`, `openai-codex`, and `opencode`.

The integration should support:

- agent-mode sessions with session resume
- structured streaming output, not terminal scraping
- MCP server injection through the existing Nimbalyst MCP pipeline
- Nimbalyst permission prompts for tool/file/network actions
- canonical transcript storage and replay
- model discovery or a safe default model path
- global settings, project overrides, and provider selection UI

## Non-Goals

- Do not implement Copilot as a chat-only provider.
- Do not drive the interactive terminal UI with PTY automation.
- Do not silently read `GH_TOKEN` or `GITHUB_TOKEN` from environment variables
  as an implicit auth fallback.
- Do not expand the Super Loop, teammate, or task orchestration flows in the
  first pass unless Copilot exposes primitives that map cleanly onto them.
- Do not make Copilot enabled by default in the initial rollout.

## Background

Nimbalyst already has three distinct agent-provider patterns:

- `claude-code`: deep SDK integration with provider-specific hooks
- `openai-codex`: `BaseAgentProvider` plus a protocol adapter and normalized
  event stream
- `opencode`: local CLI/server integration using the same agent protocol shape

The existing architecture already points to the right seam for Copilot:

- provider identity is centralized in
  `packages/runtime/src/ai/server/types.ts`
- agent providers are created through
  `packages/runtime/src/ai/server/ProviderFactory.ts`
- model discovery is routed through
  `packages/runtime/src/ai/server/ModelRegistry.ts`
- settings and enablement live in
  `packages/electron/src/renderer/store/atoms/appSettings.ts`
- agent provider UI is surfaced in
  `packages/electron/src/renderer/components/Settings/SettingsSidebar.tsx`

GitHub documents an ACP server mode for Copilot CLI via
`copilot --acp --stdio`. That is the preferred integration path because it
provides structured protocol messages suitable for Nimbalyst's provider and
transcript pipeline. ACP is still documented as public preview, so this design
should isolate Copilot-specific protocol code behind a thin adapter boundary.

References:

- GitHub Copilot CLI ACP server:
  https://docs.github.com/en/copilot/reference/copilot-cli-reference/acp-server
- GitHub Copilot CLI command reference:
  https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference
- GitHub Copilot CLI repository:
  https://github.com/github/copilot-cli

## Proposal

Implement Copilot as a new agent provider:

- provider ID: `copilot-cli`
- runtime provider class: `CopilotCLIProvider`
- protocol adapter: `CopilotACPProtocol`
- settings panel: `CopilotCLISettingsPanel`
- transcript parser: a generic protocol parser or a Copilot-specific protocol
  parser, not a PTY log parser

The provider should extend `BaseAgentProvider`, matching the general approach
used by Codex and OpenCode rather than the more specialized Claude Agent SDK
integration.

## Why ACP Instead of PTY Scraping

PTY automation would be easy to start and expensive to keep:

- terminal output is presentation-oriented, not contract-oriented
- tool calls and permission prompts would need brittle string parsing
- session resume would be harder to make reliable
- transcript reconstruction would be lossy
- model/tool metadata would be inferred instead of structured

ACP is the better fit because Nimbalyst already expects a structured provider
protocol with normalized event types such as:

- `text`
- `reasoning`
- `tool_call`
- `tool_result`
- `complete`
- `error`

That maps naturally to the existing `AgentProtocolTranscriptAdapter` pattern.

## Architecture

### 1. Provider identity and lifecycle

Add `copilot-cli` anywhere provider identity is enumerated or exhaustively
switched on:

- `AI_PROVIDER_TYPES`
- `isAgentProvider()`
- provider-display helpers
- settings categories and provider labels
- preload and renderer API unions
- project override types

Create `CopilotCLIProvider` in
`packages/runtime/src/ai/server/providers/`.

Responsibilities:

- inherit shared permission/session lifecycle behavior from
  `BaseAgentProvider`
- build the system prompt and user-message additions
- initialize Copilot protocol sessions
- store provider session IDs for resume
- log raw protocol events for canonical transcript transformation
- yield normalized chunks back to `AIService`

### 2. ACP protocol adapter

Add `CopilotACPProtocol` in
`packages/runtime/src/ai/server/protocols/`.

Responsibilities:

- spawn `copilot --acp --stdio`
- establish ACP session transport
- create, resume, and abort sessions
- normalize Copilot ACP messages into Nimbalyst `ProtocolEvent` objects
- translate Copilot permission requests into Nimbalyst permission hooks
- surface model metadata when available

This should mirror the role `CodexSDKProtocol` and `OpenCodeSDKProtocol` play
today: the provider remains Nimbalyst-specific, while the protocol adapter
absorbs SDK/CLI-specific behavior.

### 3. Transcript path

Do not store opaque terminal text and try to recover structure later.

Instead:

1. log raw ACP event payloads to `ai_agent_messages`
2. tag those raw messages with provider-specific metadata
3. transform them into canonical transcript events
4. render them through the existing transcript projector

The current transcript transformer only routes `openai-codex` and `open-code`
through `CodexRawParser`, falling back to `ClaudeCodeRawParser` otherwise.
Copilot needs one of these two paths:

- introduce a generic `ProtocolRawParser` for normalized `ProtocolEvent`
  payloads and route `openai-codex`, `opencode`, and `copilot-cli` through it
- or add a dedicated `CopilotRawParser` if ACP events require richer handling

The first option is preferable if Copilot ACP can be normalized cleanly.

### 4. MCP integration

Copilot should use the existing `McpConfigService` flow.

Requirements:

- merge global and workspace MCP servers
- include Nimbalyst internal MCP servers
- scope MCP configuration to worktree/workspace correctly
- pass Copilot-compatible MCP config into the ACP session

If ACP supports direct server descriptors, use that. If Copilot only supports
CLI-side config injection, generate a temporary config payload or file at the
protocol layer and keep the conversion local to `CopilotACPProtocol`.

### 5. Permissions

Permission handling must be explicit and aligned with Nimbalyst's existing
agent-permission model.

Requirements:

- file/tool/network requests surface through Nimbalyst interactive prompts
- allow-once, allow-for-session, and persistent-pattern flows remain possible
- dangerous bypass modes stay opt-in
- project trust and worktree inheritance still apply

Copilot should not be launched in an "allow everything" mode by default just to
get the integration working.

### 6. Auth model

Primary auth mode:

- rely on the user's existing Copilot CLI login state

Optional later auth mode:

- explicit token field stored in Nimbalyst settings

Guardrail:

- do not read `process.env.GH_TOKEN` or `process.env.GITHUB_TOKEN` in
  Nimbalyst as an implicit auth source

Passing shell environment for `PATH` resolution is still useful, but token-like
GitHub auth environment variables should be scrubbed unless the user has
explicitly opted into PAT-based auth.

### 7. Model selection

Copilot may support model selection, but the design should tolerate a "CLI
default" world if model listing is incomplete or unstable.

Initial shape:

- default model ID: `copilot-cli:default`
- optional dynamic discovery via ACP/API if available
- settings UI should look like OpenCode or Codex if models are dynamic
- if models are not discoverable, provider UI should make that explicit and let
  Copilot manage the effective model itself

## Repository Touch Points

This is the minimum set of files or subsystems likely to change.

### Runtime

- `packages/runtime/src/ai/server/types.ts`
- `packages/runtime/src/ai/server/ProviderFactory.ts`
- `packages/runtime/src/ai/server/ModelRegistry.ts`
- `packages/runtime/src/ai/modelConstants.ts`
- `packages/runtime/src/ai/server/providers/CopilotCLIProvider.ts`
- `packages/runtime/src/ai/server/protocols/CopilotACPProtocol.ts`
- `packages/runtime/src/ai/server/protocols/ProtocolInterface.ts`
- transcript parser/adapter files under
  `packages/runtime/src/ai/server/transcript/`

### Electron main

- `packages/electron/src/main/services/CLIManager.ts`
- `packages/electron/src/main/services/ai/AIService.ts`
- MCP config wiring for provider startup in `packages/electron/src/main/index.ts`

### Renderer/settings

- `packages/electron/src/renderer/store/atoms/appSettings.ts`
- `packages/electron/src/renderer/components/Settings/SettingsSidebar.tsx`
- `packages/electron/src/renderer/components/Settings/SettingsView.tsx`
- a new settings panel under
  `packages/electron/src/renderer/components/GlobalSettings/panels/`
- model selector/provider-label helpers

### Agent-mode surfaces that hardcode current providers

These should be audited for assumptions that only Claude Agent and Codex are
valid agent choices:

- Super Loop dialogs
- Git conflict resolution agent pickers
- workstream model pickers
- provider icons and labels
- any provider-specific defaulting to `claude-code`

## Implementation Plan

### Phase 1: Provider plumbing

- add `copilot-cli` to provider identity types and exhaustive switches
- add provider defaults in settings state and model constants
- add provider labels, icons, and settings category support
- extend `CLIManager` install/check logic for `copilot`

Exit criteria:

- the app can store, enable, and display the provider without runtime type
  holes

### Phase 2: ACP transport and basic session loop

- implement `CopilotACPProtocol`
- spawn `copilot --acp --stdio`
- create and resume sessions
- map Copilot ACP updates to `ProtocolEvent`
- add minimal test coverage for transport startup and event normalization

Exit criteria:

- a session can stream text and complete successfully

### Phase 3: Transcript and file/tool event integration

- decide between `ProtocolRawParser` vs `CopilotRawParser`
- store raw ACP events in `ai_agent_messages`
- transform them into canonical transcript events
- confirm tool calls and results render correctly
- ensure file/tool events are visible to `AIService` for session file tracking

Exit criteria:

- Copilot sessions render in transcript history with recoverable structure

### Phase 4: Permissions and MCP

- wire Copilot permission requests into Nimbalyst prompts
- pass merged MCP config into Copilot sessions
- verify worktree/workspace path scoping
- verify project trust and tool-permission flows still hold

Exit criteria:

- Copilot can use Nimbalyst MCP tools without bypassing permission policy

### Phase 5: UI completion and rollout

- add a dedicated settings panel and install/auth guidance
- update agent pickers that currently only show Claude/Codex
- gate initial rollout behind an alpha feature flag if ACP remains unstable
- add smoke tests for provider selection and session creation

Exit criteria:

- users can enable Copilot, create a session, and use it through the normal
  agent UI

## Risks and Mitigations

### ACP protocol churn

Risk:

- GitHub changes ACP payloads or semantics while the feature is still in
  preview

Mitigation:

- isolate protocol handling inside `CopilotACPProtocol`
- keep normalized event mapping small and well-tested
- ship behind an alpha gate initially

### Permission mismatch

Risk:

- Copilot's permission model may not line up cleanly with Nimbalyst's current
  allow-once/session/persistent approvals

Mitigation:

- treat permission mapping as a first-class milestone, not a follow-up
- default to the safest useful mode until a richer mapping is proven

### Weak file-attribution events

Risk:

- ACP may not expose enough structure to identify pre/post edit boundaries the
  way Claude's hooks do

Mitigation:

- normalize and retain raw events for future parser upgrades
- fall back to existing file watcher/session tracker paths where necessary
- keep Copilot MVP honest about what attribution quality is guaranteed

### Auth confusion

Risk:

- users expect Nimbalyst to manage GitHub auth the same way it manages API-key
  chat providers

Mitigation:

- make "uses Copilot CLI login" the default UI copy
- keep PAT support explicit if added later
- do not auto-import GitHub tokens from environment variables

## Open Questions

1. Does Copilot ACP expose a stable session identifier suitable for long-lived
   resume semantics?
2. Does ACP expose permission requests with enough structure to preserve
   Nimbalyst's current approval UX?
3. Can MCP servers be passed directly per session, or does the protocol layer
   need a generated config file workaround?
4. Is model discovery available through ACP, or should `copilot-cli:default`
   be the only supported model selection in the first version?
5. Do Super Loop and teammate flows need Copilot support in v1, or should the
   initial integration be limited to standard agent sessions?
6. Should Copilot launch behind the existing alpha-feature system until ACP
   behavior stabilizes?

## Recommended First Cut

The best first implementation is:

- `copilot-cli` as an alpha-gated agent provider
- ACP stdio transport only
- standard agent sessions only
- MCP support included
- Nimbalyst permission prompts included
- transcript support included
- teammate and Super Loop support deferred until the base provider proves
  stable

That gives Nimbalyst a structurally correct Copilot integration without
committing the rest of the agent stack to preview-protocol assumptions too
early.
