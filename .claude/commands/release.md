---
description: Prepare and execute a release (patch/minor/major)
---
Prepare a {{arg1}} release following this workflow:

1. **Get commits since last release**:
  - Find the last git tag: `git describe --tags --abbrev=0`
  - Get commits since that tag: `git log [last-tag]..HEAD --oneline`

2. **Generate release notes**:
  - Create concise bullet-point release notes summarizing the most important changes
  - Focus on user-facing changes (features, fixes, improvements)
  - Filter out trivial changes (chore, docs, minor refactors)
  - Keep it brief and clear
  - Categorize changes using these sections:
    - **Added**: New features
    - **Changed**: Changes to existing functionality
    - **Fixed**: Bug fixes
    - **Removed**: Removed features

3. **Update CHANGELOG.md**:
  - Add notes to the `[Unreleased]` section in `CHANGELOG.md` (repository root)
  - Use the standard format with ### headings for each category
  - Only include categories that have changes
  - Show the user the updated CHANGELOG for approval

4. **Execute release** (after user approval):
  - Run `./scripts/release.sh {{arg1}}`
  - The script will:
    - Bump version in `packages/electron/package.json`
    - Update package-lock.json
    - Move [Unreleased] notes to a new versioned release section in CHANGELOG.md
    - Create commit with release notes
    - Create annotated git tag with release notes
    - Display next steps for pushing to trigger CI

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
