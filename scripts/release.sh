#!/bin/bash
#!/bin/bash

set -e

RELEASE_TYPE=$1

if [ -z "$RELEASE_TYPE" ]; then
  echo "Usage: ./scripts/release.sh [patch|minor|major]"
  exit 1
fi

if [ "$RELEASE_TYPE" != "patch" ] && [ "$RELEASE_TYPE" != "minor" ] && [ "$RELEASE_TYPE" != "major" ]; then
  echo "Error: Release type must be patch, minor, or major"
  exit 1
fi

echo "Preparing $RELEASE_TYPE release..."

# Change to electron package directory
cd packages/electron

# Get current version
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo "Current version: $CURRENT_VERSION"

# Bump version using npm
npm version $RELEASE_TYPE --no-git-tag-version

# Get new version
NEW_VERSION=$(node -p "require('./package.json').version")
echo "New version: $NEW_VERSION"

# Go back to root
cd ../..

# Update root package-lock.json
npm install --package-lock-only

# Read release notes
RELEASE_NOTES=$(cat packages/electron/RELEASE_NOTES.md)

# Create commit with release notes
git add packages/electron/package.json package-lock.json
git commit -m "Release v$NEW_VERSION

$RELEASE_NOTES"

# Create git tag
git tag "v$NEW_VERSION"

echo ""
echo "Release v$NEW_VERSION created successfully!"
echo ""
echo "Next steps:"
echo "1. Review the commit: git show HEAD"
echo "2. Push the commit: git push origin main"
echo "3. Push the tag to trigger CI: git push origin v$NEW_VERSION"
echo ""
echo "The GitHub Actions workflow will automatically build and publish the release."
