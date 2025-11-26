---
planStatus:
  planId: plan-fix-public-release-workflow
  title: Fix Public Repository Release Workflow
  status: completed
  planType: bug-fix
  priority: critical
  owner: ghinkle
  stakeholders:
    - ghinkle
  tags:
    - github-actions
    - release
    - deployment
    - ci-cd
  created: "2025-10-28"
  updated: "2025-10-28T20:20:00.000Z"
  progress: 100
---

# Fix Public Repository Release Workflow

## Problem

After removing `GH_TOKEN` from the electron-build workflow to prevent auto-publish issues, releases are no longer being copied to the `stravu/preditor-releases` public repository. Releases v0.42.54 and v0.42.55 failed to publish to the public repo.

## Root Cause Analysis

Commit 39833e6 removed `GH_TOKEN` from the build step to prevent electron-builder auto-publish issues. However, this broke releases because:

1. The `package.json` has `publish` config pointing to `stravu/preditor-releases` (public repo)
2. Electron-builder REQUIRES `GH_TOKEN` to publish to that configured repo
3. Without `GH_TOKEN`, electron-builder silently skipped publishing to the public repo
4. The workflow's fallback "Publish to Public Repository" step had error suppression (`2>/dev/null || true`) that hid this failure
5. Releases v0.42.54 and v0.42.55 were created in the private repo but never copied to public repo

## Investigation Steps

1. Check if `PUBLIC_REPO_PAT` secret exists in GitHub repository settings
2. Verify the token has `repo` scope for `stravu/preditor-releases`
3. Remove error suppression from workflow to see actual errors
4. Add logging to show what files are being uploaded
5. Test with a new release to see the real error message

## Solution

### Phase 1: Revert Breaking Commit (COMPLETED)
- Reverted commit 39833e6 which removed `GH_TOKEN` from build step
- This restores electron-builder's ability to publish to preditor-releases
- Created new commit a451b58

### Phase 2: Add Documentation and Error Visibility (COMPLETED)
- Added critical comments in workflow explaining why `GH_TOKEN` is required
- Comments prevent future removal of `GH_TOKEN` from build step
- Removed `2>/dev/null || true` error suppression from fallback publish step
- Added logging to show available files and better error messages
- Added warning that fallback step should normally not run

### Phase 3: Understanding the Architecture
- Electron-builder is configured in `package.json` to publish to `stravu/preditor-releases`
- Electron-builder needs `GH_TOKEN` during build to perform this publish
- The "Publish to Public Repository" workflow step is a FALLBACK only
- Fallback should detect release exists and skip

### Phase 4: Backfill Missing Releases (TODO)
- Manually create releases for v0.42.54 and v0.42.55 in public repo
- Download artifacts from private repo workflow runs
- Upload to public repository
- Ensure version continuity for auto-update

## Files Modified

- `.github/workflows/electron-build.yml` (lines 116-119, 252-284)
- `.nimbalyst-local/plans/fix-public-release-workflow.md` (this file)

## Next Steps

1. Test with next release to verify electron-builder publishes to public repo
2. Backfill missing releases v0.42.54 and v0.42.55 to public repo
3. Monitor that future releases work correctly

## Acceptance Criteria

- [x] Reverted breaking commit 39833e6
- [x] Added documentation explaining why GH_TOKEN is required
- [x] Improved error visibility in fallback publish step
- [ ] Verify next release publishes to public repo automatically
- [ ] Backfill missing releases v0.42.54 and v0.42.55
- [ ] Confirm auto-update mechanism works correctly

## Notes

### What Went Wrong

The initial attempt to fix auto-publish issues (commit 39833e6) removed `GH_TOKEN` from the build step and added `--publish never` to build scripts. This was based on a misunderstanding of how the system works.

### How It Actually Works

1. **Electron-builder publishing**: The `package.json` has a `publish` config pointing to `stravu/preditor-releases`
2. **GH_TOKEN requirement**: Electron-builder needs `GH_TOKEN` environment variable to authenticate with GitHub
3. **Publishing happens during build**: When electron-builder runs with `GH_TOKEN` set, it creates the release in preditor-releases
4. **Fallback mechanism**: The workflow's "Publish to Public Repository" step is a safety net that should normally find the release already exists

### The Fix

Reverting commit 39833e6 restores `GH_TOKEN` to the build environment, which allows electron-builder to publish to the public repo as configured. Added explicit comments to prevent this from being removed again.
