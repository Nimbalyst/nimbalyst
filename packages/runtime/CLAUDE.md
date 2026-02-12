# Runtime Package

This package contains the core runtime logic for Nimbalyst, including AI provider implementations and shared services that work across Electron and Capacitor (mobile) platforms.

## Package Placement Guidelines

**Put React components in this package if they might be used by the mobile app version.** Components specific to Electron should go in the `electron` package.

## AI Provider Architecture

The application supports two categories of AI providers:

### Agent Providers
- **Examples**: Claude Agent, OpenAI Codex
- **Features**: Full MCP support, file system access via tools, multi-file operations, session persistence
- **Use case**: Advanced code editing tasks that benefit from MCP's context protocol

### Chat Providers
- **Examples**: Claude Chat, OpenAI, LM Studio
- **Features**: Direct API calls, files attached as context, faster responses, local model support
- **Use case**: Standard AI chat and code assistance

See `/docs/AI_PROVIDER_TYPES.md` for detailed documentation.

## AI Providers

### Claude (Anthropic API)
- **Direct API integration**: Uses the official Anthropic SDK (`@anthropic-ai/sdk`)
- **Provider ID**: `claude`
- **Location**: `src/ai/server/providers/ClaudeProvider.ts`
- **Features**:
  - Standard Claude models (Opus 4.1, Opus 4, Sonnet 4, Sonnet 3.7)
  - Streaming responses with tool use support
  - Direct API key authentication
  - Full control over model selection
- **When to use**: For standard AI chat and code assistance using Claude models directly

### Claude Code (MCP Integration)
- **MCP Protocol**: Uses Model Context Protocol for enhanced code-aware features
- **Provider ID**: `claude-code`
- **Implementation**: `src/ai/server/providers/ClaudeCodeProvider.ts`
  - Dynamically loads `@anthropic-ai/claude-agent-sdk` SDK from user's installation
  - Requires local installation via npm
  - Provides MCP features through SDK
- **Features**:
  - Enhanced code understanding through MCP
  - File system awareness and manipulation
  - Advanced code editing capabilities
  - Manages its own model selection internally (do not pass model IDs)
- **Installation**: Requires `npm install -g @anthropic-ai/claude-agent-sdk` or local installation
- **When to use**: For advanced code editing tasks that benefit from MCP's context protocol
- **Internal MCP Servers**: See `/docs/INTERNAL_MCP_SERVERS.md` for how to implement and add new MCP servers

### Other Providers
- **OpenAI**: GPT-4 and GPT-3.5 models via OpenAI API
- **LM Studio**: Local model support for privacy-focused usage
- **Multiple provider support**: Extensible architecture for adding new AI providers

### OpenAI Codex (SDK Integration)
- **Provider ID**: `openai-codex`
- **Implementation**: `src/ai/server/providers/OpenAICodexProvider.ts`
- **SDK**: Uses `@openai/codex-sdk` for thread-based streaming and tool execution
- **Features**:
  - Agent-style streaming event handling
  - Session resume via persisted provider session IDs
  - Tool integration through the shared runtime tool registry

#### Binary Path Resolution in Packaged Builds

In Electron packaged apps, the Codex SDK binary cannot be executed from within the asar archive (virtual filesystem). The `resolvePackagedCodexBinaryPath()` function handles this by:

1. **Resolving platform-specific binaries**: Maps `process.platform` and `process.arch` to Codex target triples (e.g., `aarch64-apple-darwin` for ARM64 macOS, `x86_64-pc-windows-msvc` for x64 Windows)
2. **Checking unpacked locations**: Looks for binaries in `app.asar.unpacked/node_modules/@openai/codex-sdk` first (priority location)
3. **Fallback to node_modules**: Falls back to `node_modules/@openai/codex-sdk` if unpacked path unavailable
4. **Passing to SDK**: The resolved path is passed to the Codex SDK constructor via `codexPathOverride` parameter

**Related files:**
- `src/ai/server/providers/codex/codexBinaryPath.ts` - Binary resolution logic
- `packages/electron/package.json` - Build config includes codex-sdk in `asarUnpack` and `extraResources`

## Provider Implementation Details

### Key Files for Claude Providers

**Claude API Provider:**
- Main implementation: `src/ai/server/providers/ClaudeProvider.ts`
- Supports model selection from predefined list in `src/ai/modelConstants.ts`

**Claude Code Provider:**
- Implementation: `src/ai/server/providers/ClaudeCodeProvider.ts`
- Requires separate installation of `@anthropic-ai/claude-agent-sdk` package
- Dynamically loads SDK from user's installation

### Provider Factory
- Location: `src/ai/server/ProviderFactory.ts`
- Creates and manages provider instances based on type
- Provider types: `claude`, `claude-code`, `openai`, `openai-codex`, `lmstudio`
- Each provider is cached per session for efficiency

## AI Features

### AI Chat Panel
- **Multi-provider support**: Works with Claude, OpenAI, LM Studio, and Claude Code
- **Document-aware**: Sends current document context with messages when a document is open
- **No-document handling**: Clear messaging when no document is open, prevents edit attempts
- **Session management**: Multiple chat sessions per project
- **Edit streaming**: Real-time streaming of code edits directly to the editor
- **Dynamic UI**: Provider-specific icons and names throughout the interface

### Session Manager
- **Global session view**: Access all AI chat sessions across all projects
- **Session search**: Filter sessions by content, project, or date
- **Session details**: View full conversation history for any session
- **Session actions**: Open, export, or delete sessions
- **Left navigation design**: Clean interface with session list on left, details on right

### AI Model Configuration
- **Dynamic model selection**: Models are fetched from provider APIs when available
- **No hardcoded models**: Providers manage their own model defaults
- **Claude Code specifics**: Never pass model IDs to claude-code provider - it manages its own model selection
- **LM Studio detection**: Automatically detects local models running in LM Studio
- **Model management**: Select/deselect all buttons for bulk model configuration
- **Smart defaults**: Doesn't auto-select all models when enabling a provider

### Custom Tool Widgets

Custom widgets can replace the generic tool call display for specific MCP tools. See `/docs/CUSTOM_TOOL_WIDGETS.md` for implementation details.

## Linear Integration

We use the Linear MCP integration with the "NIM" project for issue tracking.
