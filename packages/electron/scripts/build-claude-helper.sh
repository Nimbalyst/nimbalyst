#!/bin/bash
# Build the Claude CLI helper binary using Bun
# This creates a standalone binary that doesn't show a dock icon on macOS
#
# Usage:
#   ./build-claude-helper.sh          # Build for current architecture
#   ./build-claude-helper.sh --all    # Build for all macOS architectures (arm64 + x64)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ELECTRON_DIR="$SCRIPT_DIR/.."
PROJECT_ROOT="$ELECTRON_DIR/../.."
SDK_DIR="$PROJECT_ROOT/node_modules/@anthropic-ai/claude-agent-sdk"
OUTPUT_DIR="$ELECTRON_DIR/resources/claude-helper-bin"

# Check for bun
if ! command -v bun &> /dev/null; then
    echo "Error: bun is required but not installed."
    echo "Install it with: curl -fsSL https://bun.sh/install | bash"
    exit 1
fi

echo "Building Claude helper binary..."
echo "  SDK: $SDK_DIR"
echo "  Output: $OUTPUT_DIR"

# Create output directory
mkdir -p "$OUTPUT_DIR"

# The CLI entry point
CLI_ENTRY="$SDK_DIR/cli.js"

if [ ! -f "$CLI_ENTRY" ]; then
    echo "Error: CLI entry point not found at $CLI_ENTRY"
    exit 1
fi

cd "$SDK_DIR"

build_for_target() {
    local target=$1
    local outfile=$2

    echo ""
    echo "Building for $target..."
    bun build "$CLI_ENTRY" \
        --compile \
        --outfile "$outfile" \
        --target="$target"

    chmod +x "$outfile"
    echo "Built: $outfile ($(ls -lh "$outfile" | awk '{print $5}'))"
}

if [ "$1" = "--all" ]; then
    # Build for both macOS architectures
    build_for_target "bun-darwin-arm64" "$OUTPUT_DIR/claude-helper-arm64"
    build_for_target "bun-darwin-x64" "$OUTPUT_DIR/claude-helper-x64"

    # Create universal binary using lipo
    echo ""
    echo "Creating universal binary..."
    lipo -create \
        "$OUTPUT_DIR/claude-helper-arm64" \
        "$OUTPUT_DIR/claude-helper-x64" \
        -output "$OUTPUT_DIR/claude-helper"

    chmod +x "$OUTPUT_DIR/claude-helper"

    # Clean up architecture-specific binaries
    rm "$OUTPUT_DIR/claude-helper-arm64" "$OUTPUT_DIR/claude-helper-x64"

    echo "Created universal binary: $OUTPUT_DIR/claude-helper"
    file "$OUTPUT_DIR/claude-helper"
else
    # Build for current platform only (faster for development)
    build_for_target "bun" "$OUTPUT_DIR/claude-helper"
fi

echo ""
ls -lh "$OUTPUT_DIR/claude-helper"

# Verify it runs
echo ""
echo "Verifying binary..."
"$OUTPUT_DIR/claude-helper" --version || echo "Warning: Version check failed (may need API key)"
