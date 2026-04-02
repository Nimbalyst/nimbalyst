---
planStatus:
  planId: plan-meta-agent
  title: Meta Agent - Delegating Orchestrator
  status: completed
  planType: feature
  priority: medium
  owner: jordanbentley
  stakeholders: []
  tags:
    - ai
    - agent
    - orchestration
  created: "2026-03-10"
  updated: "2026-03-10T17:23:00.000Z"
  progress: 100
---
# Meta Agent

A singleton orchestrator agent that delegates all work to child Claude Code/Codex sessions. It never writes code itself -- it only plans, delegates, and coordinates.

## Concept

The meta agent sits between agent mode and trackers in the left sidebar. It has one active session at a time. When the user describes work, the meta agent breaks it down and spawns child sessions (in worktrees or the current branch) to do the actual coding/research. It monitors progress and reports back.

Add `agent_role` column to `ai_sessions` and `created_by_session_id` to track which session spawned a child:
## Architecture

### 1. Provider Pattern: Role-Based Configuration

Both `ClaudeCodeProvider` and `OpenAICodexProvider` extend `BaseAgentProvider`. Rather than creating a new provider class, we add an **agent role** concept that configures the existing providers differently.

```
BaseAgentProvider
├── ClaudeCodeProvider   (claude-agent-sdk)
└── OpenAICodexProvider  (codex-sdk)
```

When a session has `agentRole: 'meta-agent'`, both providers:
- Use `buildMetaAgentSystemPrompt()` instead of `buildClaudeCodeSystemPrompt()`
- Pass an empty `allowedTools` list (no SDK-native tools)
- Use a filtered `McpConfigService` config (no user-installed MCP servers)

This mirrors how planning mode already restricts tools via `DEFAULT_PLANNING_TOOLS` and switches prompt behavior. The `agentRole` check lives in `BaseAgentProvider` so both providers inherit it.

```typescript
// In BaseAgentProvider or a shared helper
static readonly META_AGENT_ALLOWED_TOOLS: string[] = [];
// Empty array -- all capabilities come from MCP tools only

// In each provider's sendMessage(), before calling the SDK:
if (sessionData.agentRole === 'meta-agent') {
  options.allowedTools = BaseAgentProvider.META_AGENT_ALLOWED_TOOLS;
  options.systemPrompt.append = buildMetaAgentSystemPrompt(context);
}
```

### 2. Database: Track Meta-Agent Origin


```sql
ALTER TABLE ai_sessions ADD COLUMN agent_role TEXT DEFAULT 'standard';
-- Values: 'standard' | 'meta-agent'

ALTER TABLE ai_sessions ADD COLUMN created_by_session_id TEXT;
-- References the meta-agent session that spawned this child session
-- NULL for user-created sessions
```

Also add to `SessionData`:
```typescript
interface SessionData {
  // ... existing fields
  agentRole?: 'standard' | 'meta-agent';
  createdBySessionId?: string | null;  // meta-agent session that spawned this
}
```

This is distinct from `parentSessionId` (workstream hierarchy). A meta-agent-spawned session may or may not be in a workstream.

### 3. New Sidebar Mode: `'meta-agent'`

Add to `activeMode` in `App.tsx`, between `'agent'` and `'tracker'`. Has its own panel component `MetaAgentMode`.

### 4. MCP Server: `nimbalyst-meta-agent`

A new internal MCP server providing orchestration tools. Registered the same way as other internal servers (static port injection, SSE transport).

### 5. UI Panel

- **Left**: The meta agent's session transcript (conversation with user)
- **Right**: Dashboard of spawned child sessions with status, links, summaries

---

## Child Session Notifications

When a child session created by the meta agent finishes processing, encounters an interactive prompt (AskUserQuestion, ExitPlanMode), or errors -- it must notify the meta agent so the meta agent can react.

### How It Works

The notification system hooks into the existing `session:completed`, `session:waiting`, and `session:error` IPC events that already fire when sessions change state. A new listener checks if the completing session has a `createdBySessionId` and, if so, queues a notification to the meta agent.

```
Child session completes
  → session:completed IPC fires
  → Listener checks: does this session have createdBySessionId?
  → Yes → Build notification payload (status, original prompt, last messages)
  → Queue as a prompt to the meta-agent session via ai:createQueuedPrompt
```

### Notification Payload

Queued as a structured system message to the meta agent session:

```typescript
interface ChildSessionNotification {
  type: 'child_session_completed' | 'child_session_waiting' | 'child_session_error';
  sessionId: string;
  sessionTitle: string;
  originalPrompt: string;        // The initial prompt the child was given
  status: 'completed' | 'waiting_for_input' | 'error';
  lastMessages: string[];        // Last 2-3 messages from the session (truncated)
  editedFiles: string[];         // Files the session modified
  // For waiting_for_input:
  waitingFor?: 'ask_user_question' | 'exit_plan_mode' | 'tool_permission';
  waitingPromptData?: unknown;   // The AskUserQuestion questions, plan content, etc.
  // For error:
  errorMessage?: string;
}
```

### Event Types

| Child Session Event | Meta Agent Receives | Meta Agent Should... |
| --- | --- | --- |
| `session:completed` | `child_session_completed` with last messages + edited files | Summarize result, decide next steps |
| `session:waiting` (AskUserQuestion) | `child_session_waiting` with the question data | Answer on behalf of the user, or surface to user |
| `session:waiting` (ExitPlanMode) | `child_session_waiting` with plan content | Review plan, approve/reject, or surface to user |
| `session:waiting` (ToolPermission) | `child_session_waiting` with permission request | Approve/reject, or surface to user |
| `session:error` | `child_session_error` with error message | Retry, delegate to different session, or report to user |

### Queuing Mechanism

Uses the existing queued prompt infrastructure (`ai:createQueuedPrompt` → `queued_prompts` table). If the meta agent is currently processing, the notification waits in the queue and is picked up when the meta agent finishes its current turn. If the meta agent is idle, it triggers immediately.

The notification is formatted as a user-facing message so the meta agent can process it naturally:

```
[Child Session Update]
Session: "Fix auth bug" (session-abc123)
Status: completed
Original task: "Fix the null pointer exception in auth middleware..."
Last response: "I've fixed the null pointer exception by adding a guard check..."
Files edited: src/middleware/auth.ts, src/middleware/auth.test.ts
```

### MCP Tool: `get_session_result`

In addition to push notifications, the meta agent can pull results on demand:

| Tool | Purpose |
| --- | --- |
| `get_session_result` | Get the final state of any session: status, original prompt, last 2-3 messages, edited files, and any pending interactive prompt. Works for any session, not just ones spawned by this meta agent. |

This is useful when the meta agent wants to check on a session it didn't spawn, or re-read a result it already received.

---

## Tools Available to the Meta Agent

The meta agent has **zero SDK-native tools** (no Read, Write, Edit, Bash, Glob, Grep, WebFetch, WebSearch, Agent, etc.). All its capabilities come exclusively from MCP tools. This is the hardest possible restriction -- it can only interact with the world through session management.

### Nimbalyst MCP: Session Orchestration (`nimbalyst-meta-agent`)

New MCP server with tools for managing child sessions:

| Tool | Purpose |
| --- | --- |
| `list_worktrees` | List available worktrees for the current workspace so the meta agent can attach new child sessions to existing branches when needed. |
| `create_session` | Spawn a new Claude Code/Codex session with a task prompt. Options: provider (claude-code/openai-codex), `useWorktree` for a fresh worktree, `worktreeId` for an existing worktree, initial prompt. Returns session ID. |
| `get_session_status` | Check a child session's state: processing, idle, waiting_for_input, errored. Returns status + last activity time. |
| `get_session_result` | Get full result of any session: status, original prompt, last 2-3 messages, edited files, pending interactive prompts. |
| `send_prompt` | Queue a follow-up prompt to a child session. |
| `respond_to_prompt` | Answer an interactive prompt (AskUserQuestion, ExitPlanMode, ToolPermission) on a child session. |
| `list_spawned_sessions` | List all sessions created by this meta-agent session. Returns IDs, titles, statuses, creation times. |

### Nimbalyst MCP: Session Context (`nimbalyst-session-context`)

Already exists. Gives the meta agent visibility into what child sessions have done:

| Tool | Purpose |
| --- | --- |
| `get_session_summary` | Get title, user prompts, last response, edited files for a session |
| `list_recent_sessions` | Search/list sessions in the workspace |
| `get_workstream_overview` | See all sessions in a workstream |
| `get_workstream_edited_files` | Files edited across a workstream |

### Nimbalyst MCP: Session Naming (`nimbalyst-session-naming`)

Already exists. The meta agent names its own session:

| Tool | Purpose |
| --- | --- |
| `update_session_meta` | Set name, tags, phase for the meta-agent session itself |

### NOT Available

- **All SDK-native tools** -- No Read, Write, Edit, Bash, Glob, Grep, WebFetch, WebSearch, Agent, etc.
- **`nimbalyst-extension-dev`** -- No need for extension management
- **`nimbalyst-mcp`**** (display/screenshot tools)** -- Not needed for orchestration
- **User-installed MCP servers** -- The meta agent delegates to child sessions which have full MCP access. To use a user's MCP tool, the meta agent creates a child session.

---

## System Prompt

The meta agent uses `preset: 'claude_code'` (to get the base SDK capabilities) with a custom `append` section. This replaces the normal Nimbalyst addendum entirely.

```markdown
You are a Meta Agent -- an orchestrator that manages coding sessions. You NEVER write code,
edit files, or execute commands directly. You have no file system tools. Your sole job is to
decompose work into tasks and delegate each task to a child coding session.

## Your Role

- Break down user requests into discrete, parallelizable tasks
- Spawn child sessions (Claude Code or Codex) to execute each task
- Monitor child session progress and report status to the user
- Coordinate dependencies between tasks
- Summarize results when child sessions complete

## Rules

1. **You have no file system access.** You cannot read, write, or search files. To understand
   the codebase, delegate a research task to a child session and read its summary.
2. **Always delegate.** Every coding, refactoring, testing, or research task must go to a child
   session.
3. **Use worktrees for parallel work.** When tasks can run in parallel and touch different files,
   create each child session in its own worktree to avoid conflicts. Reuse existing worktrees
   when continuing work on a branch that is already in progress.
4. **Delegate git operations to the relevant child session.** Rebases, merges, conflict
   resolution, and similar branch-local actions should be performed by the child session
   working in that branch or worktree.
5. **Never push to origin or any other remote without explicit user permission.**
6. **Write clear task prompts.** Each child session gets a focused, self-contained prompt with
   all context it needs. Include relevant file paths, requirements, constraints, and whether
   the child should use a fresh worktree or an existing one.
7. **Do not poll while waiting.** End the turn when you are waiting on child sessions. The meta agent is notified whenever a child session finishes, errors, or needs input.
8. **Track progress.** Use explicit status checks only for spot checks, then summarize results when updates arrive.

## Workflow

1. User describes what they want done
2. Decompose into tasks -- identify dependencies and parallelism
3. Present your plan to the user for approval
4. Decide whether each child should use the current branch, a fresh worktree, or an existing worktree
5. Spawn child sessions with clear task prompts
6. If git coordination is needed, tell the relevant child session to handle the rebase, merge, or similar branch operation directly in its branch or worktree
7. Monitor progress, report back, handle any issues
6. Summarize what was accomplished when all tasks complete

## Task Decomposition Guidelines

- Each task should be small enough for one session to handle well
- Identify file boundaries -- tasks that touch different files can run in parallel
- Identify dependencies -- task B needs task A's output? Run sequentially.
- Include test-writing as a separate task when appropriate
- For large refactors, break into: analysis -> plan -> implement -> test
- If you need to understand the codebase first, spawn a research session

## Child Session Prompts

When creating a child session, write a prompt that includes:
- What to do (clear, specific instructions)
- Which files to modify (be explicit)
- Any constraints (don't change X, must be backward compatible, etc.)
- How to verify the work (run tests, check types, etc.)

## Receiving Notifications

When child sessions complete, encounter errors, or need input, you will automatically
receive a notification message. These look like:
```
[Child Session Update]
Session: "Fix auth bug" (session-abc123)
Status: completed | waiting_for_input | error
...
```
When you receive these:
- **completed**: Review the result via `get_session_result`, decide if more work is needed
- **waiting_for_input (AskUserQuestion)**: Read the question, either answer it yourself
  with `respond_to_prompt` or surface it to the user
- **waiting_for_input (ExitPlanMode)**: Review the plan, approve or reject with
  `respond_to_prompt`
- **error**: Investigate, retry with a different approach, or report to the user

## Checking on Sessions

Use `get_session_status` for a quick status check (processing/idle/waiting/error).
Use `get_session_result` for the full picture (status + last messages + edited files).
Use `send_prompt` to give follow-up instructions to a session that needs more work.
Use `respond_to_prompt` to answer interactive prompts on behalf of the user.

## Session Naming

You MUST call `update_session_meta` on your first turn to name this session and set tags.

{worktree_section}
```

The `{worktree_section}` is conditionally included if the meta agent is running in a worktree, same as the existing pattern.

---

## Scope for v1

1. `agentRole` field on SessionData + database migration
2. `createdBySessionId` field on SessionData + database migration
3. Role-based tool restriction in `BaseAgentProvider` (shared by both providers)
4. `buildMetaAgentSystemPrompt()` in `prompt.ts`
5. `nimbalyst-meta-agent` MCP server with `list_worktrees`, `create_session`, `get_session_status`, `get_session_result`, `send_prompt`, `respond_to_prompt`, `list_spawned_sessions`
6. Child session notification listener (hooks into `session:completed`, `session:waiting`, `session:error`; queues notifications to meta-agent session)
7. Filtered MCP server config (no user-installed servers, no SDK-native tools for meta-agent sessions)
8. New sidebar mode + `MetaAgentMode` panel component
9. Child session dashboard UI

## Decided Behaviors

- **AskUserQuestion from child sessions**: The meta agent can answer them itself or re-ask them to the user -- it decides based on context.
- **Tool permission requests from child sessions**: Re-surfaced as interactive prompts in the meta-agent session for the user to approve/reject.
- **Plan tracking**: Child sessions that produce plans (via ExitPlanMode) should be tracked as tracker items.
- **Transcript access**: Summaries only for now. Full transcripts may be added later.
