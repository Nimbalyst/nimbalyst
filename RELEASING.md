# Release Process

This document describes the release process for Nimbalyst.

## Overview

Nimbalyst uses a streamlined release workflow with:
- **CHANGELOG.md**: Single source of truth for all release notes
- **Annotated Git Tags**: Tags include release notes for GitHub releases
- **Automated Builds**: GitHub Actions builds and publishes releases
- **Release Branches** (optional): For controlled releases and hotfixes

## Standard Release Workflow

### 1. Prepare Release Notes

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

### 2. Create Release (Using /release Command)

Run the `/release` slash command in Claude Code:

```
/release patch    # For bug fixes (0.42.60 → 0.42.61)
/release minor    # For new features (0.42.60 → 0.43.0)
/release major    # For breaking changes (0.42.60 → 1.0.0)
```

This command will:
1. Review commits since last release
2. Generate release notes
3. Update CHANGELOG.md [Unreleased] section
4. Wait for your approval

### 3. Execute Release

After approving the release notes, the command will run `./scripts/release.sh` which:
1. Bumps version in `package.json`
2. Updates `package-lock.json`
3. Moves [Unreleased] notes to new version section in CHANGELOG.md
4. Creates a commit with release notes
5. Creates an annotated git tag with release notes

### 4. Push Release

```bash
# Review the changes
git show HEAD
git show v0.42.61

# Push commit and tag
git push origin main
git push origin v0.42.61
```

### 5. GitHub Actions Builds Release

Pushing the tag triggers the GitHub Actions workflow which:
1. Builds for macOS, Windows, and Linux
2. Signs and notarizes macOS builds
3. Creates release in `nimbalyst/nimbalyst-code` (private repo)
4. Publishes release to `nimbalyst/nimbalyst` (public repo)
5. Uploads build artifacts and update manifests

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
