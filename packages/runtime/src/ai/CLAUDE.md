# AI System Prompts - CLAUDE.md

This directory contains the AI provider implementations and system prompt construction logic.

## System Prompt Architecture

### Overview

System prompts are dynamically constructed messages that establish the AI assistant's context, identity, and capabilities. They are built on-demand when messages are sent to AI providers and include:

1. **Base identity and role** - Who the AI is and what it can do
2. **Document context** - Information about the currently open file
3. **Mode-specific instructions** - Different guidance for chat vs. agentic coding
4. **Provider-specific addendums** - Additional instructions for Claude Code

### Critical Findings from Code Analysis

After a comprehensive trace through the codebase, here are the key facts:

**Base Providers (Claude, OpenAI, LM Studio):**
- Use `buildSystemPrompt(documentContext)` from `prompt.ts`
- Include FULL document content inline in the system prompt
- Include file type, cursor position, selection, mockup context
- Heavy emphasis on tool usage (applyDiff, streamContent, updateFrontmatter)
- One monolithic prompt built from the function

**Claude Code Provider - Two Distinct Modes:**

1. **Agentic Coding Mode** (`sessionType === 'coding'`):
   - Returns a MINIMAL custom prompt (bypasses addendum entirely)
   - NO document context, NO file content, NO editing rules
   - Only includes: base identity, worktree warning, session naming, voice mode
   - Lets Claude Code SDK handle everything naturally
   - Session naming: "IMPORTANT: Call ONCE at the very start"

2. **Document Editing Mode** (non-coding):
   - Uses `buildClaudeCodeSystemPromptAddendum()` from `prompt.ts`
   - Wrapped as an `<addendum>` to override SDK defaults
   - **CRITICAL**: Does NOT include full document content (unlike base providers)
   - Only includes: file path, cursor position, selected text
   - Claude Code SDK loads file content via Read tool
   - Session naming: "CRITICAL: MUST call BEFORE ending first turn"

**SDK Integration:**
- Claude Code uses `preset: 'claude_code'` with `append: systemPrompt`
- SDK preset includes: native instructions, tool docs, file system awareness, CLAUDE.md loading
- Our custom prompt/addendum is appended to the SDK's preset
- `settingSources` controls which CLAUDE.md files are loaded: 'user' (~/.claude/), 'project' (workspace/)

### Core Files

**Prompt Construction:**
- `prompt.ts` - Main system prompt builders
  - `buildSystemPrompt(documentContext)` - Base prompt for all non-Claude-Code providers
  - `buildClaudeCodeSystemPromptAddendum(documentContext, hasSessionNaming)` - Claude Code specific addendum

**Provider Implementations:**
- `server/AIProvider.ts` - Base provider interface
- `server/providers/ClaudeProvider.ts` - Direct Claude API integration
- `server/providers/ClaudeCodeProvider.ts` - Claude Code (MCP) integration
- `server/providers/OpenAIProvider.ts` - OpenAI integration
- `server/providers/LMStudioProvider.ts` - Local model support

**Context Assembly:**
- `packages/electron/src/renderer/components/EditorMode/EditorMode.tsx` - Builds `DocumentContext` from active editor
- `packages/electron/src/main/services/ai/AIService.ts` - Routes messages and enhances context

**Type Definitions:**
- `server/types.ts` - Core types including `DocumentContext`, `Message`, `ChatAttachment`
- `types.ts` - Re-exports and UI-specific types

### System Prompt Flow

```
User sends message
       ↓
EditorMode.getDocumentContext() builds DocumentContext
  (filePath, content, cursor, selection, mockupSelection, mockupDrawing)
       ↓
AIService enhances context with session metadata
  + sessionType ('chat' | 'coding')
  + mode ('agent' | 'planning')
  + permissionsPath
  + worktreeId, worktreePath, worktreeProjectPath
  + isVoiceMode, voiceModeCodingAgentPrompt
  + attachments
       ↓
Provider.buildSystemPrompt(documentContext)
  ├─ Base Providers: buildSystemPrompt() → Full prompt with document content
  ├─ Claude Code (coding): Minimal prompt (NO addendum, NO document)
  └─ Claude Code (non-coding): buildClaudeCodeSystemPromptAddendum() → No content
       ↓
Provider sends to AI
  ├─ Base Providers: Direct API call with system prompt
  └─ Claude Code: SDK with preset='claude_code' + append=our prompt
       ↓
AI receives:
  ├─ Base: Full document inline
  └─ Claude Code: CLAUDE.md + our addendum/prompt (loads files via Read tool)
```

### Document Context Structure

The `DocumentContext` object contains information about the currently active document:

```typescript
interface DocumentContext {
  filePath?: string;                    // Path to the file
  fileType?: string;                    // File type (markdown, mockup, code, etc.)
  content: string;                      // Full file content
  cursorPosition?: { line, column };    // Current cursor position
  selection?: string | object;          // User's text selection
  textSelection?: { text, filePath, timestamp };

  // Session context (added by AIService)
  sessionType?: 'chat' | 'coding';      // Type of AI session
  mode?: 'agent' | 'planning';          // Coding session mode
  permissionsPath?: string;             // Path for permission lookups
  attachments?: ChatAttachment[];       // Files attached via @ mentions

  // Worktree context (for isolated coding sessions)
  worktreeId?: string;                  // Worktree database ID
  worktreePath?: string;                // Worktree directory path
  worktreeProjectPath?: string;         // Parent project path

  // Voice mode context
  isVoiceMode?: boolean;                // Request from voice mode
  voiceModeCodingAgentPrompt?: {        // Custom voice mode prompts
    prepend?: string;
    append?: string;
  };

  // Mockup-specific context
  mockupSelection?: {                   // Selected HTML element
    tagName: string;
    selector: string;
    outerHTML: string;
  };
  mockupDrawing?: boolean;              // User drew annotations
  mockupAnnotationTimestamp?: number;   // When annotations were added
}
```

### Provider-Specific Prompt Construction

#### 1. Base Providers (Claude, OpenAI, LM Studio)

**Location:** `prompt.ts:buildSystemPrompt()`

These providers use a simple prompt structure:

```typescript
// From prompt.ts
export function buildSystemPrompt(documentContext?: DocumentContext): string {
  // 1. Base identity
  let base = `You are an AI assistant integrated into the Nimbalyst editor...`;

  // 2. Mode-specific instructions
  if (sessionType === 'coding') {
    return base + `You are working in agentic coding mode...`;
  }

  // 3. Document state
  if (!hasDocument) {
    return base + `IMPORTANT: No document is currently open...`;
  }

  // 4. Document context with visual separators
  return base + `
═══════════════════════════════════════════════════════════
🎯 ACTIVE DOCUMENT (the file the user is asking you to edit):
═══════════════════════════════════════════════════════════
File path: ${documentContext?.filePath}
File type: ${fileType}
Cursor position: Line ${line}, Column ${column}

📝 USER-SELECTED TEXT:
${selectedText}

Full content of the active document:
\`\`\`${fileType}
${documentContext.content}
\`\`\`
═══════════════════════════════════════════════════════════

🚨 CRITICAL TOOL USAGE RULES - YOU MUST FOLLOW THESE:
1. EVERY edit request REQUIRES using a tool - NO EXCEPTIONS
...
`;
}
```

**Key Features:**
- Single monolithic prompt built from the function
- Includes full document content inline
- Heavy emphasis on tool usage rules
- Mode-specific instructions (chat vs. coding)
- Selection context clearly marked

#### 2. Claude Code Provider

**Location:** `server/providers/ClaudeCodeProvider.ts:buildSystemPrompt()`

Claude Code uses a **two-part system**:

**Part 1: SDK Preset (handled by Claude Code SDK)**
```typescript
// From ClaudeCodeProvider.ts line 470-474
systemPrompt: {
  type: 'preset',
  preset: 'claude_code',  // SDK's built-in Claude Code system prompt
  append: systemPrompt     // Our custom addendum
}
```

The `'claude_code'` preset includes:
- Claude Code's native instructions
- Tool documentation
- File system awareness
- MCP server integration
- CLAUDE.md file references (loaded by SDK)

**Part 2: Nimbalyst Addendum (our custom instructions)**

For **agentic coding sessions** (line 3304-3380):

**CRITICAL**: Coding mode returns ONLY the custom prompt, NOT the addendum. It bypasses `buildClaudeCodeSystemPromptAddendum()` entirely.

```typescript
protected buildSystemPrompt(documentContext?: DocumentContext): string {
  const sessionType = (documentContext as any)?.sessionType;

  if (sessionType === 'coding') {
    // Minimal prompt - let Claude Code SDK work naturally
    let prompt = `You are an AI assistant integrated into the Nimbalyst editor's agentic coding workspace.
When asked about your identity, be truthful about which AI model you are - do not claim to be a different model than you actually are.`;

    // Add worktree warning if in isolated environment
    const worktreePath = documentContext?.worktreePath;
    if (worktreePath) {
      prompt += `

## Git Worktree Environment

IMPORTANT: You are working in a git worktree at ${worktreePath}. This is an isolated environment for this coding session.

- Make sure to stay in this worktree directory
- Do not modify files in the main branch unless explicitly asked by the user
- All changes you make will be on the worktree's branch, not the main branch
- The worktree allows you to work on this task without affecting the main codebase`;
    }

    // Add session naming instructions if MCP server is available
    if (ClaudeCodeProvider.sessionNamingServerPort !== null) {
      prompt += `

## Session Naming

You have access to a special tool called \`mcp__nimbalyst-session-naming__name_session\` that allows you to name this conversation session.

IMPORTANT: Call the \`mcp__nimbalyst-session-naming__name_session\` tool ONCE at the very start of this conversation, as soon as you understand the user's task or goal. The name should be:
- 2-5 words long
- Concise and descriptive
- Task-focused (e.g., "Fix authentication bug", "Add dark mode", "Refactor database layer")

Do NOT call this tool more than once per session. It should be called early, typically in your first response after understanding what the user wants to accomplish.`;
    }

    // Add voice mode context if this request originated from voice mode
    const isVoiceMode = (documentContext as any)?.isVoiceMode;
    if (isVoiceMode) {
      const customPrompt = (documentContext as any)?.voiceModeCodingAgentPrompt;

      if (customPrompt?.prepend) {
        prompt += `\n\n${customPrompt.prepend}`;
      }

      prompt += `

## Voice Mode

The user is interacting via voice mode. A voice assistant (GPT-4 Realtime) handles the conversation and relays requests to you.

- Messages prefixed with \`[VOICE]\` are questions from the voice assistant on behalf of the user
- For \`[VOICE]\` messages: respond with appropriate detail based on the question - the voice assistant will summarize for speech
- You may also receive coding tasks via voice mode - handle these normally`;

      if (customPrompt?.append) {
        prompt += `\n\n${customPrompt.append}`;
      }
    }

    return prompt;  // Returns this custom prompt, NOT the addendum
  }

  // For non-coding sessions, fall through to addendum
}
```

**Key Points:**
- NO document context (works across entire workspace)
- NO MockupLM instructions
- NO editing rules (Claude Code SDK handles that)
- Worktree warning is critical for isolation
- Session naming wording: "IMPORTANT: Call... ONCE at the very start" (different from addendum's "CRITICAL: MUST call... BEFORE ending first turn")

For **non-coding sessions** (document editing):
```typescript
// Use the standard addendum builder
const addendum = buildClaudeCodeSystemPromptAddendum(documentContext, hasSessionNaming);
return addendum;
```

**From `buildClaudeCodeSystemPromptAddendum()` (prompt.ts line 241-357):**

**IMPORTANT**: The addendum does NOT include the full document content. It only includes file path, cursor position, and selected text. The SDK handles file content via the Read tool.

```typescript
export function buildClaudeCodeSystemPromptAddendum(
  documentContext?: DocumentContext,
  hasSessionNaming?: boolean
): string {
  // Note the extra whitespace after <addendum> tag
  let base = `The following is an addendum to the above. Anything in the addendum supersedes the above.
  <addendum>

You are a customized version of Claude Code acting as an AI assistant integrated into Nimbalyst...`;

  // Session naming instructions if MCP server is available
  if (hasSessionNaming) {
    base += `
## Session Naming
You have access to \`mcp__nimbalyst-session-naming__name_session\`.

CRITICAL: You MUST call this tool BEFORE ending your first turn.
- 2-5 words long
- Task-focused (e.g., "Fix authentication bug")
Do NOT call more than once per session.`;
  }

  // MockupLM instructions for visual planning
  base += `
## MockupLM - Visual Planning
For planning/UI mockups, create a .mockup.html file with HTML/CSS.
User may draw annotations - use mcp__nimbalyst-mcp__capture_mockup_screenshot to see them.
Workflow: Create mockup → Spawn Task agent → Capture screenshot → Analyze → Fix → Repeat`;

  // Document context if open (WITHOUT full content)
  if (hasDocument) {
    base += `
═══════════════════════════════════════════════════════════
🎯 ACTIVE DOCUMENT:
═══════════════════════════════════════════════════════════
File path: ${documentContext?.filePath || 'untitled'}
${cursorPosition ? 'Cursor position: Line X, Column Y' : ''}
${selectedText ? 'USER-SELECTED TEXT: [text appears here]' : ''}

IMPORTANT: "this file", "here" = THIS file, not CLAUDE.md or other files.
═══════════════════════════════════════════════════════════

You can edit this markdown file using your native Edit and Write tools.

🚨 CRITICAL EDITING RULES:
1. ALWAYS use Read tool first before editing (required by Edit tool)
2. Use Edit tool to modify existing files (exact old_string/new_string)
3. Use Write tool to create new files
4. Changes appear as visual diffs for user review
5. Keep responses brief (2-4 words: "Editing document...")
6. DO NOT explain - user sees the changes as diffs
</addendum>`;
  }

  return base;
}
```

**Key Differences from Base Prompt:**
- NO full document content (SDK uses Read tool instead)
- NO fileType field
- NO mockup selection/drawing context
- Shorter, more concise instructions
- Focus on Claude Code's Edit/Write tools (not applyDiff/streamContent)

**Why the Two-Part System?**

1. **SDK Preset** provides Claude Code's native capabilities
2. **Addendum** customizes behavior for Nimbalyst-specific features
3. The `<addendum>` tag explicitly tells Claude to prioritize our instructions
4. This allows us to override SDK defaults while preserving core functionality

### CLAUDE.md Integration

**Important:** CLAUDE.md files are **NOT** directly embedded into system prompts by our providers.

**How CLAUDE.md is Used:**

1. **Claude Code SDK Integration:**
  - The SDK preset `'claude_code'` references CLAUDE.md files
  - SDK automatically loads and includes them in context
  - Files loaded: `~/.claude/CLAUDE.md` (user) and `<workspace>/CLAUDE.md` (project)

2. **File Management:**
  - `packages/electron/src/main/ipc/FileHandlers.ts` (lines 462-522): `memory:append` handler
  - `packages/electron/src/renderer/services/OnboardingService.ts`: Auto-creates CLAUDE.md
  - Files are edited by users and Claude Code separately
  - NOT loaded at runtime by Nimbalyst providers

3. **Settings Control:**
```typescript
   // From ClaudeCodeProvider.ts line 446-464
   let settingSources: string[] = ['local'];
   if (ccSettings.userCommandsEnabled) {
     settingSources.push('user');    // Enables ~/.claude/CLAUDE.md
   }
   if (ccSettings.projectCommandsEnabled) {
     settingSources.push('project'); // Enables <workspace>/CLAUDE.md
   }

   options.settingSources = settingSources;
```

### MCP Server Configuration

**Location:** `server/providers/ClaudeCodeProvider.ts`

Internal MCP servers are configured dynamically:

```typescript
private async getMcpServersConfig(sessionId?: string, workspacePath?: string) {
  const mcpServers: Record<string, any> = {};

  // Session naming server (if running)
  if (ClaudeCodeProvider.sessionNamingServerPort !== null) {
    mcpServers['nimbalyst-session-naming'] = {
      url: `http://127.0.0.1:${ClaudeCodeProvider.sessionNamingServerPort}/sse`,
      transport: 'sse'
    };
  }

  // Main Nimbalyst MCP server
  const mcpPort = ClaudeCodeProvider.mcpServerPort;
  if (mcpPort !== null) {
    mcpServers['nimbalyst-mcp'] = {
      url: `http://127.0.0.1:${mcpPort}/sse`,
      transport: 'sse'
    };
  }

  // Extension-provided MCP servers
  if (ClaudeCodeProvider.extensionMcpServersLoader) {
    const extensionServers = await ClaudeCodeProvider.extensionMcpServersLoader(workspacePath);
    Object.assign(mcpServers, extensionServers);
  }

  // User-configured MCP servers
  if (ClaudeCodeProvider.mcpConfigLoader) {
    const userServers = await ClaudeCodeProvider.mcpConfigLoader();
    Object.assign(mcpServers, userServers);
  }

  return mcpServers;
}
```

### Updating System Prompts

#### When to Update Base Prompts

**File:** `prompt.ts`

Update `buildSystemPrompt()` when:
- Adding new document editing capabilities
- Changing tool usage patterns for ALL providers
- Modifying selection/cursor behavior
- Adding new file types or modes

**Example - Adding a new file type:**
```typescript
const fileType = documentContext?.fileType || 'markdown';
const isNewType = fileType === 'custom-format';

// Add type-specific instructions
${isNewType ? `
🎨 CUSTOM FORMAT EDITING MODE
You are editing a custom format file (.custom).
...
` : ''}
```

#### When to Update Claude Code Addendum

**File:** `prompt.ts`

Update `buildClaudeCodeSystemPromptAddendum()` when:
- Adding Nimbalyst-specific features for Claude Code
- Changing document editing workflow for Claude Code
- Adding new MCP tool integrations
- Modifying MockupLM behavior

**Example - Adding a new MCP tool feature:**
```typescript
base += `

## New Feature Name

You have access to a new tool called \`mcp__nimbalyst-mcp__new_tool\`.

USAGE:
- When to use: [conditions]
- How to use: [instructions]
- Example: [example]
`;
```

#### When to Update Claude Code Provider Prompt

**File:** `server/providers/ClaudeCodeProvider.ts`

Update `buildSystemPrompt()` when:
- Changing agentic coding mode behavior
- Adding new session types
- Modifying worktree instructions
- Adding voice mode features

**Example - Adding a new session type:**
```typescript
protected buildSystemPrompt(documentContext?: DocumentContext): string {
  const sessionType = (documentContext as any)?.sessionType;

  if (sessionType === 'new-type') {
    return `You are working in new-type mode with special capabilities...`;
  }

  if (sessionType === 'coding') {
    // Existing coding mode logic
  }

  // Existing fallback
}
```

#### Testing System Prompt Changes

1. **Check All Providers:**
  - Test with Claude (direct API)
  - Test with Claude Code (MCP integration)
  - Test with OpenAI
  - Test with LM Studio (if available)

2. **Test Different Contexts:**
  - No document open
  - Markdown document open
  - Code file open
  - Mockup file open
  - With text selected
  - With cursor position
  - In worktree session

3. **Verify Tool Behavior:**
  - Edit tools work correctly
  - Selection context is understood
  - File-specific instructions apply
  - Permission system works

4. **Check Mode Transitions:**
  - Chat mode → Agentic coding mode
  - Planning mode restrictions
  - Voice mode integration

### Common Pitfalls

1. **Don't Include Sensitive Data:**
  - Never log system prompts to PostHog
  - Be careful with debug logging
  - Sanitize file paths in examples

2. **Maintain Provider Parity:**
  - Base providers should have similar capabilities
  - Claude Code addendum should only add features, not break base behavior
  - Test cross-provider consistency

3. **Respect Token Limits:**
  - System prompts count against context window
  - Keep instructions concise
  - Use clear, direct language

4. **Handle Missing Context:**
  - Always check for optional fields
  - Provide sensible defaults
  - Don't assume document is always open

5. **Update Both Locations:**
  - If changing document editing, update both `buildSystemPrompt()` and `buildClaudeCodeSystemPromptAddendum()`
  - Keep agentic coding and chat modes in sync where appropriate
  - Document mode-specific differences

### Related Documentation

- **AI Provider Types:** `/docs/AI_PROVIDER_TYPES.md` - Agent vs. Chat provider architecture
- **Custom Tool Widgets:** `/docs/CUSTOM_TOOL_WIDGETS.md` - Custom MCP tool UI
- **Internal MCP Servers:** `/docs/INTERNAL_MCP_SERVERS.md` - How to implement MCP servers
- **Worktrees:** `/docs/WORKTREES.md` - Git worktree integration
- **Agent Permissions:** `/docs/AGENT_PERMISSIONS.md` - Permission system for tools
