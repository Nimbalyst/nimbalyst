---
description: Publish tested internal release to public repo
---
Publish the tested internal release to the public repository:

## Prerequisites

Before running this command, ensure:
1. You have completed Phase 1 of the release process (`/release [patch|minor|major]`)
2. The internal build has been created on the private repo (nimbalyst/nimbalyst-code)
3. You have downloaded and tested the internal build
4. No critical issues were found during testing

## Steps

1. **Get current version**:
  - Run: `git describe --tags --abbrev=0`
  - This shows the version that was just released internally

2. **Extract public release notes**:
  - Read the CHANGELOG.md file
  - Find the release notes for the current version
  - Filter to ONLY user-facing changes:
    - Include: New features, bug fixes, UI improvements
    - Exclude: Internal refactoring, TypeScript fixes, developer tooling
  - Format in user-friendly language (present tense, marketing style)

3. **Verify release exists on private repo**:
  - Check: https://github.com/nimbalyst/nimbalyst-code/releases
  - Confirm the release exists and has build artifacts attached

4. **Show publication options**:

  **Option A: GitHub Actions Workflow (Recommended)**
  - Trigger the "Publish to Public Repository" workflow:
    - Visit: https://github.com/nimbalyst/nimbalyst-code/actions/workflows/publish-public.yml
    - Click "Run workflow"
    - Enter the version tag (e.g., v0.42.61)
    - Paste the public release notes (provided by this command)
    - Click "Run workflow"
  - The workflow will:
    - Validate the version exists
    - Download artifacts from private repo
    - Create release on public repo (nimbalyst/nimbalyst)
    - Upload all build artifacts

  **Option B: Manual Publication**
  - Visit: https://github.com/nimbalyst/nimbalyst/releases/new
  - Create new release with:
    - Tag: v[VERSION] (same as private repo)
    - Title: "Nimbalyst v[VERSION]"
    - Description: [PUBLIC RELEASE NOTES]
  - Manually download and upload artifacts from private repo release

5. **Provide public release notes**:
  - Display the filtered, user-friendly release notes
  - User can copy these to the public GitHub release description

6. **Verify publication**:
  - After publishing, check: https://github.com/nimbalyst/nimbalyst/releases
  - Confirm the public release is visible with correct notes
  - Verify no internal details are exposed

## Example Public Release Notes

For a release that fixed bugs and added features, the public notes might look like:

```markdown
This release brings several improvements to your editing experience:

- Find and replace text across your documents with the new search panel
- Improved performance when working with large markdown files
- Fixed an issue where autosave could fail on network drives
- Enhanced AI chat with better context awareness

Download the latest version and let us know what you think!
```

Note how this:
- Uses present tense and active voice
- Focuses on user benefits
- Omits technical/internal details
- Keeps a friendly, approachable tone
