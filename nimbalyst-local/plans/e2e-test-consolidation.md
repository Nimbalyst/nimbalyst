---
planStatus:
  planId: plan-e2e-test-consolidation
  title: E2E Test Consolidation for Performance
  status: in-review
  planType: refactor
  priority: high
  owner: ghinkle
  stakeholders: []
  tags:
    - testing
    - performance
    - playwright
    - e2e
  created: "2026-01-19"
  updated: "2026-01-19T22:10:00.000Z"
  progress: 100
  startDate: "2026-01-19"
---
# E2E Test Consolidation for Performance

## Implementation Progress

- [x] Phase 1: Create consolidated markdown.spec.ts from 5 separate files
- [x] Phase 1: Verify consolidated tests pass (3 pass, 2 skipped due to pre-existing issues)
- [x] Phase 1: Delete old separate markdown test files
- [x] Update docs/PLAYWRIGHT.md with consolidation guidelines
- [x] Phase 2: Consolidate editor types (csv, datamodellm, excalidraw, markdown, mockup, monaco)
- [x] Phase 3: Consolidate feature areas (files, history, tracker, theme, tabs, plugins, permissions)
- [x] Phase 4: Session management consolidation - 7 files -> 1 file (6 launches saved)

## Problem Statement

The E2E test suite currently takes 40+ minutes to run and frequently causes app crashes. The root cause is **excessive app launches** - each of the ~95 spec files launches a fresh Electron instance for every test via `beforeEach`, resulting in:

- **\~316 individual tests** each launching and tearing down the app
- **\~4-5 seconds overhead per launch** (creating temp workspace, launching Electron, waiting for ready state, cleanup)
- **15-25 minutes of pure overhead** before any actual test logic runs
- **Serial execution required** due to PGLite database single-process limitation

Recent test run results:
- 27 tests ran before crash
- All 27 failed with 30-second timeouts (not even reaching test logic)
- Total runtime before crash: ~28 minutes

## Solution: Test Consolidation with App Sharing

Consolidate related tests to share a single app instance using `beforeAll`/`afterAll` instead of `beforeEach`/`afterEach`.

### Key Principles

1. **One app launch per spec file** - Use `beforeAll` to launch, `afterAll` to close
2. **Pre-create all test files** - Create all files needed by any test in the spec upfront
3. **Sequential scenario execution** - Run related scenarios in one `test()` block OR use separate test files for state reset
4. **No parallel execution** - Still single-worker due to PGLite limitation

### Pattern: Consolidated Test Structure

```typescript
// editors/markdown.spec.ts - CONSOLIDATED
let electronApp: ElectronApplication;
let page: Page;
let workspaceDir: string;

test.beforeAll(async () => {
  workspaceDir = await createTempWorkspace();

  // Create ALL test files upfront for all scenarios
  await fs.writeFile(path.join(workspaceDir, 'autosave-test.md'), '# Autosave Test\n\nOriginal content.\n');
  await fs.writeFile(path.join(workspaceDir, 'dirty-close-test.md'), '# Dirty Close Test\n\nOriginal content.\n');
  await fs.writeFile(path.join(workspaceDir, 'external-change-test.md'), '# External Change Test\n\nOriginal content.\n');
  await fs.writeFile(path.join(workspaceDir, 'diff-accept-test.md'), '# Diff Accept Test\n\nOriginal content.\n');
  await fs.writeFile(path.join(workspaceDir, 'diff-reject-test.md'), '# Diff Reject Test\n\nOriginal content.\n');

  electronApp = await launchElectronApp({ workspace: workspaceDir });
  page = await electronApp.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await waitForAppReady(page);
  await dismissProjectTrustToast(page);
});

test.afterAll(async () => {
  await electronApp?.close();
  await fs.rm(workspaceDir, { recursive: true, force: true });
});

test('markdown editor autosave', async () => {
  await openFileFromTree(page, 'autosave-test.md');
  // ... autosave test logic ...
});

test('markdown editor dirty close warning', async () => {
  await openFileFromTree(page, 'dirty-close-test.md');
  // ... dirty close test logic ...
});

test('markdown editor external file change', async () => {
  await openFileFromTree(page, 'external-change-test.md');
  // ... external change test logic ...
});

test('markdown editor diff accept', async () => {
  await openFileFromTree(page, 'diff-accept-test.md');
  // ... diff accept test logic ...
});

test('markdown editor diff reject', async () => {
  await openFileFromTree(page, 'diff-reject-test.md');
  // ... diff reject test logic ...
});
```

### When Tests Can Share an App Instance

Tests can share an app if:
- They operate on **different files** (most common)
- They don't require a **clean database state**
- They don't require **app restart behavior**

Tests that CANNOT share an app:
- Tests for app startup behavior
- Tests for session restore across app restarts
- Tests that corrupt or reset app state intentionally

## Implementation Phases

### Phase 1: Pilot Consolidation (Markdown Editor)

**Target:** `packages/electron/e2e/editors/markdown/` (5 files -> 1 file)

Current files:
- `autosave.spec.ts`
- `diff-accept.spec.ts`
- `diff-reject.spec.ts`
- `dirty-close.spec.ts`
- `external-change.spec.ts`

Consolidated to:
- `markdown.spec.ts` (1 file, 5 tests, 1 app launch)

**Expected savings:** 4 app launches (~16-20 seconds)

**Validation criteria:**
1. All tests pass
2. Tests run in < 30 seconds total
3. No flakiness introduced
4. Test failures still produce useful diagnostics

### Phase 2: Editor Type Consolidation

Apply the same pattern to all editor types:

| Editor Type | Current Files | After Consolidation |
| --- | --- | --- |
| CSV | 8 | 1 |
| DataModelLM | 4 | 1 |
| Excalidraw | 6 | 1 |
| Markdown | 5 | 1 |
| Mockup | 2 | 1 |
| Monaco | 5 | 1 |
| **Total** | **30** | **6** |

**Expected savings:** 24 app launches (~96-120 seconds)

### Phase 3: Feature Area Consolidation

| Feature Area | Current Files | After Consolidation | Notes |
| --- | --- | --- | --- |
| permissions/ | 6 | 1-2 | May need separate for permission mode testing |
| files/ | 4 | 1 |  |
| tabs/ | 4 | 1 |  |
| core/ | 6 | 2-3 | Some test app startup specifically |
| history/ | 3 | 1 |  |
| settings/ | 2 | 1 |  |

**Expected savings:** ~15-18 app launches (~60-72 seconds)

### Phase 4: AI Test Consolidation ✅ COMPLETE

The `e2e/ai/` folder was the largest (28 files) and is now fully consolidated to 6 files.

**All consolidations complete - 28 files → 6 files:**

1. **ai-smoke.spec.ts** (1 test) - ONLY test that makes real AI calls (skipped if no API key)

2. **ai-features.spec.ts** (3 tests) - Consolidated from:
   - claude-code-basic.spec.ts
   - context-usage-display.spec.ts
   - slash-command-error.spec.ts
   - model-switching.spec.ts (deleted - entirely skipped)

3. **ai-input-attachments.spec.ts** (~10 tests) - Consolidated from:
   - ai-image-attachment.spec.ts
   - file-mention-all-types.spec.ts
   - image-attachment-persistence.spec.ts

4. **diff-behavior.spec.ts** (~18 tests) - Consolidated from:
   - ai-tool-simulator.spec.ts
   - ai-turn-end-snapshots.spec.ts
   - consecutive-edits-diff-update.spec.ts
   - diff-edge-case-cleanup.spec.ts
   - diff-group-approval.spec.ts
   - incremental-baseline-tracking.spec.ts
   - incremental-diff-cleanup.spec.ts
   - reject-then-accept-all.spec.ts

5. **diff-reliability.spec.ts** (~18 tests) - Already consolidated

6. **session-management.spec.ts** (16 tests) - Consolidated from:
   - agent-mode-comprehensive.spec.ts
   - concurrent-sessions.spec.ts
   - session-state-cross-mode.spec.ts
   - session-status-indicators.spec.ts
   - session-workstreams.spec.ts
   - child-session-persistence.spec.ts
   - worktree-session-persistence.spec.ts

**Key achievement: ALL AI tests (except smoke test) now use synthetic simulation - NO real AI calls**

**Savings:** ~22 app launches (~88-110 seconds)

## Total Expected Impact

| Phase | Current | After | Launches Saved | Time Saved | Status |
| --- | --- | --- | --- | --- | --- |
| Phase 1 | 5 | 1 | 4 | ~16-20s | ✅ DONE |
| Phase 2 | 30 | 6 | 24 | ~96-120s | ✅ DONE |
| Phase 3 | 25 | 8 | 17 | ~68-85s | ✅ DONE |
| Phase 4 | 28 | 6 | 22 | ~88-110s | ✅ DONE |
| **Total (completed)** | **88** | **21** | **67** | **\~4.5-5.6 min** | - |

Combined with actual test execution time reduction (less setup/teardown overhead), total suite time should drop from 40+ minutes to ~10-15 minutes.

## Documentation Updates

Update `docs/PLAYWRIGHT.md` with:

1. **New section: Test Consolidation Guidelines**
  - When to use `beforeAll` vs `beforeEach`
  - Pattern for pre-creating test files
  - Guidelines for tests that can/cannot share app instances

2. **Update Best Practices section**
  - Add guidance on consolidating related tests
  - Add warning against over-splitting tests

3. **Add new utility functions**
  - Helper to create multiple test files at once
  - Consider adding test file reset utilities

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Test isolation loss | Tests may affect each other | Use separate files per test scenario |
| Harder debugging | Can't run single test in isolation | Keep test logic modular, use `test.only` on specific test |
| State leakage | App state persists between tests | Close tabs between tests, use IPC to reset state |
| Longer failure recovery | If app crashes mid-file, lose all tests | Keep consolidated files reasonable size (5-10 tests) |

## Rollback Plan

If consolidation causes issues:
1. Original files are preserved in git history
2. Can split back into separate files
3. No changes to test logic itself, only structure

## Success Criteria

1. Full test suite completes in < 15 minutes (down from 40+)
2. No increase in test flakiness
3. All existing tests still pass
4. Documentation updated with new patterns
5. Clear guidelines for writing new tests
