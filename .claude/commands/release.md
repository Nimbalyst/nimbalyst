---
description: Prepare and execute a release (patch/minor/major)
---
Prepare a {{arg1}} release following this workflow:

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

5. **Execute release** (after user approval):
  - Run `./scripts/release.sh {{arg1}}`
  - The script will:
    - Bump version in `packages/electron/package.json`
    - Update package-lock.json
    - Move [Unreleased] notes to a new versioned release section in CHANGELOG.md
    - Create commit with release notes
    - Create annotated git tag with release notes
    - Display next steps for pushing to trigger CI
  - Show the PUBLIC release notes again after release is created
  - User can copy these to update the GitHub release that CI creates

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
