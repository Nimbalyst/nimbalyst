---
description: Publish tested internal release to public repo (as draft)
---
Publish the tested internal release to the public repository as a **draft release** following this automated workflow:

## PHASE 1: COLLECT INFORMATION

1. **Get current version to promote**:
  - Run: `git describe --tags --abbrev=0`
  - This returns the most recent tag (the version to promote)
  - Display to user: "Version to promote: [VERSION]"

2. **Fetch last public release automatically**:
  - Use WebFetch to query: `https://api.github.com/repos/nimbalyst/nimbalyst/releases/latest`
  - Extract the `tag_name` field from the response (this is the last public release version)

3. **Display release summary**:
  - Output both versions clearly to the user:
```
    Releasing: [NEW_VERSION]
    Last public release: [LAST_VERSION]
```
  - This shows the range of changes that will be included in the release notes

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

3. **Create PUBLIC\_RELEASE\_NOTES.md**:
  - Write formatted notes to `PUBLIC_RELEASE_NOTES.md` in repository root
  - Show the user what will be published

4. **STOP and wait for user refinement**:
  - Tell the user: "I've written the draft release notes to `PUBLIC_RELEASE_NOTES.md`. Please review and edit the file directly if you'd like to make any changes. Let me know when you're ready to proceed with committing and publishing."
  - Use AskUserQuestion to pause and wait for the user's response
  - Do NOT proceed to Phase 3 until the user explicitly confirms they are ready
  - If the user requests changes, make them and ask again

## PHASE 3: COMMIT AND PUBLISH

1. **Re-read PUBLIC\_RELEASE\_NOTES.md** to pick up any edits the user made directly.

2. **Commit the release notes**:
  - Stage: `git add PUBLIC_RELEASE_NOTES.md`
  - Commit: `git commit -m "docs: public release notes for [VERSION]"`
  - Push: `git push origin main`

3. **Trigger publish workflow**:
  - Use GitHub CLI to trigger the workflow:
```bash
    gh workflow run publish-public.yml -f version=[VERSION]
```
  - This triggers: https://github.com/nimbalyst/nimbalyst-code/actions/workflows/publish-public.yml
  - The workflow will:
    - Fetch PUBLIC_RELEASE_NOTES.md from the repo
    - Download artifacts from private release
    - Create a **draft** public release with the notes
    - Upload all build artifacts
  - **Note**: The release is created as a draft - you must manually publish it from the GitHub releases page when ready

4. **Provide confirmation**:
  - Show workflow trigger URL
  - Show expected public release URL: https://github.com/nimbalyst/nimbalyst/releases/tag/[VERSION]
  - Note: Workflow takes 2-3 minutes to complete

## Example Usage

```
User: /release-public
Assistant: [Runs git describe --tags --abbrev=0]
Assistant: [Fetches https://api.github.com/repos/nimbalyst/nimbalyst/releases/latest]

Releasing: v0.45.29
Last public release: v0.45.25

[Generates cumulative notes covering v0.45.26, v0.45.27, v0.45.28, v0.45.29]
```