---
planStatus:
  planId: plan-preditor-agentic-commands
  title: Preditor Agentic Commands
  status: ready-for-development
  planType: feature
  priority: high
  owner: ghinkle
  stakeholders:
    - product
    - ai-platform
    - extensions
    - electron
  tags:
    - agentic-planning
    - ai
    - commands
    - automation
  created: "2025-09-21"
  updated: "2025-09-21T18:45:00Z"
  progress: 15
  dueDate: ""
  startDate: ""
---
# Preditor Agentic Commands
<!-- plan-status -->

## Vision & Objectives
- Deliver reusable, customizable agent command files that users can invoke against the currently open document to guide the AI assistant.
- Provide a first-class workspace `agents/` directory where teams can author, share, and version agent definitions alongside project assets.
- Allow extensions to bundle agents that can be installed into a workspace and subsequently tailored by users without breaking future updates.
- Enable tight integration with the AI chat panel and command palette so invoking an agent feels like running any other editor command.

## User Value
- Makes complex AI workflows repeatable and auditable (e.g., security reviews, localization, compliance checks).
- Encourages collaboration through shared agent libraries that encode team-specific practices.
- Reduces prompt engineering friction by offering structured, discoverable entry points instead of ad-hoc manual prompts.

## Functional Requirements
### Agent Definition Files
- Must live under `<workspace>/agents/` and support nested folders for organization.
- Support metadata (name, description, tags, author, version, required tools) plus the main instruction body.
- Allow optional pre-/post-hooks (e.g., data prep scripts, diff application) referenced by relative path or extension-provided modules.
- Extensions can register default agents that copy into the workspace on install and mark provenance for update diffing.

### Execution Flow
- Selecting an agent from the command box or AI panel attaches its instructions to the active AI chat session.
- The LLM receives the agent instructions plus current document context, and can call allowed tools to generate results.
- The AI panel surfaces agent metadata (summary, authorship) and ability to edit or re-run with modified parameters.
- Execution history (inputs, outputs, tool calls) is logged per session for auditing.

### Extensibility Hooks
- Provide an extension API to ship agent packs, declare compatibility ranges, and signal required tools/providers.
- Support workspace policies (e.g., disable certain agents, require approvals) controlled via configuration file (`agents.config.json`).
- Allow agent files to reference shared snippets or include statements to assemble larger playbooks.
***

## User Experience
- **__Discovery__**: Command palette shows recent/favorited agents; AI panel lists agents grouped by tags (Security, Editing, AI Drafting).
- **__Selection__**: Users preview description before running; keyboard shortcut opens command palette filtered to agents.
- **__Execution__**: Running an agent opens/uses the AI panel, displays progress (tool calls, steps) and output diff for optional apply.
- **__Editing__**: Inline editor or external file open allows quick tweaks; live preview shows how metadata impacts display.

## Technical Architecture
- Define agent schema using JSON Schema or Zod for validation; support Markdown/YAML hybrid format (frontmatter + prompt body).
- Implement file watcher to detect changes within `agents/` and hot-reload them into the command registry.
- Extend AI session manager to accept agent payloads, ensuring instructions merge with user prompts safely (prevent duplication, handle overrides).
- Build command palette integration that queries agent registry and exposes run/edit actions.
- Introduce provenance tracking: each agent stores origin (`user`, `extension:<id>`, `remote`) and update metadata for sync.

## Storage & Sync
- Agents stored as text files committed with workspace; optional `.agentsignore` to exclude sensitive agents.
- Provide serialization helpers so agents can be exported/imported (zip bundle, registry sync).
- Maintain `.agents/installed.json` to track extension-installed agents, versions, and pending updates.

## AI Session Integration
- When an agent runs, send structured `system` message containing instructions and explicit tool usage policy.
- Allow agent to specify required document scope (full doc, selection, metadata) and gather data via existing AI tooling APIs.
- Ensure undoable application of agent output (e.g., diffs) through existing Lexical transaction pipeline.
- Record telemetry for agent usage (which agent, duration, outcome, tool errors) to inform future improvements.

## Security & Compliance
- Validate agent files before execution (schema + allowed directives) to prevent arbitrary code execution.
- Enforce tool allowlists per agent; warn if an agent requests tools not available in the workspace or provider.
- Support digital signatures or checksums for extension-supplied agents to detect tampering.
- Surface compliance notices (e.g., security review agent warns about regulated data) inside AI panel.

## Milestones
1. **__Foundation__**: Finalize agent file schema, registry service, and file watcher; add command palette integration stub.
2. **__Workspace Agents__**: Implement CRUD for `agents/`, metadata editing UI, hot reload, and basic execution pipeline in AI panel.
3. **__Extension Support__**: Allow extensions to ship agents, handle installation/updates, add provenance UI cues.
4. **__Advanced Execution__**: Add pre/post hooks, tool policy enforcement, telemetry, and logging integrations.
5. **__Security & Polish__**: Validate schema, add permission controls, refine UX, and prepare documentation/tutorial.

## Testing & Observability
- Unit tests for schema validation, registry operations, and extension install flows.
- Integration/e2e tests covering agent execution scenarios (security review, document rewrite) via Playwright AI flows.
- Telemetry dashboards to monitor usage, failure rates, and average execution time.
- Regression tests to ensure agent edits persist and updates from extensions merge without data loss.

## Dependencies
- AI provider capabilities (must support system messages, tool invocation).
- Existing AI panel architecture for session management and diff application.
- Extension packaging pipeline to deliver agent files and metadata.

## Implementation Details

### Core File Structure (Streamlined)
Leveraging existing infrastructure to minimize new code:

#### New Runtime Components (Minimal)
- `packages/runtime/src/agents/AgentRegistry.ts` - In-memory registry of discovered agents
- `packages/runtime/src/agents/AgentExecutor.ts` - Execute agents through existing AI session
- `packages/runtime/src/agents/AgentSchema.ts` - TypeScript types and validation
- `packages/runtime/src/agents/types.ts` - Shared interfaces

#### Reuse Existing Services
- **File Operations**: Use existing `FileSystemService` for all agent file I/O
- **Metadata Cache**: Extend `DocumentMetadataCache` to cache agent frontmatter
- **File Watching**: Register `agents/` with existing workspace file watcher
- **AI Sessions**: Inject agent instructions into existing `AIService` sessions
- **Tool Execution**: Use existing `ToolExecutor` with agent-specified constraints

### UI Integration (Minimal Changes)

#### Command Palette Extension
- `packages/electron/src/renderer/components/CommandPalette/AgentCommands.tsx` - Add agent commands to existing palette

#### AI Chat Enhancement
- `packages/electron/src/renderer/components/AIChat/AgentSelector.tsx` - Dropdown to select agent for current session
- Reuse existing AI chat infrastructure for execution and results

#### No New IPC Channels
- Use existing `document-service:*` channels for agent file operations
- Leverage existing `ai:*` channels for agent execution
- No new preload API needed

### Database Schema (Extend Existing)
```sql
-- Add agent_id column to existing ai_sessions table
ALTER TABLE ai_sessions
ADD COLUMN agent_id TEXT,
ADD COLUMN agent_metadata JSONB;

-- Simple agent usage tracking in app_settings
-- Store as JSON in existing settings: { agent_favorites: [...], agent_recent: [...] }
```

### Agent File Format
Agents will use Markdown with YAML frontmatter for human readability and version control:
```yaml
---
name: security-review
description: Perform security analysis on code
version: 1.0.0
author: team
tags: [security, audit]
tools: [read, search, analyze]
parameters:
  severity:
    type: select
    options: [low, medium, high]
    default: medium
---
# Agent instructions in markdown...
```

## Open Questions
- Should agent files standardize on Markdown with YAML frontmatter or adopt a pure JSON/YAML format? **__Decision: Use Markdown with YAML frontmatter for consistency with plan documents__**
- How do we reconcile user edits when an extension updates its bundled agent—merge strategy or prompt user via diff? **__Recommendation: Show diff and prompt user to accept/reject/merge__**
- Do agents support parameter prompts (e.g., choose severity level) before execution? If so, how is UI rendered? **__Yes, using declarative parameter schema in frontmatter__**
- What is the permission model for sharing agents across teams or remote collaboration sessions? **__Start with read-only sharing, expand based on user feedback__**