# Interactive Prompts Architecture

When Claude needs user input (AskUserQuestion, ExitPlanMode, GitCommitProposal, ToolPermission), Nimbalyst uses a **durable prompts architecture** where the database is the source of truth.

## Key Principles

1. **Widgets render from tool call data** - Interactive widgets receive `toolCall.id`, `toolCall.arguments`, and `toolCall.result` directly from the message
2. **No ephemeral state for prompts** - Prompts survive session switches and app restarts
3. **`nimbalyst_tool_use` messages** - For tools intercepted before `tool_use` block exists (AskUserQuestion), we log our own message type that SessionManager parses into standard `toolCall` objects
4. **InteractiveWidgetHost pattern** - Widgets access callbacks, analytics, and IPC through an atom-based host, not prop drilling

## Current Implementation

| Prompt Type | Implementation | Message Type |
| --- | --- | --- |
| AskUserQuestion | `AskUserQuestionWidget` | `nimbalyst_tool_use` |
| ExitPlanMode | `ExitPlanModeWidget` | SDK `tool_use` |
| GitCommitProposal | `GitCommitConfirmationWidget` | MCP `tool_use` |
| ToolPermission | `ToolPermissionConfirmation` (legacy) | DB-backed atom |

## Widget Pattern (preferred)

```typescript
// Widget receives toolCall from message props
const { toolCall, sessionId } = props;
const host = useAtomValue(interactiveWidgetHostAtom(sessionId));

// Check pending state from tool call result
const isPending = !toolCall.result;

// Get data from tool call arguments
const { questions } = toolCall.arguments;

// Respond via host (which calls IPC)
await host.askUserQuestionSubmit(toolCall.id, answers);
```

## Key Files

- `packages/runtime/src/ui/AgentTranscript/components/CustomToolWidgets/` - Widget implementations
- `packages/runtime/src/store/atoms/interactiveWidgetHost.ts` - Host atom pattern

## Adding New Interactive Prompts

1. Define the tool in the appropriate MCP server or SDK tool list
2. Create a custom widget in `CustomToolWidgets/`
3. Register the widget in the tool widget registry
4. Use the `InteractiveWidgetHost` pattern for callbacks
5. Ensure the widget reads state from `toolCall.result` (not local state)
