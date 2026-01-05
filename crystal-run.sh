#!/bin/bash

# Detect if we're in a git worktree and find the main repo root
# Sets WORKTREE_MODE=true and MAIN_REPO_ROOT if in a worktree
detect_worktree() {
  WORKTREE_MODE=false
  MAIN_REPO_ROOT=""

  # Check if .git is a file (worktree) rather than a directory (main repo)
  if [ -f ".git" ]; then
    WORKTREE_MODE=true
    # Parse the gitdir from the .git file to find the main repo
    local gitdir
    gitdir=$(cat .git | sed 's/gitdir: //')
    # The gitdir points to .git/worktrees/<name>, so go up 3 levels to get main repo
    MAIN_REPO_ROOT=$(cd "$gitdir/../../.." && pwd)
    echo "Worktree detected. Main repo: $MAIN_REPO_ROOT"
  fi
}

# Check if a package has local changes compared to main repo
# Returns 0 (true) if package has changes, 1 (false) if identical to main repo
package_has_worktree_changes() {
  local pkg_dir="$1"

  if [ "$WORKTREE_MODE" != "true" ]; then
    # Not in a worktree, consider it as having changes (needs normal rebuild check)
    return 0
  fi

  # Compare this package's source files with the main repo's version
  # Use git diff to compare the working tree with the main repo's HEAD
  local main_pkg_dir="$MAIN_REPO_ROOT/$pkg_dir"

  if [ ! -d "$main_pkg_dir" ]; then
    # Package doesn't exist in main repo, consider it as having changes
    return 0
  fi

  # Compare source directories
  if ! diff -rq "$pkg_dir/src" "$main_pkg_dir/src" >/dev/null 2>&1; then
    return 0
  fi

  # Compare key config files
  for config_file in vite.config.ts package.json tsconfig.json; do
    if [ -f "$pkg_dir/$config_file" ] || [ -f "$main_pkg_dir/$config_file" ]; then
      if ! diff -q "$pkg_dir/$config_file" "$main_pkg_dir/$config_file" >/dev/null 2>&1; then
        return 0
      fi
    fi
  done

  # No changes detected
  return 1
}

# Check if main repo has a built package we can copy
# Returns 0 (true) if main repo dist exists, 1 (false) otherwise
main_repo_has_dist() {
  local pkg_dir="$1"

  if [ "$WORKTREE_MODE" != "true" ]; then
    return 1
  fi

  local main_dist="$MAIN_REPO_ROOT/$pkg_dir/dist"
  [ -d "$main_dist" ] && [ "$(ls -A "$main_dist" 2>/dev/null)" ]
}

# Copy dist folder from main repo to worktree
copy_dist_from_main_repo() {
  local pkg_dir="$1"
  local main_dist="$MAIN_REPO_ROOT/$pkg_dir/dist"
  local local_dist="$pkg_dir/dist"

  echo "  Copying dist from main repo for $pkg_dir..."
  rm -rf "$local_dist"
  cp -R "$main_dist" "$local_dist"
}

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

# Detect worktree mode
detect_worktree

# Install dependencies if node_modules doesn't exist
needs_npm_install=false
if [ ! -d "node_modules" ]; then
  needs_npm_install=true
fi

# Determine what needs to be built
# In worktree mode, we can skip building if:
#   1. Package has no changes compared to main repo, AND
#   2. Main repo has the dist folder built (we'll copy it)
build_rexical=false
build_runtime=false
build_rexical_reason=""
build_runtime_reason=""
copy_rexical_from_main=false
copy_runtime_from_main=false

# Check rexical
if [ "$WORKTREE_MODE" = "true" ]; then
  if package_has_worktree_changes "packages/rexical"; then
    # Has local changes, need to check if rebuild required
    if needs_rebuild "packages/rexical"; then
      build_rexical=true
      build_rexical_reason=" (local changes)"
    fi
  elif main_repo_has_dist "packages/rexical"; then
    # No local changes and main repo has dist - copy it
    if [ ! -d "packages/rexical/dist" ]; then
      copy_rexical_from_main=true
    fi
  else
    # No local changes but main repo doesn't have dist - need to build
    if needs_rebuild "packages/rexical"; then
      build_rexical=true
    fi
  fi
else
  # Not in worktree, use standard rebuild check
  if needs_rebuild "packages/rexical"; then
    build_rexical=true
  fi
fi

# Check runtime
if [ "$WORKTREE_MODE" = "true" ]; then
  if package_has_worktree_changes "packages/runtime"; then
    # Has local changes, need to check if rebuild required
    if needs_rebuild "packages/runtime"; then
      build_runtime=true
      build_runtime_reason=" (local changes)"
    elif [ "$build_rexical" = true ]; then
      build_runtime=true
      build_runtime_reason=" (rexical changed)"
    fi
  elif main_repo_has_dist "packages/runtime"; then
    # No local changes and main repo has dist - copy it (unless rexical changed)
    if [ "$build_rexical" = true ]; then
      build_runtime=true
      build_runtime_reason=" (rexical changed)"
    elif [ ! -d "packages/runtime/dist" ]; then
      copy_runtime_from_main=true
    fi
  else
    # No local changes but main repo doesn't have dist - need to build
    if needs_rebuild "packages/runtime"; then
      build_runtime=true
    elif [ "$build_rexical" = true ]; then
      build_runtime=true
      build_runtime_reason=" (rexical changed)"
    fi
  fi
else
  # Not in worktree, use standard rebuild check
  if needs_rebuild "packages/runtime"; then
    build_runtime=true
  elif [ "$build_rexical" = true ]; then
    build_runtime=true
    build_runtime_reason=" (rexical changed)"
  fi
fi

# Print build plan
echo ""
echo "Build plan:"
if [ "$copy_rexical_from_main" = true ]; then
  echo "  rexical: COPY from main repo (no local changes)"
elif [ "$build_rexical" = true ]; then
  echo "  rexical: BUILD$build_rexical_reason"
else
  echo "  rexical: skip (up-to-date)"
fi
if [ "$copy_runtime_from_main" = true ]; then
  echo "  runtime: COPY from main repo (no local changes)"
elif [ "$build_runtime" = true ]; then
  echo "  runtime: BUILD$build_runtime_reason"
else
  echo "  runtime: skip (up-to-date)"
fi
echo ""

# Execute build plan
if [ "$needs_npm_install" = true ]; then
  echo "Installing dependencies..."
  npm install
fi

# Handle rexical
if [ "$copy_rexical_from_main" = true ]; then
  copy_dist_from_main_repo "packages/rexical"
elif [ "$build_rexical" = true ]; then
  echo "Building rexical package..."
  cd packages/rexical
  npm run build
  cd ../..
  save_build_hash "packages/rexical"
fi

# Handle runtime
if [ "$copy_runtime_from_main" = true ]; then
  copy_dist_from_main_repo "packages/runtime"
elif [ "$build_runtime" = true ]; then
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
