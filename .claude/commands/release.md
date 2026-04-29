---
description: Prepare and execute a release (patch/minor/major)
---
**Arguments**: `{{arg1}}`
- First word: release type (patch, minor, major)
- If second word is "auto": skip approval prompts and automatically push to private repo

Prepare a release following this workflow:

## AUTO MODE DETECTION

If `{{arg1}}` contains "auto" (e.g., "patch auto"), run the entire process without stopping for approval:
1. Find the last SUCCESSFUL release (see step 1 below -- you MUST check GitHub Actions)
2. Get ALL commits since that successful release
3. Generate release notes (both developer and public versions)
4. Update CHANGELOG.md
5. Run `./scripts/release.sh [type]` (extract just patch/minor/major from arg1)
6. Push to private repo automatically
7. Show the public release notes for reference
8. **Monitor the GitHub Actions run until it completes**, then diagnose and fix any failure (see "MONITOR THE BUILD" below)

Otherwise, follow the interactive workflow below:

## MONITOR THE BUILD (auto mode)

After pushing the tag, babysit the run instead of handing it back to the user:

1. **Find the run ID** for the tag that was just pushed:
   ```
   gh run list --limit=5 --json databaseId,headBranch,status,conclusion,event \
     | jq '[.[] | select(.event == "push" and .headBranch == "v[VERSION]")][0]'
   ```

2. **Watch the run to completion** with `gh run watch`. This blocks until the run finishes and exits non-zero on failure:
   ```
   gh run watch [RUN_ID] --exit-status --interval 30
   ```
   Use the Monitor tool so each progress line becomes a notification rather than sleeping and polling. If Monitor is unavailable, use ScheduleWakeup with **270-second** delays (stays inside the 5-minute prompt cache window -- do NOT use literal 5-minute sleeps since 300s+ drops out of cache and costs a full context re-read each tick).

3. **On success**: announce the release shipped and show the public release notes.

4. **On failure**:
   - Pull failed-job logs: `gh run view [RUN_ID] --log-failed`
   - Read the error and diagnose. Common past failures:
     - Cross-arch native binary missing (SDK darwin-x64 not installed on arm64 runner)
     - `npm install` stripping `peer: true` flags from package-lock.json
     - electron-builder can't find SDK binaries (wrong node_modules location)
   - Fix the root cause with a new commit on `main`
   - Run `/release patch auto` again. The next release will automatically bundle the failed release's CHANGELOG notes with the new fix, since step 1 below covers "everything since the last SUCCESSFUL release"

Do NOT release `/release-public` until the internal build is green.

## INTERNAL RELEASE WORKFLOW

1. **Find the last SUCCESSFUL release** (NOT just the latest tag!):
  - Run: `gh run list --limit=20 --json headBranch,conclusion,displayTitle,event | jq '[.[] | select(.event == "push" and (.headBranch | startswith("v0.")))]'`
  - Find the most recent release tag where `conclusion` is `"success"` -- this is the last version that actually shipped
  - The latest git tag may point to a FAILED build that never shipped. If v0.55.14 failed but v0.55.12 succeeded, the release notes must cover everything since v0.55.12
  - Get commits since that successful tag: `git log [successful-tag]..HEAD --oneline`

2. **Generate release notes**:
  - Create TWO versions of release notes:

   **A. Developer CHANGELOG (for CHANGELOG.md)**:
  - Include all meaningful changes (features, fixes, improvements, refactors)
  - Can include internal changes (TypeScript fixes, optimizations, deprecations)
  - Technical language is fine
  - Categorize using: Added, Changed, Fixed, Removed

   **B. Public Release Notes (for later use with /release-public)**:
  - ONLY user-facing changes that affect the user experience
  - Write in marketing/user-friendly language
  - Each bullet should answer "what can I now do?" or "what problem is fixed?"
  - Filter out ALL internal details:
    - NO code quality metrics (TypeScript errors, type improvements)
    - NO internal refactoring (component deprecations, architecture changes)
    - NO performance optimizations unless user-perceptible
    - NO developer tooling changes
  - Focus on tangible benefits:
    - New features users can try
    - Bugs that were annoying users
    - UI/UX improvements
  - Keep it brief and exciting
  - Use present tense ("Find and replace text in documents" not "Added find/replace")
  - No category headers needed for public notes

3. **Update CHANGELOG.md**:
  - Add DEVELOPER CHANGELOG notes to the `[Unreleased]` section in `CHANGELOG.md` (repository root)
  - Use the standard format with ### headings for each category
  - Only include categories that have changes

4. **Show BOTH versions to user**:
  - Display the developer CHANGELOG (what will go in CHANGELOG.md)
  - Display the PUBLIC release notes separately (for later use)
  - Ask for approval before proceeding

5. **Execute internal release** (after user approval):
  - Run `./scripts/release.sh [type]`
  - The script will:
    - Bump version in `packages/electron/package.json`
    - Update package-lock.json
    - Move [Unreleased] notes to a new versioned release section in CHANGELOG.md
    - Create commit with release notes
    - Create annotated git tag with release notes

6. **Push to private repo**:
  - Push main and tag: `git push origin main && git push origin v[VERSION]`
  - Provide link to GitHub Actions: https://github.com/nimbalyst/nimbalyst/actions

7. **Done**: Show the public release notes for reference when running `/release-public` later.

Valid release types: patch, minor, major

Example CHANGELOG.md format:
```markdown
## [Unreleased]

### Added
- New AI model support for GPT-4o

### Fixed
- Fixed crash when opening large files
- Fixed memory leak in file watcher

## [0.42.60] - 2025-10-30
...
```
