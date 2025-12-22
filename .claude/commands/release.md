---
description: Prepare and execute a release (patch/minor/major)
---

**Arguments**: `{{arg1}}`
- First word: release type (patch, minor, major)
- If second word is "auto": skip approval prompts and automatically push to private repo

Prepare a release following this workflow:

## AUTO MODE DETECTION

If `{{arg1}}` contains "auto" (e.g., "patch auto"), run the entire Phase 1 without stopping for approval:
1. Get commits since last release
2. Generate release notes (both developer and public versions)
3. Update CHANGELOG.md
4. Run `./scripts/release.sh [type]` (extract just patch/minor/major from arg1)
5. Push to private repo automatically
6. Show the public release notes at the end for reference
7. Provide link to GitHub Actions

Otherwise, follow the interactive workflow below:

## PHASE 1: INTERNAL RELEASE

1. **Get commits since last release**:
  - Find the last git tag: `git describe --tags --abbrev=0`
  - Get commits since that tag: `git log [last-tag]..HEAD --oneline`

2. **Generate release notes**:
  - Create TWO versions of release notes:

    **A. Developer CHANGELOG (for CHANGELOG.md)**:
    - Include all meaningful changes (features, fixes, improvements, refactors)
    - Can include internal changes (TypeScript fixes, optimizations, deprecations)
    - Technical language is fine
    - Categorize using: Added, Changed, Fixed, Removed

    **B. Public Release Notes (for GitHub Releases)**:
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
  - Display the PUBLIC release notes separately (user-facing only)
  - Ask for approval before proceeding

5. **Execute internal release** (after user approval):
  - Run `./scripts/release.sh {{arg1}}`
  - The script will:
    - Bump version in `packages/electron/package.json`
    - Update package-lock.json
    - Move [Unreleased] notes to a new versioned release section in CHANGELOG.md
    - Create commit with release notes
    - Create annotated git tag with release notes

6. **Push to private repo for internal build**:
  - Show commands to push for internal build:
    ```bash
    git push origin main
    git push origin v[VERSION]
    ```
  - Explain: "This will trigger GitHub Actions to build the release on the PRIVATE repo (nimbalyst/nimbalyst-code)"
  - Explain: "After the build completes, download and test the build before proceeding to Phase 2"
  - Provide link to GitHub Actions: https://github.com/nimbalyst/nimbalyst-code/actions

7. **Stop here and wait for testing**:
  - User should test the internal build
  - When ready to publish publicly, user will run Phase 2

## PHASE 2: PUBLIC RELEASE

This phase is executed AFTER testing the internal build. Create a separate command or continuation:

1. **Verify internal build tested**:
  - Confirm user has downloaded and tested the internal build
  - Confirm no issues found

2. **Publish to public repo**:
  - Show the PUBLIC release notes again
  - Provide instructions to publish:
    - Option A: Manually create GitHub release on public repo with the public notes
    - Option B: Use GitHub Actions to sync from private to public repo
  - Public repo: https://github.com/nimbalyst/nimbalyst

3. **Update public release with user-friendly notes**:
  - User copies the PUBLIC release notes to the GitHub release description
  - Ensures only user-facing changes are visible to the public

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

---

**Note**: After Phase 1 completes, the user should test the internal build. Once testing is complete, they can proceed with Phase 2 to publish to the public repo. The two phases are separate to allow for internal testing before public release.
