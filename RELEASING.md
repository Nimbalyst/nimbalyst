# Release Process

This document describes the release process for Nimbalyst.

## Overview

Nimbalyst uses a streamlined release workflow with:
- **CHANGELOG.md**: Single source of truth for all release notes
- **Annotated Git Tags**: Tags include release notes for GitHub releases
- **Automated Builds**: GitHub Actions builds and publishes releases
- **Release Branches** (optional): For controlled releases and hotfixes

## Standard Release Workflow

The release process is divided into two phases to allow for internal testing before public release.

### Phase 1: Internal Release

#### 1. Prepare Release Notes

As you work, add changes to the `[Unreleased]` section of `CHANGELOG.md`:

```markdown
## [Unreleased]

### Added
- New feature X that does Y

### Fixed
- Fixed bug where Z happened

### Changed
- Updated behavior of A to B
```

#### 2. Create Internal Release (Using /release Command)

Run the `/release` slash command in Claude Code:

```
/release patch    # For bug fixes (0.42.60 → 0.42.61)
/release minor    # For new features (0.42.60 → 0.43.0)
/release major    # For breaking changes (0.42.60 → 1.0.0)
```

This command will:
1. Review commits since last release
2. Generate TWO versions of release notes:
   - Developer CHANGELOG (technical, all changes)
   - Public release notes (user-facing only)
3. Update CHANGELOG.md [Unreleased] section
4. Wait for your approval

#### 3. Execute Internal Release

After approving the release notes, the command will run `./scripts/release.sh` which:
1. Bumps version in `package.json`
2. Updates `package-lock.json`
3. Moves [Unreleased] notes to new version section in CHANGELOG.md
4. Creates a commit with release notes
5. Creates an annotated git tag with release notes

#### 4. Push to Private Repo

```bash
# Review the changes
git show HEAD
git show v0.42.61

# Push commit and tag to PRIVATE repo
git push origin main
git push origin v0.42.61
```

#### 5. GitHub Actions Builds Internal Release

Pushing the tag triggers the GitHub Actions workflow which:
1. Builds for macOS, Windows, and Linux
2. Signs and notarizes macOS builds
3. Creates release in `nimbalyst/nimbalyst-code` (private repo)
4. Uploads build artifacts

#### 6. Test Internal Build

Before proceeding to Phase 2:
1. Download the build from the private repo release
2. Test thoroughly on target platforms
3. Verify all features work as expected
4. Check for any critical issues

### Phase 2: Public Release

Only proceed after successfully testing the internal build.

#### 1. Verify Internal Build

Ensure:
- Internal build has been tested
- No critical issues found
- Ready to release publicly

#### 2. Publish to Public Repo (Using /release-public Command)

Run the `/release-public` slash command in Claude Code:

```
/release-public
```

This command will:
1. Extract the current version from git tags
2. Show the user-facing public release notes
3. Provide instructions for publishing

#### 3. Execute Public Release

Follow the command's guidance to either:

**Option A: GitHub Actions Workflow (Recommended)**
1. Visit: https://github.com/nimbalyst/nimbalyst-code/actions/workflows/publish-public.yml
2. Click "Run workflow"
3. Enter the version tag (e.g., v0.42.61)
4. Paste the public release notes from the `/release-public` command
5. Click "Run workflow"

The workflow will automatically:
- Download artifacts from the private repo
- Create the release on the public repo
- Upload all build artifacts

**Option B: Manual Publication**
1. Visit: https://github.com/nimbalyst/nimbalyst/releases/new
2. Create release with the public notes provided by the command
3. Manually download and upload artifacts from the private repo

#### 4. Verify Public Release

Check that:
- Release appears on public repo: https://github.com/nimbalyst/nimbalyst/releases
- Only user-facing changes are mentioned
- No internal/technical details exposed
- Build artifacts are available (if applicable)

## Release Branch Workflow (Optional)

For more control or when you need to test a release before publishing:

### 1. Create Release Branch

```bash
# Create release branch from main
git checkout -b release/v0.42.61 main

# Or create from a specific commit
git checkout -b release/v0.42.61 abc123
```

### 2. Prepare Release on Branch

Follow the standard workflow steps 1-3 above, but commit to the release branch:

```bash
# After running release.sh, you'll be on the release branch
git push origin release/v0.42.61
```

### 3. Test the Release

The GitHub Actions workflow will build the release branch automatically. You can:
- Download and test the artifacts
- Make additional fixes if needed
- Commit fixes to the release branch

### 4. Merge and Tag

Once satisfied with the release:

```bash
# Merge to main
git checkout main
git merge release/v0.42.61 --no-ff

# Push everything
git push origin main
git push origin v0.42.61
```

## Hotfix Workflow

For urgent fixes to production:

### 1. Create Hotfix Branch from Tag

```bash
# Branch from the last release tag
git checkout -b hotfix/v0.42.62 v0.42.61
```

### 2. Make Fix and Update CHANGELOG

```bash
# Make your fix
git commit -m "fix: critical bug in X"

# Update CHANGELOG.md [Unreleased] section
# Add ### Fixed section with your fix
```

### 3. Create Hotfix Release

```bash
# Run release script
./scripts/release.sh patch

# This creates v0.42.62
```

### 4. Merge Back to Main

```bash
# Push hotfix
git push origin v0.42.62

# Merge back to main
git checkout main
git merge hotfix/v0.42.62
git push origin main
```

## Manual Release Creation

If you need to create a release without the `/release` command:

1. Update CHANGELOG.md [Unreleased] section
2. Run: `./scripts/release.sh [patch|minor|major]`
3. Follow prompts and push when ready

## Troubleshooting

### Release Notes Not Appearing in GitHub Release

The release notes should come from the annotated git tag. To verify:

```bash
# Check tag annotation
git show v0.42.61

# Should show the release notes
```

If notes are missing, the workflow will fall back to extracting from CHANGELOG.md.

### Build Failed on GitHub Actions

Check the Actions tab in GitHub:
- https://github.com/nimbalyst/nimbalyst-code/actions

Common issues:
- Code signing certificates expired
- PUBLIC_REPO_PAT token needs renewal
- Dependency installation failed

### Can't Push to Main Branch

Repository has branch protection rules. You need admin access to bypass, or:
- Create a release branch
- Open a PR
- Merge after CI passes

## Files Involved

- **CHANGELOG.md**: Release notes history
- **scripts/release.sh**: Release automation script
- **.claude/commands/release.md**: Claude Code slash command
- **.github/workflows/electron-build.yml**: CI/CD workflow
- **packages/electron/package.json**: Version number
