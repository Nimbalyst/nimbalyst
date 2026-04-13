---
planStatus:
  planId: plan-tracker-mine-filter-identity
  title: Fix 'Mine' Filter to Use Authenticated Identity
  status: in-review
  planType: bug-fix
  priority: high
  owner: ghinkle
  stakeholders:
    - kwirth
  tags:
    - tracker
    - filters
    - identity
  created: "2026-04-13"
  updated: "2026-04-13T18:00:00.000Z"
  progress: 100
---
# Fix "Mine" Filter to Use Authenticated Identity

## Implementation Progress

- [x] Add `isMyRecord()` and `matchesIdentity()` to `trackerRecordAccessors.ts`
- [x] Replace inline "Mine" filter in `TrackerMainView.tsx` with `isMyRecord()`
- [x] Consolidate MCP `tracker_create` assignment: `owner` and `assigneeEmail` write to same field
- [x] Update `TrackerIdentityService.isMyItem()` to use case-insensitive matching
- [x] Typecheck passes

## Problem

The "Mine" filter chip on the tracker board does not correctly show items owned by the signed-in user. Setting `kwirth@stravu.com` as the owner on tasks, then clicking "Mine", fails to match.

## Root Cause Analysis

The filter logic in `TrackerMainView.tsx:184-211` has three issues:

### 1. Identity-to-owner field comparison relies on exact email match

The filter fetches the current identity via `document-service:get-current-identity` IPC (resolved in `TrackerIdentityService.getCurrentIdentity()`), which returns the Stytch email as `currentIdentity.email`. It then compares this against `getFieldByRole(record, 'assignee')` (which maps to `record.fields.owner`).

The problem: if the Stytch email differs from the value stored in the `owner` field, there is no match. Owner values in the DB are inconsistently formatted -- some are emails (`greghinkle@gmail.com`), some are usernames (`ghinkle`), some are first names (`alice`). The filter only matches if `currentIdentity.email === ownerValue` or `currentIdentity.displayName === ownerValue`.

### 2. `assigneeEmail` field is never checked by the renderer filter

The MCP `tracker_create` tool stores email-based assignment in `assigneeEmail` (via `args.assigneeEmail`), but the renderer "Mine" filter only checks the `owner` field (via the `assignee` role default). Items assigned via `assigneeEmail` are invisible to the "Mine" filter.

The main process `isMyItem()` function in `TrackerIdentityService.ts` correctly checks `item.assigneeEmail`, but the renderer-side filter in `TrackerMainView.tsx` does not use `isMyItem()`.

### 3. "No author, no assignee = assume mine" fallback is too broad

Line 208: `if (!authorIdentity && !assignee) return true;` -- this shows ALL unassigned, uncreated items when "Mine" is active. Most items in the DB have null `authorIdentity` and null `owner`, so the "Mine" filter effectively shows everything.

## Proposed Fix

### Approach: Unify on `isMyItem()` logic in the renderer

Rather than duplicating matching logic in the renderer, expose a single robust matching function and use it in both places.

**Step 1: Enhance the renderer filter to check all identity fields** (`TrackerMainView.tsx`)

Replace the inline filter logic with a function that checks:
1. `record.fields.owner` against `currentIdentity.email`, `currentIdentity.displayName`, and `currentIdentity.gitEmail`
2. `record.fields.assigneeEmail` against `currentIdentity.email` and `currentIdentity.gitEmail`
3. `record.system.authorIdentity.email` against `currentIdentity.email`
4. `record.system.authorIdentity.gitEmail` against `currentIdentity.gitEmail`

All comparisons should be **case-insensitive** (emails are case-insensitive per RFC 5321).

**Step 2: Remove the "no author = mine" fallback**

The `if (!authorIdentity && !assignee) return true` line should be removed. Items with no ownership signal should NOT appear in the "Mine" filter.

**Step 3: Create a shared \****`isMyRecord()`**\*\* function**

Add a pure function in `trackerRecordAccessors.ts` that operates on `TrackerRecord` (not `TrackerItem`):

```typescript
export function isMyRecord(record: TrackerRecord, identity: TrackerIdentity): boolean {
  const owner = getFieldByRole(record, 'assignee') as string | undefined;
  const assigneeEmail = record.fields.assigneeEmail as string | undefined;
  const author = record.system.authorIdentity;

  // Check owner/assignee fields
  if (owner && matchesIdentity(owner, identity)) return true;
  if (assigneeEmail && matchesIdentity(assigneeEmail, identity)) return true;

  // Check author
  if (author?.email && identity.email &&
      author.email.toLowerCase() === identity.email.toLowerCase()) return true;
  if (author?.gitEmail && identity.gitEmail &&
      author.gitEmail.toLowerCase() === identity.gitEmail.toLowerCase()) return true;

  return false;
}

function matchesIdentity(value: string, identity: TrackerIdentity): boolean {
  const v = value.toLowerCase();
  if (identity.email && v === identity.email.toLowerCase()) return true;
  if (identity.displayName && v === identity.displayName.toLowerCase()) return true;
  if (identity.gitEmail && v === identity.gitEmail.toLowerCase()) return true;
  if (identity.gitName && v === identity.gitName.toLowerCase()) return true;
  return false;
}
```

**Step 4: Update \****`TrackerMainView.tsx`***\* to use \****`isMyRecord()`**

Replace lines 184-211 with:
```typescript
if (activeFilters.includes('mine') && currentIdentity) {
  items = items.filter(record => isMyRecord(record, currentIdentity));
}
```

### Files to Change

| File | Change |
| --- | --- |
| `packages/runtime/src/plugins/TrackerPlugin/trackerRecordAccessors.ts` | Add `isMyRecord()` and `matchesIdentity()` functions |
| `packages/electron/src/renderer/components/TrackerMode/TrackerMainView.tsx` | Replace inline filter with `isMyRecord()` call |

### MCP `tracker_list` filter (secondary)

The MCP `tracker_list` tool handler in `trackerToolHandlers.ts` also supports an `owner` filter parameter. This uses a separate code path and may also need updating to use the same identity matching. This is a secondary concern -- the primary fix is the UI filter.

## Design Decisions

1. **Reporter not included** -- "Mine" matches only owner/assignee/author, not reporter.
2. **Authored items included** -- Items created by the current user (via `authorIdentity`) show in "Mine" even with no explicit owner set. The `isMyRecord()` function already handles this via the author identity check.

## Acceptance Criteria

- [ ] "Mine" filter shows items where `owner` matches the signed-in user's email (case-insensitive)
- [ ] "Mine" filter shows items where `assigneeEmail` matches the signed-in user's email
- [ ] "Mine" filter shows items where `authorIdentity.email` matches the signed-in user
- [ ] "Mine" filter does NOT show all unowned items by default
- [ ] Works whether the user is logged in via Stytch or using git config identity
