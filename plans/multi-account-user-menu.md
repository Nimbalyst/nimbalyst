---
planStatus:
  planId: plan-multi-account-user-menu
  title: "Multi-Account Support with User Menu"
  status: draft
  planType: feature
  priority: high
  owner: ghinkle
  stakeholders: []
  tags:
    - multi-account
    - auth
    - stytch-b2b
    - nav-gutter
    - settings
  created: "2026-02-27"
  updated: "2026-02-27T20:30:00.000Z"
  progress: 0
---

# Multi-Account Support with User Menu

## Summary

Allow users to log into multiple email addresses, each with its own Stytch B2B personal org and member ID. Replace the gear icon at the bottom of the NavigationGutter with a user avatar that opens a compact user menu for navigating to account, user settings, and project/team settings. Under the hood, manage multiple sets of credentials (personal JWTs, team JWTs) so workspaces can be associated with specific accounts.

## Key Design Principle: Accounts Are Bound to Projects

There is no global "active account" concept. Each project/workspace is permanently bound to one account identity (set once, almost never changed). Different windows can have different projects open with different identities simultaneously. The user menu shows which identity the current project uses -- it is not an account switcher.

## UI Design

### NavigationGutter Change

**Current:** Gear icon at bottom-left opens Settings (contentMode = 'settings').

**New:** User avatar icon at bottom-left. On click, shows a popover menu above the icon:

```
 ┌─────────────────────────────┐
 │  User Settings              │  <-- opens Settings (user scope)
 │  Project Settings           │  <-- opens Settings (project scope)
 │  Team Settings              │  <-- opens Settings (project scope, team category)
 │─────────────────────────────│
 │  ┌──┐  garrett@example.com  │  <-- this project's identity (clickable -> Account & Sync)
 │  └──┘  Signed in             │
 └─────────────────────────────┘
```

**Behavior:**
- Shows the email/identity bound to the current project's workspace
- Clicking the account row navigates to Account & Sync settings
- Clicking "User Settings" navigates to `contentMode: 'settings'` with `scope: 'user'`
- Clicking "Project Settings" navigates to `contentMode: 'settings'` with `scope: 'project'`
- Clicking "Team Settings" navigates to `contentMode: 'settings'` with `scope: 'project', category: 'team'`
- "Add Account" and account management live in the Account & Sync settings panel, not in this popover

### Mockup

![User menu popover](screenshot.png){mockup:nimbalyst-local/mockups/user-menu-popover.mockup.html}

## Architecture

### Multi-Credential Storage

**Current:** `StytchAuthService.ts` holds a single `StytchAuthState` with one `sessionJwt`, `personalSessionJwt`, `orgId`, `personalOrgId`, `personalUserId`.

**New:** Store credentials per account (keyed by personal org ID, since that's the stable identifier):

```typescript
interface AccountCredentials {
  personalOrgId: string;
  personalUserId: string;  // member ID in personal org
  personalSessionJwt: string | null;
  sessionToken: string | null;
  email: string;
  userName?: string;
  // Team associations (after session exchange)
  teamSessions: Map<string, {  // keyed by team orgId
    sessionJwt: string;
    memberId: string;  // member ID in team org
  }>;
}

// Multiple accounts
accounts: Map<personalOrgId, AccountCredentials>
```

**Keychain storage:** Move from flat keys to account-prefixed keys:
- `stytch_session_token` -> `stytch_session_token_<personalOrgId>`
- `stytch_session_jwt` -> `stytch_session_jwt_<personalOrgId>`

**Backward compat:** On first load, migrate the existing flat credentials into the first account entry.

### Auth Flow Changes

The Stytch B2B Discovery flow already returns `discovered_organizations` after OAuth. Currently we auto-select the first org. Changes:

1. **"Add Account" flow:** Initiates a new OAuth/magic-link flow. On callback, the deep link returns a new set of credentials for a potentially different personal org.
2. **Discovery handling:** If the same email discovers multiple orgs, store sessions for all of them. Each `discovery/intermediate_sessions/exchange` call returns an org-scoped session.
3. **Deep link callback:** Store credentials under the returned `personalOrgId` in the accounts map.

### SyncManager: Per-Account Connections

**Current:** One `CollabV3Sync` instance using one `personalSessionJwt`.

**New:** One sync instance per account that has active workspaces:

```typescript
// Map<personalOrgId, CollabV3Sync>
syncInstances: Map<string, CollabV3Sync>
```

- On workspace open, look up the workspace's assigned account, get or create sync instance
- On workspace close, if no other workspaces use that account, disconnect
- JWT refresh runs independently per account

### Workspace-Account Binding

**Current:** Workspaces implicitly use whatever account is signed in.

**New:** Add `accountId` (personalOrgId) to workspace persisted state:

```typescript
// In WorkspaceState (store.ts)
accountId?: string;  // personalOrgId this workspace syncs under
```

- Set once when a workspace is first opened (defaults to the primary account)
- Persisted permanently -- the workspace always uses this account identity
- Can be changed in project settings (Account & Sync) but this should be rare
- Different open workspaces can use different accounts simultaneously
- Team matching (`findTeamForWorkspace`) already uses git remote hashing and works per-org

### Settings Store Impact

**Mostly unchanged.** The electron-store app settings remain global (theme, notifications, AI providers are not per-account). What changes:

- **Workspace state** gets `accountId` field
- **SyncConfig** stays global (enabled/disabled, server URL) -- the per-account routing is handled by SyncManager
- **TeamService** already handles per-org JWT caching -- just needs to accept which account to use

### Renderer Auth State

**Current:** `SyncPanel.tsx` calls `stytch.getAuthState()` which returns a single account state.

**New:** Add IPC methods:
- `stytch.getAccounts()` -> returns all `AccountCredentials[]` (sans JWTs, just email/name/orgId)
- `stytch.getActiveAccount()` -> returns the current/primary account
- `stytch.addAccount()` -> initiates add-account OAuth flow
- `stytch.removeAccount(personalOrgId)` -> signs out one account
- `stytch.onAccountsChange(callback)` -> subscribe to account list changes

## Implementation Steps

### Phase 1: User Menu UI (no multi-account yet)

Replace the gear icon with a user avatar + popover menu. Single account only -- just restructure the navigation entry point. The popover shows the current project's identity and provides quick navigation to settings.

1. **Create `UserMenuPopover` component** - Popover that appears above the avatar icon showing current identity (email + signed-in status) and three navigation links (User Settings, Project Settings, Team Settings)
2. **Update `NavigationGutter.tsx`** - Replace the settings button (gear icon) with a user avatar button that toggles the popover. Avatar shows first initial in a colored circle with a sync status dot.
3. **Wire navigation** - Clicking identity row -> Account & Sync settings. "User Settings" -> `settings` mode, `user` scope. "Project Settings" -> `settings` mode, `project` scope. "Team Settings" -> `settings` mode, `project` scope, `team` category.
4. **Account display** - Show email from current `stytch.getAuthState()`. Show "Signed in" / "Not signed in" status.

**Files:**
- `packages/electron/src/renderer/components/NavigationGutter/UserMenuPopover.tsx` (new)
- `packages/electron/src/renderer/components/NavigationGutter/NavigationGutter.tsx` (modify)

### Phase 2: Multi-Credential Storage

Refactor `StytchAuthService` to store credentials per account.

1. **Define `AccountCredentials` interface** in StytchAuthService
2. **Replace single `authState` with `accounts` Map** keyed by personalOrgId
3. **Migrate keychain storage** to account-prefixed keys
4. **Add backward-compat migration** - on first load, move flat credentials into first account entry
5. **Update `getAuthState()`** for backward compat (returns primary account)
6. **Add `getAccounts()`, `getActiveAccountForWorkspace(workspacePath)`**
7. **Update `handleAuthCallback()`** to store into accounts map
8. **Update `restoreSession()`** to restore all stored accounts

**Files:**
- `packages/electron/src/main/services/StytchAuthService.ts` (major refactor)
- `packages/electron/src/main/utils/store.ts` (keychain key changes)

### Phase 3: Add Account Flow

Enable adding a second (or third) account via OAuth.

1. **Add `addAccount()` method** to StytchAuthService - initiates OAuth flow, stores result as new account
2. **Add `removeAccount(personalOrgId)`** - removes credentials, disconnects sync
3. **Add IPC handlers** for add/remove account
4. **Add preload API** methods
5. **Wire into UserMenuPopover** - "Add Account" button, account list with remove option

**Files:**
- `packages/electron/src/main/services/StytchAuthService.ts`
- `packages/electron/src/main/ipc/SettingsHandlers.ts`
- `packages/electron/src/preload/index.ts`
- `packages/electron/src/renderer/components/NavigationGutter/UserMenuPopover.tsx`

### Phase 4: Per-Account Sync Connections

Refactor SyncManager to maintain per-account sync instances.

1. **Add `accountId` to WorkspaceState** in store.ts
2. **Refactor SyncManager** to use `Map<personalOrgId, CollabV3Sync>`
3. **Route workspace sync** to the correct account's sync instance
4. **Handle account removal** - disconnect affected workspaces
5. **Update `getPersonalSessionJwt()`** to accept accountId parameter

**Files:**
- `packages/electron/src/main/utils/store.ts` (WorkspaceState)
- `packages/electron/src/main/services/SyncManager.ts` (major refactor)
- `packages/electron/src/main/services/StytchAuthService.ts` (per-account JWT getters)

### Phase 5: Settings UI Integration

Update settings screens to be multi-account aware. Account management (add/remove) lives in the Account & Sync settings panel, not the popover.

1. **Update SyncPanel** to show all signed-in accounts with "Add Account" and "Sign Out" per account
2. **Add workspace account picker** in project settings -- a dropdown to (rarely) change which account identity this project uses
3. **Update TeamPanel** to use the workspace's assigned account for team operations
4. **Update UserMenuPopover** to show the correct identity for the current workspace (reads `accountId` from workspace state)

**Files:**
- `packages/electron/src/renderer/components/GlobalSettings/panels/SyncPanel.tsx`
- `packages/electron/src/renderer/components/Settings/panels/TeamPanel.tsx`
- `packages/electron/src/renderer/components/NavigationGutter/UserMenuPopover.tsx`

### Phase 6: iOS Multi-Account (separate plan)

Mirror the desktop multi-credential approach in iOS. Out of scope for this plan.

## What Doesn't Change

- **CollabV3 server** - Zero changes. Already validates org per connection via JWT.
- **Room ID format** - Already org-scoped.
- **Encryption** - Keys are per-org, already handled correctly.
- **App-level settings** - Theme, notifications, AI providers stay global (not per-account).
- **Extension settings** - Stay global.

## Open Questions

1. **Workspace default account** - When opening a new workspace, which account is the default? Recommendation: the first/primary account (the one they initially signed up with).
2. **Team invites across accounts** - If user gets a team invite to their work email but the project is bound to their personal email, how do we handle? The existing `findPendingInviteForWorkspace` checks all discovered orgs, so matching should work. But accepting would need to use the correct account's credentials.
3. **Account reassignment** - When a user changes a project's account binding in settings, what happens to existing sync data (sessions, tracker items)? Those room IDs are scoped to the old personalOrgId. Likely need to disconnect and reconnect under the new identity -- existing synced data stays on the server under the old org.

## References

- Existing preliminary plan: `plans/multi-account-support.md`
- Auth architecture: `design/Collaboration/README.md`
- Current NavigationGutter: `packages/electron/src/renderer/components/NavigationGutter/NavigationGutter.tsx`
- Current StytchAuthService: `packages/electron/src/main/services/StytchAuthService.ts`
- Current SyncManager: `packages/electron/src/main/services/SyncManager.ts`
- Settings sidebar: `packages/electron/src/renderer/components/Settings/SettingsSidebar.tsx`
