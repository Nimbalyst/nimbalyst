#!/bin/bash
# Build all marketplace-eligible extensions into .nimext packages
# Usage: ./scripts/build-all-extensions.sh [--output-dir <dir>]
#
# Scans packages/extensions/ for extensions that have:
# - A manifest.json
# - A dist/ directory (or build script)
# - Are not marked as error-test or dev-only

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
EXTENSIONS_DIR="$REPO_ROOT/packages/extensions"
OUTPUT_DIR="$SCRIPT_DIR/../dist"

# Parse optional args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --output-dir) OUTPUT_DIR="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

mkdir -p "$OUTPUT_DIR"

# Extensions to skip (dev-only, test-only, or not standalone)
SKIP_EXTENSIONS="error-test extension-dev-kit"

echo "Building all extensions..."
echo "Output directory: $OUTPUT_DIR"
echo ""

BUILT=0
SKIPPED=0

for EXT_DIR in "$EXTENSIONS_DIR"/*/; do
  EXT_NAME=$(basename "$EXT_DIR")

  # Skip excluded extensions
  if echo "$SKIP_EXTENSIONS" | grep -qw "$EXT_NAME"; then
    echo "Skipping $EXT_NAME (excluded)"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  # Must have manifest.json
  if [ ! -f "$EXT_DIR/manifest.json" ]; then
    echo "Skipping $EXT_NAME (no manifest.json)"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  "$SCRIPT_DIR/build-extension.sh" "$EXT_DIR" --output-dir "$OUTPUT_DIR"
  BUILT=$((BUILT + 1))
  echo ""
done

echo "Built $BUILT extensions, skipped $SKIPPED"
echo "Packages in: $OUTPUT_DIR"
