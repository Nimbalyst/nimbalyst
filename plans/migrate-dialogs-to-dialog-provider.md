---
planStatus:
  planId: plan-migrate-dialogs-to-dialog-provider
  title: Migrate All Dialogs to DialogProvider
  status: draft
  planType: refactor
  priority: high
  owner: ghinkle
  stakeholders: []
  tags:
    - dialogs
    - refactor
    - walkthroughs
  created: "2026-02-01"
  updated: "2026-02-01T17:00:00.000Z"
  progress: 0
---

# Migrate All Dialogs to DialogProvider

## Problem

Walkthroughs are appearing while dialogs are open (e.g., Trust dialog, onboarding). The current fix using `hasActiveDialogsAtom` only tracks dialogs managed by DialogProvider. Many dialogs are standalone components that render their own overlays and are not tracked.

## Goal

Migrate all dialog/overlay components to use DialogProvider so that:
1. `hasActiveDialogsAtom` accurately reflects when any dialog is open
2. Walkthroughs are properly blocked when any dialog is visible
3. Dialogs have consistent behavior (ESC to close, mutual exclusion, etc.)

## Current State

### Already Registered in DialogProvider

From `packages/electron/src/renderer/dialogs/`:

| Dialog ID | Group | Component |
| --- | --- | --- |
| `quick-open` | navigation | QuickOpen |
| `session-quick-open` | navigation | SessionQuickOpen |
| `prompt-quick-open` | navigation | PromptQuickOpen |
| `agent-command-palette` | navigation | AgentCommandPalette |
| `keyboard-shortcuts` | help | KeyboardShortcutsDialog |
| `api-key` | settings | ApiKeyDialog |
| `confirm-dialog` | alert | ConfirmDialog |
| `error-dialog` | alert | ErrorDialog |
| `project-selection` | system | ProjectSelectionDialog |
| `discord-invitation` | promotion | DiscordInvitation |
| `posthog-survey` | feedback | PostHogSurvey |
| `onboarding` | onboarding | UnifiedOnboarding |
| `windows-claude-code-warning` | onboarding | WindowsClaudeCodeWarning |
| `session-import` | developer | SessionImportDialog |

### NOT Registered (Need Migration)

From grep for `nim-overlay`:

| Component | File | Priority |
| --- | --- | --- |
| **ProjectTrustToast** | `components/ProjectTrustToast/ProjectTrustToast.tsx` | HIGH - blocks walkthroughs |
| **WelcomeModal** | `components/WelcomeModal/WelcomeModal.tsx` | HIGH - first-run |
| **WorktreeOnboardingModal** | `components/WorktreeOnboardingModal/WorktreeOnboardingModal.tsx` | HIGH |
| **ClaudeCommandsLearnMoreDialog** | `components/ClaudeCommandsLearnMoreDialog.tsx` | MEDIUM |
| **NewFileDialog** | `components/NewFileDialog.tsx` | MEDIUM |
| **InputModal** | `components/InputModal.tsx` | MEDIUM |
| **WorkspaceHistoryDialog** | `components/WorkspaceHistoryDialog/WorkspaceHistoryDialog.tsx` | MEDIUM |
| **IndexBuildDialog** | `components/AgenticCoding/IndexBuildDialog.tsx` | MEDIUM |
| **MergeConfirmDialog** | `components/AgentMode/MergeConfirmDialog.tsx` | MEDIUM |
| **MergeConflictDialog** | `components/AgentMode/MergeConflictDialog.tsx` | MEDIUM |
| **RebaseConflictDialog** | `components/AgentMode/RebaseConflictDialog.tsx` | MEDIUM |
| **UntrackedFilesConflictDialog** | `components/AgentMode/UntrackedFilesConflictDialog.tsx` | MEDIUM |
| **SquashCommitModal** | `components/AgentMode/SquashCommitModal.tsx` | MEDIUM |
| **ArchiveWorktreeDialog** | `components/AgentMode/ArchiveWorktreeDialog.tsx` | MEDIUM |
| **ExtensionErrorConsole** | `components/ExtensionDevIndicator/ExtensionErrorConsole.tsx` | LOW |
| **AttachmentPreview** | `components/AgenticCoding/AttachmentPreview.tsx` | LOW |
| **QRPairingModal** | `components/GlobalSettings/panels/QRPairingModal.tsx` | LOW |
| DatabaseBrowser cell modal | `components/DatabaseBrowser/DatabaseBrowser.tsx` | LOW |

## Implementation Plan

### Phase 1: High Priority Dialogs (Blocking Walkthroughs)

#### 1.1 ProjectTrustToast

**Current usage:** Rendered in App.tsx with state managed locally
**Group:** `trust` (new group)
**Priority:** Very high (1000) - should appear over everything

Steps:
1. Add `PROJECT_TRUST` to `DIALOG_IDS` in registry.ts
2. Create wrapper in new file `dialogs/trustDialogs.tsx`
3. Update App.tsx to open via `dialogRef.current?.open('project-trust', data)`
4. Remove local rendering of ProjectTrustToast

#### 1.2 WelcomeModal

**Current usage:** Likely rendered conditionally in App.tsx
**Group:** `onboarding`

#### 1.3 WorktreeOnboardingModal

**Current usage:** Rendered in AgentMode components
**Group:** `onboarding`

### Phase 2: Medium Priority Dialogs

#### 2.1 Git/Worktree Dialogs

Create `dialogs/gitDialogs.tsx` for:
- MergeConfirmDialog
- MergeConflictDialog
- RebaseConflictDialog
- UntrackedFilesConflictDialog
- SquashCommitModal
- ArchiveWorktreeDialog

**Group:** `git` (new group)

#### 2.2 File Dialogs

Create `dialogs/fileDialogs.tsx` for:
- NewFileDialog
- WorkspaceHistoryDialog
- InputModal

**Group:** `file` (new group)

#### 2.3 Other Dialogs

- ClaudeCommandsLearnMoreDialog -> `help` group
- IndexBuildDialog -> `system` group

### Phase 3: Low Priority Dialogs

- ExtensionErrorConsole
- AttachmentPreview
- QRPairingModal
- DatabaseBrowser cell modal

These may not need migration if they're developer-only or rarely used.

## Migration Pattern

For each dialog:

### Step 1: Add to registry.ts

```typescript
export const DIALOG_IDS = {
  // ... existing
  PROJECT_TRUST: 'project-trust',
} as const;
```

### Step 2: Create/update dialog registration file

```typescript
// dialogs/trustDialogs.tsx
export interface ProjectTrustData {
  workspacePath: string;
  onTrustDecision: (trusted: boolean, mode: TrustChoice) => void;
}

function ProjectTrustWrapper({
  isOpen,
  onClose,
  data,
}: {
  isOpen: boolean;
  onClose: () => void;
  data: ProjectTrustData;
}) {
  if (!isOpen) return null;
  return (
    <ProjectTrustToast
      workspacePath={data.workspacePath}
      onDismiss={onClose}
      // ... other props
    />
  );
}

export function registerTrustDialogs() {
  registerDialog<ProjectTrustData>({
    id: DIALOG_IDS.PROJECT_TRUST,
    group: 'trust',
    component: ProjectTrustWrapper as DialogConfig<ProjectTrustData>['component'],
    priority: 1000, // Very high
  });
}
```

### Step 3: Update index.ts

```typescript
import { registerTrustDialogs } from './trustDialogs';

export function initializeDialogs() {
  // ... existing
  registerTrustDialogs();
}
```

### Step 4: Update usage site

```typescript
// Before (App.tsx)
{showTrustDialog && <ProjectTrustToast ... />}

// After (App.tsx)
// Use dialogRef or useDialogs hook
dialogRef.current?.open('project-trust', {
  workspacePath,
  onTrustDecision: handleTrustDecision,
});
```

## Files to Modify

### New Files
- `dialogs/trustDialogs.tsx`
- `dialogs/gitDialogs.tsx`
- `dialogs/fileDialogs.tsx`

### Modified Files
- `dialogs/registry.ts` - Add new DIALOG_IDS
- `dialogs/index.ts` - Import and call new registration functions
- `App.tsx` - Remove direct rendering, use DialogProvider
- `components/AgentMode/*.tsx` - Remove direct dialog rendering
- Various component files that currently render dialogs directly

## Testing Checklist

- [ ] Walkthroughs do not appear while ProjectTrustToast is visible
- [ ] Walkthroughs do not appear while WelcomeModal is visible
- [ ] Walkthroughs do not appear while any git dialog is visible
- [ ] ESC key closes dialogs properly
- [ ] Dialog mutual exclusion works (opening one closes others in same group)
- [ ] Existing functionality preserved for all migrated dialogs

## Rollback Plan

If issues arise, can revert to DOM-based detection (`hasVisibleOverlay()`) as a fallback while fixing DialogProvider integration.
