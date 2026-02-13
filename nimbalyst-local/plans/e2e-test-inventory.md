---
planStatus:
  planId: plan-e2e-test-inventory
  title: E2E Test Consolidation Inventory
  status: in-development
  planType: refactor
  priority: high
  owner: ghinkle
  stakeholders: []
  tags:
    - testing
    - performance
    - playwright
    - e2e
  created: "2026-02-05"
  updated: "2026-02-05T17:59:00.000Z"
  progress: 20
  startDate: "2026-02-05"
---
# E2E Test Consolidation Inventory

This document tracks the status of consolidating E2E tests following the patterns in `docs/PLAYWRIGHT.md` and the plan in `nimbalyst-local/plans/e2e-test-consolidation.md`.

## Summary

| Category | Files | Tests | Consolidated | Remaining |
| --- | --- | --- | --- | --- |
| ai/ | 28 -> 6 | ~90 | 22 | 0 |
| core/ | 7 | 11 | 1 | 6 |
| editor/ | 4 -> 1 | 7 | 6 | 0 |
| editors/ | 9 -> 7 | 49 | 7 | 2 |
| extensions/ | 1 | 1 | 0 | 1 |
| files/ | 4 -> 1 | 15 | 13 | 0 |
| history/ | 3 -> 1 | 6 | 6 | 0 |
| images/ | 1 | 1 | 0 | 1 |
| interactive-prompts/ | 1 | 1 | 0 | 1 |
| markdown/ | 1 | 1 | 0 | 1 |
| offscreen-editor/ | 1 | 1 | 0 | 1 |
| onboarding/ | 1 | 1 | 0 | 1 |
| permissions/ | 7 | 44 | 1 | 6 |
| plugins/ | 1 | 2 | 1 | 0 |
| settings/ | 0 | 0 | 0 | 0 |
| smoke/ | 1 | 1 | 0 | 1 |
| tabs.spec.ts | 1 | 8 | 1 | 0 |
| terminal/ | 1 | 1 | 0 | 1 |
| theme/ | 5 -> 1 | 10 | 5 | 0 |
| tracker/ | 4 -> 1 | 6 | 4 | 0 |
| update/ | 1 | 1 | 0 | 1 |
| walkthroughs/ | 1 | 1 | 0 | 1 |
| worktree/ | 1 | 1 | 0 | 1 |
| **TOTAL** | **83 -> 61** | **\~282** | **37** | **46** |

## Legend

- **Status**: `done` | `in-progress` | `pending` | `skip` (cannot consolidate)
- **Pattern**: `beforeAll` (consolidated) | `beforeEach` (needs consolidation) | `none` (minimal setup)
- **Tests**: Number of test blocks in the file

---

## e2e/ai/ (28 files -> 6 files, ~90 tests) ✅ COMPLETE

**Status: All AI tests consolidated and optimized - NO real AI calls except smoke test**

| File | Tests | Pattern | Status | Notes |
| --- | --- | --- | --- | --- |
| ai-smoke.spec.ts | 1 | beforeAll | done | ONLY test that makes real AI calls (skipped if no API key) |
| ai-features.spec.ts | 3 | beforeAll | done | Session creation, context display, mode switching - NO real AI |
| ai-input-attachments.spec.ts | ~10 | beforeAll | done | Image attachments, @mentions, file uploads - NO real AI |
| diff-behavior.spec.ts | ~18 | beforeAll | done | Tab targeting, consecutive edits, cleanup, approval - NO real AI |
| diff-reliability.spec.ts | ~18 | beforeAll | done | Edge cases, nested lists, tables, streaming - NO real AI |
| session-management.spec.ts | 16 | beforeAll | done | Consolidated from 7 files, all 16 tests pass (~1.7m) - NO real AI |

### Previously Consolidated (now merged into above 6 files):
- ~~agent-mode-comprehensive.spec.ts~~ → session-management.spec.ts
- ~~concurrent-sessions.spec.ts~~ → session-management.spec.ts
- ~~session-state-cross-mode.spec.ts~~ → session-management.spec.ts
- ~~session-status-indicators.spec.ts~~ → session-management.spec.ts
- ~~session-workstreams.spec.ts~~ → session-management.spec.ts
- ~~child-session-persistence.spec.ts~~ → session-management.spec.ts
- ~~worktree-session-persistence.spec.ts~~ → session-management.spec.ts
- ~~ai-image-attachment.spec.ts~~ → ai-input-attachments.spec.ts
- ~~file-mention-all-types.spec.ts~~ → ai-input-attachments.spec.ts
- ~~image-attachment-persistence.spec.ts~~ → ai-input-attachments.spec.ts
- ~~ai-tool-simulator.spec.ts~~ → diff-behavior.spec.ts
- ~~ai-turn-end-snapshots.spec.ts~~ → diff-behavior.spec.ts
- ~~consecutive-edits-diff-update.spec.ts~~ → diff-behavior.spec.ts
- ~~diff-edge-case-cleanup.spec.ts~~ → diff-behavior.spec.ts
- ~~diff-group-approval.spec.ts~~ → diff-behavior.spec.ts
- ~~incremental-baseline-tracking.spec.ts~~ → diff-behavior.spec.ts
- ~~incremental-diff-cleanup.spec.ts~~ → diff-behavior.spec.ts
- ~~reject-then-accept-all.spec.ts~~ → diff-behavior.spec.ts
- ~~claude-code-basic.spec.ts~~ → ai-features.spec.ts
- ~~context-usage-display.spec.ts~~ → ai-features.spec.ts
- ~~model-switching.spec.ts~~ → ai-features.spec.ts (deleted - entirely skipped)
- ~~slash-command-error.spec.ts~~ → ai-features.spec.ts

**Consolidation complete: 28 files → 6 files (~22 app launches saved)**

---

## e2e/core/ (7 files, 11 tests)

| File | Tests | Pattern | Status | Notes |
| --- | --- | --- | --- | --- |
| agent-mode-menu.spec.ts | 1 | beforeEach | pending | Single test |
| app-startup.spec.ts | 1 | beforeEach | skip | Tests startup behavior, needs fresh app |
| bottom-panel-mode-switching.spec.ts | 1 | beforeEach | pending | Single test |
| context-aware-new.spec.ts | 2 | beforeAll | done | Fixed: uses beforeAll, tests pass |
| single-file-mode.spec.ts | 1 | beforeEach | skip | Tests specific launch mode |
| window-restore-order.spec.ts | 1 | beforeEach | skip | Tests restore behavior, needs fresh app |
| workspace-agent-state-persistence.spec.ts | 1 | beforeEach | skip | Tests persistence across restart |

### Core Consolidation Candidates

Limited - most test app startup or specific launch modes that require fresh apps.

---

## e2e/editor/ (4 files -> 1 consolidated, 7 tests)

| File | Tests | Pattern | Status | Notes |
| --- | --- | --- | --- | --- |
| editor.spec.ts | 7 | beforeAll | done | Consolidated from 4 files, 6 pass + 1 skipped (~29s) |
| ~~document-initial-scroll.spec.ts~~ | - | - | replaced | Merged into editor.spec.ts |
| ~~no-rerender-on-ai-input.spec.ts~~ | - | - | replaced | Merged into editor.spec.ts |
| ~~no-rerender-on-save.spec.ts~~ | - | - | replaced | Merged into editor.spec.ts |
| ~~unified-header-breadcrumb.spec.ts~~ | - | - | replaced | Merged into editor.spec.ts |

**Savings**: 3 app launches

---

## e2e/editors/ (9 files, 49 tests)

| File | Tests | Pattern | Status | Notes |
| --- | --- | --- | --- | --- |
| csv.spec.ts | 13 | beforeAll | done | Consolidated |
| datamodellm.spec.ts | 5 | beforeAll | done | Consolidated |
| datamodellm/basic.spec.ts | 2 | beforeEach | pending | Should merge into datamodellm.spec.ts |
| excalidraw.spec.ts | 8 | beforeAll | done | Consolidated |
| markdown.spec.ts | 7 | beforeAll | done | Consolidated |
| mockup/mockup.spec.ts | 2 | beforeAll | done | Consolidated from 2 files, both tests pass (~15s) |
| ~~mockup/diff-accept.spec.ts~~ | - | - | replaced | Merged into mockup/mockup.spec.ts |
| ~~mockup/diff-reject.spec.ts~~ | - | - | replaced | Merged into mockup/mockup.spec.ts |
| monaco.spec.ts | 8 | beforeAll | done | Consolidated |

### Editors Consolidation Candidates

1. ~~`mockup/diff-accept.spec.ts` + `mockup/diff-reject.spec.ts` -> `mockup/mockup.spec.ts`~~ DONE
2. `datamodellm/basic.spec.ts` -> merge into `datamodellm.spec.ts`

**Savings**: 1 app launch (mockup done), 2 remaining (datamodellm)

---

## e2e/extensions/ (1 file, 1 test)

| File | Tests | Pattern | Status | Notes |
| --- | --- | --- | --- | --- |
| extension-loading.spec.ts | 1 | beforeEach | pending | Single test |

---

## e2e/files/ (4 files -> 1 consolidated, 15 tests)

| File | Tests | Pattern | Status | Notes |
| --- | --- | --- | --- | --- |
| files.spec.ts | 15 | beforeAll | done | Consolidated from 4 files, 13 pass + 2 skipped (~50s) |
| ~~file-operations-while-open.spec.ts~~ | - | - | replaced | Merged into files.spec.ts |
| ~~file-save-comprehensive.spec.ts~~ | - | - | replaced | Merged into files.spec.ts |
| ~~file-tree-filtering.spec.ts~~ | - | - | replaced | Merged into files.spec.ts |
| ~~file-watcher-updates.spec.ts~~ | - | - | replaced | Merged into files.spec.ts |

**Savings**: 3 app launches

---

## e2e/history/ (3 files -> 1 consolidated, 6 tests)

| File | Tests | Pattern | Status | Notes |
| --- | --- | --- | --- | --- |
| history.spec.ts | 6 | beforeAll | done | Consolidated from 3 files, all 6 tests pass (~47s) |
| ~~history-manual-auto-save.spec.ts~~ | - | - | replaced | Merged into history.spec.ts |
| ~~history-manual-auto-simple.spec.ts~~ | - | - | replaced | Merged into history.spec.ts |
| ~~history-restore.spec.ts~~ | - | - | replaced | Merged into history.spec.ts |

**Savings**: 2 app launches

---

## e2e/images/ (1 file, 1 test)

| File | Tests | Pattern | Status | Notes |
| --- | --- | --- | --- | --- |
| image-paste.spec.ts | 1 | none | pending | Single test |

---

## e2e/interactive-prompts/ (1 file, 1 test)

| File | Tests | Pattern | Status | Notes |
| --- | --- | --- | --- | --- |
| ask-user-question.spec.ts | 1 | beforeAll | pending | Already consolidated pattern |

---

## e2e/markdown/ (1 file, 1 test)

| File | Tests | Pattern | Status | Notes |
| --- | --- | --- | --- | --- |
| markdown-copy.spec.ts | 1 | none | pending | Could merge into editors/markdown.spec.ts |

---

## e2e/offscreen-editor/ (1 file, 1 test)

| File | Tests | Pattern | Status | Notes |
| --- | --- | --- | --- | --- |
| offscreen-mounting.spec.ts | 1 | beforeEach | pending | Single test |

---

## e2e/onboarding/ (1 file, 1 test)

| File | Tests | Pattern | Status | Notes |
| --- | --- | --- | --- | --- |
| welcome-modal.spec.ts | 1 | beforeEach | skip | Tests first-run experience, needs clean state |

---

## e2e/permissions/ (7 files, 44 tests)

| File | Tests | Pattern | Status | Notes |
| --- | --- | --- | --- | --- |
| agent-permissions.spec.ts | 2 | beforeAll | done | Fixed: uses beforeAll, updated for new trust UI, tests pass |
| bash-permissions.spec.ts | 9 | beforeEach | pending | Needs consolidation |
| outside-path-permissions.spec.ts | 4 | beforeEach | pending | Needs consolidation |
| permission-persistence.spec.ts | 4 | beforeAll | in-progress | Uses beforeAll but IPC trust workflow failing |
| permission-screenshots.spec.ts | 5 | beforeAll | pending | Already consolidated pattern |
| webfetch-permissions.spec.ts | 2 | beforeAll | in-progress | Uses beforeAll but some tests failing |
| webfetch-url-persistence.spec.ts | 8 | beforeAll | in-progress | Uses beforeAll, 5 pass, 1 fail, 2 skipped |

### Permissions Consolidation Candidates

Files using `beforeEach`:
1. `bash-permissions.spec.ts` -> consolidate internally or merge
2. `outside-path-permissions.spec.ts` -> consolidate internally or merge

Note: Permission tests may require specific permission modes at launch, limiting consolidation options.

---

## e2e/plugins/ (1 file, 2 tests)

| File | Tests | Pattern | Status | Notes |
| --- | --- | --- | --- | --- |
| find-replace-bar.spec.ts | 2 | beforeAll | done | Fixed: uses beforeAll, fixed IPC channel (menu:find), tests pass |

---

## e2e/settings/ (REMOVED - Tool packages deprecated)

**Status: REMOVED** - Tool packages system has been replaced by extension-based Claude plugins.

All tests related to tool packages (package installation, version detection, etc.) have been deleted:
- ~~settings.spec.ts~~ - Deleted (tested deprecated tool packages)
- ~~package-installation.spec.ts~~ - Deleted (tested deprecated tool packages)
- ~~project-settings.spec.ts~~ - Deleted (tested deprecated tool packages)

The functionality is now provided through the extensions system and Claude plugins panel.

---

## e2e/smoke/ (1 file, 1 test)

| File | Tests | Pattern | Status | Notes |
| --- | --- | --- | --- | --- |
| visual-smoke.spec.ts | 1 | beforeAll | pending | Already consolidated pattern |

---

## e2e/tabs.spec.ts (1 file, 8 tests)

| File | Tests | Pattern | Status | Notes |
| --- | --- | --- | --- | --- |
| tabs.spec.ts | 5 | beforeAll | done | Fixed: uses beforeAll, 2 tests pass, 3 skipped |

---

## e2e/terminal/ (1 file, 1 test)

| File | Tests | Pattern | Status | Notes |
| --- | --- | --- | --- | --- |
| terminal-session.spec.ts | 1 | beforeEach | pending | Single test |

---

## e2e/theme/ (5 files -> 1 consolidated, 10 tests)

| File | Tests | Pattern | Status | Notes |
| --- | --- | --- | --- | --- |
| theme.spec.ts | 10 | beforeAll | done | Consolidated from 5 files, 6 pass + 4 skipped (~10s) |
| ~~lexical-extension-theme.spec.ts~~ | - | - | replaced | Merged into theme.spec.ts |
| ~~lexical-list-styling.spec.ts~~ | - | - | replaced | Merged into theme.spec.ts |
| ~~solarized-monaco-editor.spec.ts~~ | - | - | replaced | Merged into theme.spec.ts |
| ~~solarized-table-header.spec.ts~~ | - | - | replaced | Merged into theme.spec.ts |
| ~~theme-switching.spec.ts~~ | - | - | replaced | Merged into theme.spec.ts |

**Savings**: 4 app launches

---

## e2e/tracker/ (4 files -> 1 consolidated, 6 tests)

| File | Tests | Pattern | Status | Notes |
| --- | --- | --- | --- | --- |
| tracker.spec.ts | 6 | beforeAll | done | Consolidated from 4 files, all 6 tests pass (~20s) |
| ~~custom-tracker.spec.ts~~ | - | - | replaced | Merged into tracker.spec.ts |
| ~~plan-status-header.spec.ts~~ | - | - | replaced | Merged into tracker.spec.ts |
| ~~tracker-comprehensive.spec.ts~~ | - | - | replaced | Merged into tracker.spec.ts |
| ~~tracker-inline-behavior.spec.ts~~ | - | - | replaced | Merged into tracker.spec.ts |

**Savings**: 3 app launches

---

## e2e/update/ (1 file, 1 test)

| File | Tests | Pattern | Status | Notes |
| --- | --- | --- | --- | --- |
| update-toast.spec.ts | 1 | beforeEach | pending | Single test |

---

## e2e/walkthroughs/ (1 file, 1 test)

| File | Tests | Pattern | Status | Notes |
| --- | --- | --- | --- | --- |
| walkthrough-system.spec.ts | 1 | beforeEach | pending | Single test |

---

## e2e/worktree/ (1 file, 1 test)

| File | Tests | Pattern | Status | Notes |
| --- | --- | --- | --- | --- |
| worktree-session-creation.spec.ts | 1 | beforeEach | pending | Single test |

---

## Priority Consolidation Tasks

### High Priority (Most Savings)

1. ~~**theme/** - 5 files -> 1 file (4 launches saved)~~ DONE
2. ~~**editor/** - 4 files -> 1 file (3 launches saved)~~ DONE
3. ~~**files/** - 4 files -> 1 file (3 launches saved)~~ DONE
4. ~~**tracker/** - 4 files -> 1 file (3 launches saved)~~ DONE
5. ~~**ai/session-management** - 7 files -> 1 file (6 launches saved)~~ DONE
6. ~~**editors/mockup/** - 2 files -> 1 file (1 launch saved)~~ DONE
7. ~~**history/** - 3 files -> 1 file (2 launches saved)~~ DONE
8. **settings/** - 2 files -> 1 file (1 launch saved)

### Medium Priority (Already Consolidated, Verify Pattern)

Many files already use `beforeAll` but may have nested `beforeEach` or other issues:
- Review all files marked "Already consolidated pattern"
- Ensure no `test.describe` blocks wrapping module-level hooks

### Low Priority (Single Tests or Cannot Consolidate)

- Single-test files with no consolidation partners
- Tests requiring fresh app state (startup, restore, onboarding)

---

## Completed Consolidations

| Date | Files Consolidated | Savings |
| --- | --- | --- |
| 2026-01-19 | editors/markdown/ (5 files) -> editors/markdown.spec.ts | 4 launches |
| - | csv.spec.ts (internal consolidation) | Already done |
| - | datamodellm.spec.ts (internal consolidation) | Already done |
| - | excalidraw.spec.ts (internal consolidation) | Already done |
| - | monaco.spec.ts (internal consolidation) | Already done |
| 2026-02-05 | history-manual-auto-save.spec.ts | Fixed beforeAll, tests pass |
| 2026-02-05 | tabs.spec.ts | Fixed beforeAll, tests pass |
| 2026-02-05 | plugins/find-replace-bar.spec.ts | Fixed beforeAll + IPC channel, tests pass |
| 2026-02-05 | core/context-aware-new.spec.ts | Fixed beforeAll + selectors, tests pass |
| 2026-02-05 | permissions/agent-permissions.spec.ts | Fixed beforeAll + new trust UI, tests pass |
| 2026-02-05 | theme/theme-switching.spec.ts | Fixed beforeAll, 3 tests pass (10s total) |
| 2026-02-05 | theme/lexical-extension-theme.spec.ts | Fixed beforeAll, 2 pass + 2 skipped (extension themes) |
| 2026-02-05 | theme/lexical-list-styling.spec.ts | Fixed beforeAll, test passes |
| 2026-02-05 | theme/solarized-monaco-editor.spec.ts | Fixed beforeAll, skipped (extension themes) |
| 2026-02-05 | theme/solarized-table-header.spec.ts | Fixed beforeAll, skipped (extension themes) |
| 2026-02-05 | editor/document-initial-scroll.spec.ts | Fixed beforeAll |
| 2026-02-05 | editor/no-rerender-on-ai-input.spec.ts | Fixed beforeAll, 3 tests share app |
| 2026-02-05 | editor/no-rerender-on-save.spec.ts | Fixed beforeAll, 2 tests share app |
| 2026-02-05 | editor/unified-header-breadcrumb.spec.ts | Fixed beforeAll |
| 2026-02-05 | files/file-deletion-while-open.spec.ts | Fixed beforeAll + autosave bug fix |
| 2026-02-05 | files/file-save-comprehensive.spec.ts | Fixed beforeAll, 4 tests pass |
| 2026-02-05 | files/file-tree-filtering.spec.ts | Fixed beforeAll, 2 pass |
| 2026-02-05 | files/file-watcher-updates.spec.ts | Fixed beforeAll, 5 pass + 2 skipped |
| 2026-02-05 | tracker/ (4 files -> tracker.spec.ts) | Consolidated 4 files into 1, all 6 tests pass (~20s), 3 launches saved |
| 2026-02-05 | theme/ (5 files -> theme.spec.ts) | Consolidated 5 files into 1, 6 pass + 4 skipped (~10s), 4 launches saved |
| 2026-02-05 | editor/ (4 files -> editor.spec.ts) | Consolidated 4 files into 1, 6 pass + 1 skipped (~29s), 3 launches saved |
| 2026-02-05 | files/ (4 files -> files.spec.ts) | Consolidated 4 files into 1, 13 pass + 2 skipped (~50s), 3 launches saved |
| 2026-02-05 | history/ (3 files -> history.spec.ts) | Consolidated 3 files into 1, all 6 tests pass (~47s), 2 launches saved |
| 2026-02-05 | editors/mockup/ (2 files -> mockup.spec.ts) | Consolidated 2 files into 1, both tests pass (~15s), 1 launch saved |

---

## Additional Fixes Made (2026-02-05)

### Helper Function Updates

- **helpers.ts:dismissProjectTrustToast** - Updated for new trust dialog UI (Allow Edits + Save buttons)
- **testHelpers.ts:dismissAPIKeyDialog** - Made more robust with try-catch

### UI Changes Discovered

The trust/permission dialog UI was updated. Tests looking for old selectors needed updates:
- Old: `.project-trust-toast-overlay`, `.project-trust-toast-option--primary`
- New: Uses role-based selectors like `getByRole('heading', { name: /^Trust .+\?$/ })`, `getByRole('button', { name: /Allow Edits/ })`

### IPC Channel Fixes

- **find-replace-bar.spec.ts** - Changed from `toggle-search-replace` to `menu:find` IPC channel

---

## Notes

- Files with `beforeAll` may still need review - the presence of `beforeAll` doesn't guarantee correct consolidation
- Some files show both `beforeAll` and `beforeEach` which may indicate mixed patterns or nested describes
- Permission tests have constraints around launch-time configuration
- Core tests often require fresh app state for meaningful testing
- Permission persistence tests have issues with the `permissions:trustWorkspace` IPC call not persisting correctly - needs investigation
