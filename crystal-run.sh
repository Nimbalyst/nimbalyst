#!/bin/bash

# Compute a hash of all source files that affect the build
# This is worktree-safe because it's based on content, not timestamps
compute_source_hash() {
  local pkg_dir="$1"
  # Hash all source files + config files that affect the build
  # Using git ls-files to only include tracked files, sorted for consistency
  (
    cd "$pkg_dir"
    # Get content hash of all relevant files
    find src -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.css" -o -name "*.js" \) -print0 2>/dev/null | \
      sort -z | \
      xargs -0 cat 2>/dev/null | \
      shasum -a 256 | \
      cut -d' ' -f1
    # Also include config files in the hash
    cat vite.config.ts package.json 2>/dev/null | shasum -a 256 | cut -d' ' -f1
  ) | shasum -a 256 | cut -d' ' -f1
}

# Check if a package needs rebuilding based on content hash
# Returns 0 (true) if rebuild needed, 1 (false) if up-to-date
needs_rebuild() {
  local pkg_dir="$1"
  local hash_file="$pkg_dir/dist/.build-hash"

  # If dist or hash file doesn't exist, definitely need to build
  if [ ! -f "$hash_file" ]; then
    return 0
  fi

  local current_hash
  current_hash=$(compute_source_hash "$pkg_dir")
  local stored_hash
  stored_hash=$(cat "$hash_file" 2>/dev/null)

  if [ "$current_hash" != "$stored_hash" ]; then
    return 0
  fi

  # No rebuild needed
  return 1
}

# Save the current source hash after a successful build
save_build_hash() {
  local pkg_dir="$1"
  local hash_file="$pkg_dir/dist/.build-hash"
  compute_source_hash "$pkg_dir" > "$hash_file"
}

# Kill any existing Preditor processes
echo "Killing any existing Preditor processes..."
pkill -f "Nimbalyst" || true
pkill -f "nimbalyst" || true
pkill -f "electron.*packages/electron" || true

# Wait a moment for processes to fully terminate
sleep 2

# Install dependencies if node_modules doesn't exist
needs_npm_install=false
if [ ! -d "node_modules" ]; then
  needs_npm_install=true
fi

# Determine what needs to be built
build_rexical=false
build_runtime=false
build_runtime_reason=""

if needs_rebuild "packages/rexical"; then
  build_rexical=true
fi

if needs_rebuild "packages/runtime"; then
  build_runtime=true
elif [ "$build_rexical" = true ]; then
  build_runtime=true
  build_runtime_reason=" (rexical changed)"
fi

# Print build plan
echo ""
echo "Build plan:"
echo "  rexical: $([ "$build_rexical" = true ] && echo "BUILD" || echo "skip (up-to-date)")"
echo "  runtime: $([ "$build_runtime" = true ] && echo "BUILD$build_runtime_reason" || echo "skip (up-to-date)")"
echo ""

# Execute build plan
if [ "$needs_npm_install" = true ]; then
  echo "Installing dependencies..."
  npm install
fi

if [ "$build_rexical" = true ]; then
  echo "Building rexical package..."
  cd packages/rexical
  npm run build
  cd ../..
  save_build_hash "packages/rexical"
fi

if [ "$build_runtime" = true ]; then
  echo "Building runtime package..."
  cd packages/runtime
  npm run build
  cd ../..
  save_build_hash "packages/runtime"
fi

# Navigate to the electron package directory
cd packages/electron

# Run the dev app
echo "Starting Preditor..."
npm run dev

echo "Preditor has been launched!"
