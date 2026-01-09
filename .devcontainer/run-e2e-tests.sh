#!/bin/bash
# Helper script to run E2E tests in the dev container
# Usage: ./run-e2e-tests.sh [test-pattern]
# Example: ./run-e2e-tests.sh e2e/core/app-startup.spec.ts

set -e

# Check if we're in a container (running as root on Linux)
if [ "$(id -u)" = "0" ] && [ "$(uname -s)" = "Linux" ]; then
    echo "Running in container mode..."
    NOSANDBOX="--noSandbox"
else
    NOSANDBOX=""
fi

# Start Xvfb if DISPLAY is set but Xvfb isn't running
if [ -n "$DISPLAY" ] && ! pgrep -x Xvfb > /dev/null 2>&1; then
    echo "Starting Xvfb..."
    Xvfb :99 -screen 0 1920x1080x24 &
    sleep 2
fi

# Navigate to project root
cd "$(dirname "$0")/.."

# Start the dev server in background
echo "Starting Vite dev server..."
cd packages/electron
npx electron-vite dev $NOSANDBOX > /tmp/vite-e2e.log 2>&1 &
DEV_PID=$!
cd ../..

# Wait for dev server
echo "Waiting for dev server on localhost:5273..."
for i in $(seq 1 120); do
    if curl -s --max-time 2 http://localhost:5273 > /dev/null 2>&1; then
        echo "Dev server ready after ${i}s"
        break
    fi
    if [ $i -eq 120 ]; then
        echo "Dev server failed to start. Check /tmp/vite-e2e.log"
        kill $DEV_PID 2>/dev/null || true
        exit 1
    fi
    sleep 1
done

# Wait for app to stabilize
sleep 3

# Run tests
echo ""
echo "Running E2E tests..."
if [ -n "$1" ]; then
    npx playwright test --workers=1 "$@"
else
    npx playwright test --workers=1
fi
TEST_EXIT=$?

# Cleanup
echo ""
echo "Cleaning up..."
kill $DEV_PID 2>/dev/null || true

exit $TEST_EXIT
