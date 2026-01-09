#!/bin/bash
# Wrapper script for npm run dev that supports --user-data-dir argument
# Usage: ./scripts/dev.sh --user-data-dir=/path/to/dir

# Parse arguments for --user-data-dir
for arg in "$@"; do
  if [[ "$arg" == --user-data-dir=* ]]; then
    export NIMBALYST_USER_DATA_DIR="${arg#--user-data-dir=}"
    echo "[dev.sh] Using custom userData directory: $NIMBALYST_USER_DATA_DIR"
  fi
done

# Run the actual dev command
npm run build:worker && npx electron-vite dev
