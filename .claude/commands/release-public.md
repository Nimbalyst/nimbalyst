---
description: Publish tested internal release to public repo
---
Publish the tested internal release to the public repository following this automated workflow:

## PHASE 1: COLLECT INFORMATION

1. **Ask user for version to promote**:
  - Prompt: "Which version do you want to promote to public? (e.g., v0.45.29)"
  - Get the version tag from user input

2. **Ask user for last public release**:
  - Prompt: "What was the last public release version? (e.g., v0.45.25)"
  - This determines which CHANGELOG entries to include
  - Public release notes will cover ALL changes from that version to the new version

## PHASE 2: GENERATE PUBLIC RELEASE NOTES

1. **Extract cumulative CHANGELOG entries**:
  - Read CHANGELOG.md
  - Find all release sections from the last public version through the new version
  - Extract all entries from Added, Changed, and Fixed categories
  - Skip Removed and internal-only changes

2. **Transform to user-friendly format**:
  - Convert categories:
    - Added → "### New Features"
    - Changed → "### Improvements"
    - Fixed → "### Fixed"
  - Filter out internal/technical items:
    - Remove: TypeScript fixes, refactoring, developer tooling, internal optimizations
    - Keep: User-facing features, UI improvements, bug fixes
  - Use present tense and marketing language

3. **Create PUBLIC_RELEASE_NOTES.md**:
  - Write formatted notes to `PUBLIC_RELEASE_NOTES.md` in repository root
  - Show the user what will be published
  - Ask for approval before proceeding

## PHASE 3: COMMIT AND PUBLISH

1. **Commit the release notes**:
  - Stage: `git add PUBLIC_RELEASE_NOTES.md`
  - Commit: `git commit -m "docs: public release notes for [VERSION]"`
  - Push: `git push origin main`

2. **Trigger publish workflow**:
  - Use GitHub CLI to trigger the workflow:
    ```bash
    gh workflow run publish-public.yml -f version=[VERSION]
    ```
  - This triggers: https://github.com/nimbalyst/nimbalyst-code/actions/workflows/publish-public.yml
  - The workflow will:
    - Fetch PUBLIC_RELEASE_NOTES.md from the repo
    - Download artifacts from private release
    - Create public release with the notes
    - Upload all build artifacts

3. **Provide confirmation**:
  - Show workflow trigger URL
  - Show expected public release URL: https://github.com/nimbalyst/nimbalyst/releases/tag/[VERSION]
  - Note: Workflow takes 2-3 minutes to complete

## Example Usage

```
User: /release-public
Assistant: Which version do you want to promote to public? (e.g., v0.45.29)
User: v0.45.29
Assistant: What was the last public release version? (e.g., v0.45.25)
User: v0.45.25

[Generates cumulative notes covering v0.45.26, v0.45.27, v0.45.28, v0.45.29]