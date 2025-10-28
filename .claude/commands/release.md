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
  - Keep it brief - internal notes only
  - Follow commit message conventions (feat:, fix:, refactor:)

3. **Save release notes**:
  - Write notes to `packages/electron/RELEASE_NOTES.md`
  - Show the user the notes for approval

4. **Execute release** (after user approval):
  - Run `./scripts/release.sh {{arg1}}`
  - The script will:
    - Bump version in `packages/electron/package.json`
    - Update package-lock.json
    - Create commit with release notes
    - Create git tag with version number
    - Display next steps for pushing to trigger CI

Valid release types: patch, minor, major
