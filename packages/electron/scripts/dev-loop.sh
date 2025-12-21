#!/bin/bash
# Dev loop script that watches for restart requests and relaunches npm run dev
# Usage: ./scripts/dev-loop.sh
#
# This script runs npm run dev in a loop. When the app exits, it checks for
# a .restart-requested file. If present, it restarts npm run dev.
# If not present, it exits (user manually closed the app).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ELECTRON_DIR="$(dirname "$SCRIPT_DIR")"
RESTART_SIGNAL="$ELECTRON_DIR/.restart-requested"

cd "$ELECTRON_DIR"

# Clean up any stale restart signal
rm -f "$RESTART_SIGNAL"

# Add signal file to gitignore if not already there
if ! grep -q "^\.restart-requested$" .gitignore 2>/dev/null; then
  echo ".restart-requested" >> .gitignore
fi

echo "Starting Nimbalyst dev loop..."
echo "Use /restart in the AI chat to restart the app."
echo ""

while true; do
  # Run the dev server
  npm run dev
  EXIT_CODE=$?

  # Check if restart was requested
  if [ -f "$RESTART_SIGNAL" ]; then
    echo ""
    echo "Restart requested, relaunching in 2 seconds..."
    rm -f "$RESTART_SIGNAL"
    sleep 2
    echo ""
  else
    # Normal exit (user closed the app or error)
    echo ""
    echo "Dev server exited with code $EXIT_CODE"
    exit $EXIT_CODE
  fi
done
