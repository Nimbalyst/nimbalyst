---
planStatus:
  planId: plan-test-suite-optimization
  title: Test Suite Optimization - Clean Test Run
  status: in-development
  planType: refactor
  priority: high
  owner: ghinkle
  stakeholders:
    - ghinkle
  tags:
    - testing
    - quality
    - ci-cd
    - performance
  created: "2025-10-03"
  updated: "2025-10-04T01:24:43.793Z"
  progress: 80
  startDate: "2025-10-03"
---
# Test Suite Optimization - Clean Test Run 
<!-- plan-status -->


## Goals

1. Fix all failing unit tests (6 failures currently)
2. Optimize e2e test suite for faster execution and reliability
3. Reduce AI test timeouts and improve test efficiency
4. Achieve 100% passing test suite for CI/CD confidence

## Current Test Status

### Build
- Status: PASSING
- Build time: ~22s
- No issues

### Unit Tests (Vitest)
- Total: 62 tests
- Passing: 56 tests
- Failing: 6 tests
- Test files: 6 total (4 failed, 2 passed)

#### Failed Tests

**ElectronFileSystemService.test.ts** (2 failures)
- `readFile > should reject absolute paths` - Error message mismatch
  - Expected: "Path must be relative to workspace"
  - Actual: "Path contains dangerous patterns"
- `readFile > should prevent path traversal` - Error message mismatch
  - Expected: "Path must be within workspace"
  - Actual: "Path contains dangerous patterns"

**SafePathValidator.test.ts** (3 failures)
- `Path Traversal Prevention > should block absolute paths` - Validation not blocking correctly
- `Path Traversal Prevention > should block command injection attempts` - Validation not blocking correctly
- `File Extension Blocking > should block environment files` - Validation not blocking correctly

### E2E Tests (Playwright)
- Total: 53 tests
- Status: TIMED OUT after 5 minutes
- Running serially (1 worker)
- Multiple AI-related test failures due to timeouts

#### AI Test Issues
1. **Timeout-based waiting** - Tests use `page.waitForTimeout(500)` extensively
2. **AI response delays** - Real API calls taking 20-30s each
3. **Sequential execution** - Tests run one at a time
4. **Redundant test cases** - Multiple similar list editing tests
5. **No API key validation** - Tests start without checking credentials

## Implementation Plan

### Phase 1: Unit Test Fixes (High Priority)

#### 1.1 Fix SafePathValidator Error Messages
**Files:**
- `packages/electron/src/main/security/SafePathValidator.ts`
- `packages/electron/src/main/services/__tests__/ElectronFileSystemService.test.ts`

**Changes:**
- Update SafePathValidator to return specific error messages for different violation types
- Or update test expectations to match actual error messages
- Ensure consistency between validator and file system service

#### 1.2 Fix SafePathValidator Logic
**Files:**
- `packages/electron/src/main/security/SafePathValidator.ts`
- `packages/electron/src/main/security/__tests__/SafePathValidator.test.ts`

**Changes:**
- Fix absolute path validation (should block `/etc/passwd`, etc.)
- Fix command injection detection (should block paths with semicolons, pipes, etc.)
- Fix environment file blocking (should block `.env`, `.env.local`, etc.)
- Review validation rules against test expectations

### Phase 2: E2E Test Optimization

#### 2.1 AI Test Consolidation
**Current Issues:**
- 5 separate list editing tests (add end, add position, remove, edit, add multiple)
- Each test creates new workspace, launches app, waits for AI response
- Total time: 5+ minutes just for list editing

**Optimization:**
- Combine related list editing operations into single test
- Reuse workspace and app instance across test cases
- Expected savings: 3-4 minutes

**Files to modify:**
- `packages/electron/e2e/ai/ai-list-editing.spec.ts`

**New structure:**
```typescript
test('AI list editing operations', async () => {
  // Single workspace, single app launch
  // Test multiple operations in sequence:
  // 1. Add item to end
  // 2. Add item at position
  // 3. Edit existing item
  // 4. Remove item
  // All in one test session
});
```

#### 2.2 Replace Timeout-Based Waiting
**Current approach:**
```typescript
await page.waitForTimeout(500);  // Arbitrary delay
```

**Better approach:**
```typescript
// Wait for specific events/conditions
await page.waitForSelector('[data-testid="ai-response-complete"]');
await page.waitForFunction(() => window.aiProcessing === false);
```

**Files to update:**
- `packages/electron/e2e/helpers.ts` - Update `sendAIPrompt` helper
- All AI test files

**Implementation:**
- Add data attributes to AI chat component for test hooks
- Expose AI processing state via window object in test mode
- Replace all `waitForTimeout` with condition-based waits

#### 2.3 AI Test Prerequisites Check
**Add test setup validation:**
```typescript
test.beforeAll(async () => {
  // Check for required API keys
  if (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    test.skip('No AI API keys configured');
  }
});
```

**Files:**
- `packages/electron/e2e/ai/ai-list-editing.spec.ts`
- `packages/electron/e2e/ai/ai-multi-tab-editing.spec.ts`

#### 2.4 Parallel Test Execution
**Current:**
- 1 worker (serial execution)
- Total time: 5+ minutes (incomplete)

**Optimization:**
- Use 2-3 workers for non-AI tests
- Keep AI tests serial (API rate limits)
- Group tests by type (AI vs non-AI)

**Configuration:**
```typescript
// playwright.config.ts
workers: process.env.CI ? 1 : 2,
```

#### 2.5 Mock AI Provider for Fast Tests
**Create mock provider for non-integration tests:**
- Mock responses for predictable edits
- Instant response (no API delay)
- Use for smoke tests and UI validation

**Files to create:**
- `packages/electron/e2e/fixtures/mockAIProvider.ts`

**Implementation:**
```typescript
class MockAIProvider {
  async streamResponse(prompt: string): AsyncIterable<string> {
    // Return predefined responses based on prompt patterns
    // No actual API calls
  }
}
```

### Phase 3: Test Infrastructure Improvements

#### 3.1 Test Categorization
**Add test tags:**
```typescript
test('basic feature @smoke', async () => { ... });
test('AI integration @ai @slow', async () => { ... });
test('file system @unit', async () => { ... });
```

**Run strategies:**
- Pre-commit: `@smoke` tests only (fast)
- Pre-push: `@smoke` + `@unit` tests
- CI: All tests including `@slow` and `@ai`

#### 3.2 Flaky Test Detection
**Add retry logic for known-flaky tests:**
```typescript
test.describe('AI tests', () => {
  test.describe.configure({ retries: 2 });
  // AI tests here
});
```

#### 3.3 Test Reporting
**Improve failure reporting:**
- Capture full AI request/response on failure
- Save editor state on failure
- Include timing metrics

**Files:**
- `packages/electron/playwright.config.ts` - Update reporter config
- `packages/electron/e2e/helpers.ts` - Add debug helpers

## Expected Outcomes

### Unit Tests
- **Before:** 56/62 passing (90.3%)
- **After:** 62/62 passing (100%)
- **Time:** ~2s (no change)

### E2E Tests
- **Before:** Timeout after 5 minutes (incomplete)
- **After:** Complete in 2-3 minutes with passing tests
- **Savings:** 50-60% time reduction

### Test Reliability
- Eliminate timeout-based waiting
- Add proper test prerequisites
- Reduce flakiness from 20%+ to <5%

### CI/CD Impact
- Faster feedback loops
- Confidence in test results
- Reduced CI minutes consumption

## Implementation Order

1. **Week 1: Unit Test Fixes**
  - Day 1: Fix SafePathValidator error messages
  - Day 2: Fix SafePathValidator logic
  - Day 3: Verify all unit tests passing

2. **Week 2: E2E Core Optimizations**
  - Day 1: Replace timeout-based waiting with event-driven
  - Day 2: Add AI test prerequisites check
  - Day 3: Consolidate AI list editing tests

3. **Week 3: E2E Advanced Optimizations**
  - Day 1: Implement mock AI provider
  - Day 2: Add test categorization and tagging
  - Day 3: Configure parallel execution

4. **Week 4: Infrastructure & Validation**
  - Day 1: Improve test reporting
  - Day 2: Add flaky test detection
  - Day 3: Full test suite validation

## Success Criteria

- [ ] All 62 unit tests passing
- [ ] All 53 e2e tests passing (or properly skipped when prerequisites missing)
- [ ] E2E suite completes in under 3 minutes on local machine
- [ ] E2E suite completes in under 5 minutes in CI
- [ ] Zero timeout-based waits in critical paths
- [ ] Test flakiness rate below 5%
- [ ] Clear test categorization (@smoke, @ai, @unit, etc.)

## Risks & Mitigation

**Risk:** AI API rate limits
- **Mitigation:** Use mock provider for non-integration tests, add rate limit backoff

**Risk:** Event-driven waits may miss edge cases
- **Mitigation:** Add timeout fallbacks with clear error messages

**Risk:** Parallel execution may cause resource conflicts
- **Mitigation:** Isolate workspaces, limit worker count

**Risk:** Mock AI provider may not match real behavior
- **Mitigation:** Keep integration tests with real provider, use mocks only for UI/smoke tests

## Notes

- Consider adding test fixtures for common scenarios (workspace with files, pre-configured AI)
- May want to extract common test utilities to reduce duplication
- Should document test writing best practices for contributors
- Consider adding performance benchmarks for critical paths
