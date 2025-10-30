# AI E2E Test Inventory

## Tests Using Old AgenticCodingWindow (NEEDS FIX)
These tests try to open a separate "Agentic Coding Window" which no longer exists. They need to be rewritten to use Agent mode instead.

1. **agentic-coding-window.spec.ts** - Tests for opening agentic coding window
   - Status: BROKEN - Uses `Meta+Alt+A` to open separate window
   - Fix: Switch to agent mode using `[data-mode="agent"]`

2. **agentic-coding-streaming.spec.ts** - Tests streaming transcript in agentic window
   - Status: BROKEN - Opens separate window via IPC
   - Fix: Use agent mode and check streaming in active session

3. **slash-command-simple.spec.ts** - Tests slash commands
   - Status: BROKEN - Opens agentic window
   - Fix: Use agent mode for slash command testing

4. **slash-command-typeahead.spec.ts** - Tests slash command typeahead
   - Status: BROKEN - Opens agentic window
   - Fix: Use agent mode for typeahead testing

## Tests That May Work (NEEDS VERIFICATION)

5. **multi-panel-streaming.spec.ts** - Tests parallel streaming to multiple sessions
   - Status: WORKING - Uses correct agent mode patterns
   - Note: This is our reference implementation

6. **chat-panel-streaming.spec.ts** - Tests streaming in chat panel
   - Status: NEEDS REVIEW - May simulate events incorrectly
   - Fix: Verify it uses correct selectors and mode switching

## Tests Needing Specific Updates

7. **ai-file-mention-*.spec.ts** (4 files)
   - Tests for file mention typeahead feature
   - May need selector updates

8. **ai-multi-tab-editing.spec.ts**
   - Tests editing multiple tabs
   - May need selector updates

9. **diff-*.spec.ts** (3 files)
   - Tests diff/replacement functionality
   - May need selector updates

10. **mcp-*.spec.ts** (2 files)
    - Tests MCP protocol integration
    - May need selector updates

11. **claude-code-*.spec.ts** (3 files)
    - Tests Claude Code SDK integration
    - May need updates

## Other Tests

12. **ai-image-attachment.spec.ts**
13. **ai-list-editing.spec.ts**
14. **ai-session-file-tracking.spec.ts**
15. **ai-table-diff-failure.spec.ts**
16. **ai-tool-simulator.spec.ts**
17. **model-switching.spec.ts**

## Fix Priority

### High Priority (Completely Broken)
1. agentic-coding-window.spec.ts
2. agentic-coding-streaming.spec.ts
3. slash-command-simple.spec.ts
4. slash-command-typeahead.spec.ts

### Medium Priority (Likely Broken)
5. chat-panel-streaming.spec.ts
6. ai-file-mention-*.spec.ts
7. ai-multi-tab-editing.spec.ts

### Low Priority (May Just Need Minor Updates)
8. All other tests - verify selectors and patterns
