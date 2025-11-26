---
planStatus:
  planId: plan-ai-e2e-test-infrastructure
  title: AI E2E Test Infrastructure Modernization
  status: in-development
  planType: refactor
  priority: high
  owner: ghinkle
  stakeholders:
    - ghinkle
  tags:
    - testing
    - e2e
    - playwright
    - ai-features
    - agent-mode
  created: "2025-10-30"
  updated: "2025-10-30T18:28:13.558Z"
  progress: 40
---
# AI E2E Test Infrastructure Modernization

## Goals

- Modernize AI E2E tests to work with new Agent mode (no longer separate window)
- Create reusable test infrastructure to reduce code duplication
- Consolidate micro-tests into comprehensive workflow tests
- Establish clear testing patterns for future AI feature tests

## Problem

The AI E2E tests were written for the old "Agentic Coding Window" model where agent features opened in a separate window. This has been replaced with Agent mode accessible via the left nav gutter in the main window. Additionally, tests had too much granularity with separate test cases for each tiny step rather than testing complete workflows.

**Broken Test Count**: 22+ tests need updates (out of 24 total)

## Solution Approach

### 1. Shared Test Utilities (✅ Completed)

Created `e2e/utils/aiTestHelpers.ts` with:
- Mode switching helpers (`switchToAgentMode`, `switchToEditorMode`, `switchToFilesMode`)
- Document management (`openNewDocument`, `openDocuments`, `switchToDocumentTab`)
- AI interaction (`submitChatPrompt`, `createNewAgentSession`, `switchToSessionTab`)
- Verification helpers (`waitForToolCalls`, `waitForMessages`, `verifyDocumentEdited`)
- Complete workflow helper (`runAgenticWorkflow`)
- Centralized selectors (`AI_SELECTORS` object)

### 2. Test Consolidation (🔄 In Progress)

**Completed:**
- `agentic-coding-window.spec.ts` - Reduced from 5 granular tests to 1 comprehensive workflow test ✅
- `agentic-coding-streaming.spec.ts` - Reduced from 10+ tests to 1 focused test ✅
- Both tests passing (2/2 = 100%)

**High Priority Remaining:**
- `slash-command-simple.spec.ts` - Uses old window model
- `slash-command-typeahead.spec.ts` - Uses old window model
- `chat-panel-streaming.spec.ts` - Needs selector updates

**Medium Priority:**
- `ai-file-mention-*.spec.ts` (4 files) - Likely need selector updates
- `ai-multi-tab-editing.spec.ts` - May need selector updates

**Low Priority:**
- Remaining 15 tests - Need verification and potential minor updates

### 3. Test Inventory (✅ Completed)

Created `e2e/ai/TEST_INVENTORY.md` cataloging:
- All 24 AI test files
- Current status of each
- Priority for fixes
- Dependencies on old window model

## Key Changes

### Before
```typescript
// 5 separate tests for individual steps
test('should switch to agent mode', ...)
test('should create session', ...)
test('should type in input', ...)
test('should submit message', ...)
test('should clear input', ...)
```

### After
```typescript
// 1 comprehensive workflow test
test('complete agent workflow: switch mode, submit message, verify session created', async () => {
  await openNewDocument(page, workspacePath, 'plan.md', '');
  await switchToAgentMode(page);
  await submitChatPrompt(page, 'Test message');
  // Verify complete workflow succeeded
});
```

## Files Modified

- ✅ `e2e/utils/aiTestHelpers.ts` - New shared utilities (358 lines)
- ✅ `e2e/ai/TEST_INVENTORY.md` - Test status catalog
- ✅ `e2e/ai/agentic-coding-window.spec.ts` - Simplified to 1 test
- ✅ `e2e/ai/agentic-coding-streaming.spec.ts` - Simplified to 1 test

## Testing Strategy

### Test Granularity Guidelines

**DO**: Test complete user workflows
- User opens document → switches to agent mode → sends message → verifies response

**DON'T**: Test individual UI interactions
- Separate tests for "switches to agent mode", "types in input", "clicks send button"

### Helper Function Patterns

All helpers should:
- Use centralized `AI_SELECTORS` for consistency
- Include reasonable timeouts for UI rendering
- Use `.fill()` instead of `.type()` for React inputs
- Return meaningful values or throw clear errors

## Remaining Work

### Phase 1: High Priority Tests (3 tests)
Convert slash command tests and chat panel streaming to new infrastructure

### Phase 2: Medium Priority Tests (7 tests)
Update file mention and multi-tab editing tests with new selectors

### Phase 3: Low Priority Tests (15 tests)
Verify and update remaining tests as needed

### Phase 4: Validation
Run complete AI test suite and address any remaining failures

## Success Criteria

- ✅ Shared test utilities created and documented
- ✅ Test inventory completed
- 🔄 At least 2 high-priority tests passing with new infrastructure (2/2 completed)
- ⏳ All high-priority tests (5 total) passing
- ⏳ >80% of all AI tests passing
- ⏳ Test execution time reduced by >30% through better test organization

## Notes

- Old AgenticCodingWindow component still exists but is unused
- Agent mode accessed via `[data-mode="agent"]` selector in left nav
- Multi-session functionality tested in `multi-panel-streaming.spec.ts`
- Some UI elements (mode switcher buttons) may not be visible/clickable in certain modes
