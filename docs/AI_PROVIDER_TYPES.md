# AI Provider Types

Nimbalyst supports two categories of AI providers, each with different capabilities and use cases.

## Agent Providers

Agent providers are designed for autonomous coding tasks. They have full access to your codebase through the Model Context Protocol (MCP) and can read, write, and modify files directly.

### Capabilities

- **MCP Support**: Native integration with Model Context Protocol for tool execution
- **File System Access**: Can read and write files directly via MCP tools
- **Multi-file Operations**: Capable of complex refactoring across multiple files
- **Session Persistence**: Maintains context across conversation turns
- **Planning Mode**: Supports plan-then-execute workflows for safer changes

### Available Agent Providers

| Provider | Description |
|----------|-------------|
| Claude Code | Uses the Claude Agent SDK with full MCP integration |
| OpenAI Codex | Uses the OpenAI Codex SDK with agent-style streaming and tool support |

### Claude Code Provider Details

The primary agent provider, Claude Code, uses the Model Context Protocol for enhanced code-aware features:

- **Provider ID**: `claude-code`
- **Implementation**: `packages/runtime/src/ai/server/providers/ClaudeCodeProvider.ts`
- **SDK**: Dynamically loads `@anthropic-ai/claude-agent-sdk` from user's installation
- **Installation**: Requires `npm install -g @anthropic-ai/claude-agent-sdk` or local installation
- **Model Selection**: Manages its own model selection internally (do not pass model IDs)
- **Internal MCP Servers**: See [INTERNAL_MCP_SERVERS.md](./INTERNAL_MCP_SERVERS.md) for how to implement and add new MCP servers

### When to Use

- Complex refactoring tasks
- Multi-file changes
- Tasks requiring file system awareness
- When you need the AI to explore and understand your codebase

## Chat Providers

Chat providers use direct API calls for conversational AI assistance. Files are attached as context to messages rather than accessed via tools.

### Capabilities

- **Streaming Responses**: Real-time response streaming
- **Tool Calling**: Basic tool support (applyDiff, streamContent)
- **File Context**: Files are injected into the conversation as context
- **Direct API**: Uses official provider SDKs for reliable integration

### Available Chat Providers

| Provider | Description |
|----------|-------------|
| Claude Chat | Direct Anthropic API - reliable, fast responses |
| OpenAI | GPT-4 and other OpenAI models |
| LM Studio | Local models for privacy-focused usage |

### Claude Chat Provider Details

Direct Anthropic API integration for standard chat:

- **Provider ID**: `claude`
- **Implementation**: `packages/runtime/src/ai/server/providers/ClaudeProvider.ts`
- **SDK**: Uses official Anthropic SDK (`@anthropic-ai/sdk`)
- **Features**:
  - Standard Claude models (Opus 4.6, Sonnet 4.6, Opus 4.5, Sonnet 4.5, etc.)
  - Streaming responses with tool use support
  - Direct API key authentication
  - Full control over model selection

### Other Chat Providers

- **OpenAI**: GPT-4 and GPT-3.5 models via OpenAI API
- **LM Studio**: Local model support for privacy-focused usage - automatically detects models running locally

### When to Use

- Quick questions about code
- Single-file edits
- When you want faster responses
- When running models locally (LM Studio)
- When you prefer simpler, more predictable behavior

## Feature Comparison

| Feature | Agent Providers | Chat Providers |
|---------|----------------|----------------|
| MCP Support | Yes | No |
| File Tools | Via MCP | Attached as context |
| Multi-file Awareness | Native | Limited |
| Session Resume | Yes | No |
| Response Speed | Moderate | Fast |
| Local Model Support | No | Yes (LM Studio) |

## Implementation Details

### Provider Architecture

All AI providers extend from `BaseAIProvider`, which provides common functionality like tool registration, message logging, and event emission. Agent providers further extend from `BaseAgentProvider`, which adds agent-specific infrastructure:

```
BaseAIProvider (abstract)
  ├── Chat providers (Claude, OpenAI, LM Studio)
  └── BaseAgentProvider (agent-specific infrastructure)
        ├── ClaudeCodeProvider
        ├── OpenAICodexProvider
        └── Future agent providers
```

**BaseAgentProvider** provides shared agent infrastructure:
- Abort controller management
- Session ID mapping (Nimbalyst session ID ↔ provider session ID)
- Permission management (pending requests, session cache, resolve/reject lifecycle)
- Permission response polling (for cross-device and mobile support)
- Security logging
- Best-effort message logging
- Shared static injections (trust checker, permission pattern persistence)

This architecture ensures all agent providers have consistent behavior for permissions, session management, and lifecycle handling.

### Provider Detection

The codebase determines provider type using these flags in `ProviderCapabilities`:

```typescript
interface ProviderCapabilities {
  supportsFileTools: boolean;  // true for agents, false for chat
  mcpSupport: boolean;         // true for agents, false for chat
  // ...
}
```

### Key Files

- Base providers: `packages/runtime/src/ai/server/AIProvider.ts`, `packages/runtime/src/ai/server/providers/BaseAgentProvider.ts`
- Agent provider implementations: `packages/runtime/src/ai/server/providers/ClaudeCodeProvider.ts`, `OpenAICodexProvider.ts`
- Chat provider implementations: `packages/runtime/src/ai/server/providers/ClaudeProvider.ts`, etc.
- Type definitions: `packages/runtime/src/ai/server/types.ts`
- Provider factory: `packages/runtime/src/ai/server/ProviderFactory.ts`

### Adding New Agent Providers

To add a new agent provider:

1. Extend `BaseAgentProvider` instead of `BaseAIProvider`
2. Implement required abstract methods:
   - `getProviderName(): string` - Return the provider identifier
   - `getProviderSessionData(sessionId: string): any` - Return provider session data with legacy key mapping
   - `sendMessage(...)` - Implement the provider-specific streaming logic
   - `initialize(config: ProviderConfig)` - Set up the provider
3. Override `abort()` and `destroy()` if you need provider-specific cleanup (remember to call `super`)
4. All shared functionality (permissions, sessions, polling, logging) is inherited automatically

The base class provides default implementations for `getCapabilities()`, `setProviderSessionData()`, `resolveToolPermission()`, `rejectToolPermission()`, etc. Override these only if you need provider-specific behavior.

## Switching Between Modes

You cannot switch between Agent and Chat providers mid-session. Once a started session is using an agent provider, you also cannot switch it to a different agent provider such as Claude Agent to OpenAI Codex, or the reverse. Start a new session to change providers. This ensures consistent behavior and prevents context confusion.
