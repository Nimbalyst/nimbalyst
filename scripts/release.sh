#!/bin/bash

set -e

# Release script for Nimbalyst Electron app
# Usage: ./scripts/release.sh [patch|minor|major]

BUMP_TYPE=$1
RELEASE_NOTES_FILE="packages/electron/RELEASE_NOTES.md"
PACKAGE_JSON="packages/electron/package.json"

# Validate bump type argument
if [[ ! "$BUMP_TYPE" =~ ^(patch|minor|major)$ ]]; then
  echo "Error: Invalid version bump type. Use: patch, minor, or major"
  echo "Usage: ./scripts/release.sh [patch|minor|major]"
  exit 1
fi

# Check if release notes exist
if [ ! -f "$RELEASE_NOTES_FILE" ]; then
  echo "Error: Release notes not found at $RELEASE_NOTES_FILE"
  echo "Please create release notes before running this script."
  exit 1
fi

# Extract only the latest version's notes (from first ## to next ## or end)
RELEASE_NOTES=$(awk '/^## / {if (found) exit; found=1; next} found {print}' "$RELEASE_NOTES_FILE")

if [ -z "$RELEASE_NOTES" ]; then
  echo "Error: Could not extract release notes from $RELEASE_NOTES_FILE"
  echo "Expected format: ## vX.Y.Z - YYYY-MM-DD followed by release notes"
  exit 1
fi

echo "Release notes:"
echo "----------------------------------------"
echo "$RELEASE_NOTES"
echo "----------------------------------------"
echo ""

# Get current version
CURRENT_VERSION=$(node -p "require('./$PACKAGE_JSON').version")
echo "Current version: $CURRENT_VERSION"

# Bump version in package.json
cd packages/electron
npm version "$BUMP_TYPE" --no-git-tag-version
NEW_VERSION=$(node -p "require('./package.json').version")
cd ../..

echo "New version: $NEW_VERSION"

# Update package-lock.json
echo "Updating package-lock.json..."
npm install --legacy-peer-deps

# Commit changes
echo "Creating release commit..."
git add packages/electron/package.json package-lock.json packages/electron/RELEASE_NOTES.md
git commit -m "$(cat <<EOF
release: v$NEW_VERSION

$RELEASE_NOTES
EOF
)"

# Create tag
echo "Creating git tag v$NEW_VERSION..."
git tag -a "v$NEW_VERSION" -m "$(cat <<EOF
Release v$NEW_VERSION

$RELEASE_NOTES
EOF
)"

echo ""
echo "✓ Release v$NEW_VERSION prepared successfully"
echo ""
echo "Next steps:"
echo "  1. Review the commit: git show HEAD"
echo "  2. Push the tag to trigger CI: git push origin v$NEW_VERSION"
echo "  3. Push the commit: git push"
echo ""
echo "Or to push both at once: git push && git push origin v$NEW_VERSION"
