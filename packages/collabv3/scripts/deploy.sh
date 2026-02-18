#!/usr/bin/env bash
set -euo pipefail

# CollabV3 deploy script
# Usage: ./scripts/deploy.sh [patch|minor|major] [--env staging|production]
#
# Bumps the package.json version, deploys to Cloudflare with the version
# injected at build time, and creates a git tag.
#
# Examples:
#   ./scripts/deploy.sh patch --env production
#   ./scripts/deploy.sh minor --env staging

BUMP_TYPE="${1:-patch}"
ENV_FLAG="${2:---env}"
ENV_NAME="${3:-production}"

if [[ "$BUMP_TYPE" != "patch" && "$BUMP_TYPE" != "minor" && "$BUMP_TYPE" != "major" ]]; then
  echo "Usage: ./scripts/deploy.sh [patch|minor|major] [--env staging|production]"
  exit 1
fi

if [[ "$ENV_FLAG" != "--env" ]]; then
  echo "Usage: ./scripts/deploy.sh [patch|minor|major] [--env staging|production]"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PKG_DIR"

# Bump version in package.json (no git tag from npm)
NEW_VERSION=$(npm version "$BUMP_TYPE" --no-git-tag-version)
# npm version returns "vX.Y.Z", strip the v
VERSION="${NEW_VERSION#v}"

echo "Deploying collabv3 $VERSION to $ENV_NAME..."

# Deploy with version injected as a build-time define
npx wrangler deploy --env "$ENV_NAME" --define "COLLABV3_VERSION:\"$VERSION\""

echo ""
echo "Deployed collabv3 $VERSION to $ENV_NAME"
echo ""
echo "Verify: curl https://sync.nimbalyst.com/health"
echo ""
echo "To tag this deploy:"
echo "  git add packages/collabv3/package.json"
echo "  git commit -m \"collabv3: deploy $VERSION to $ENV_NAME\""
echo "  git tag collabv3-v$VERSION"
