---
planStatus:
  planId: plan-claude-model-switching
  title: Claude Model Switching
  status: in-development
  planType: feature
  priority: high
  owner: codex
  stakeholders:
    - ai-platform
  tags:
    - agentic-planning
  created: "2025-11-24"
  updated: "2025-11-24T19:40:02Z"
  progress: 75
  dueDate: ""
  startDate: ""
---
# Claude Model Switching

## Goals
- Surface discrete Claude Code model options (Opus/Sonnet/Haiku) inside the model selector so users can switch mid-session.
- Always send the selected Claude Code model ID down to the SDK when creating or resuming sessions.
- Only show the most recent Claude SDK foundation models per family (Opus/Sonnet/Haiku) when presenting options.

## Plan
1. **Audit existing model plumbing** ✅
   - Trace how `ModelRegistry` aggregates provider data and how `ai:getModels` feeds the renderer (ModelSelector + NewSessionButton).
   - Confirm where Claude Code sessions stash the active model; understand why `model` is `claude-code` today and how ProviderFactory initializes the SDK.
2. **Update registry + provider data** ✅
   - Extend `ClaudeCodeProvider.getModels()`/defaults to expose `claude-code:opus|sonnet|haiku`.
   - Teach `ModelRegistry` to filter Claude foundation models down to the latest per family (with a safe fallback when parsing fails).
3. **Thread model IDs through session + provider lifecycle** ✅
   - Ensure `ai:createSession`, session persistence, and ProviderFactory initialization all preserve/push `claude-code:<variant>` (and convert to bare `sonnet|opus|haiku` when invoking the SDK).
   - Update renderer utilities (ModelSelector, NewSessionButton, `parseModelInfo`) to display the richer Claude Code choices and to cope when models haven't been fetched yet.
4. **Verify flows**
   - Smoke-test switching models mid-session and starting new sessions with each variant.
   - Validate model filtering logic by logging/inspecting the grouped payload returned to the renderer.
