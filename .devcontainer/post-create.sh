#!/bin/bash
# Post-create script for Nimbalyst dev container
# This runs after the container is created

set -e

echo "=== Nimbalyst Dev Container Setup ==="

# Install npm dependencies
echo "Installing npm dependencies..."
npm ci

# Build required packages for E2E tests
echo "Building rexical package..."
cd packages/rexical && npm run build && cd ../..

echo "Building extension-sdk..."
cd packages/extension-sdk && npm run build && cd ../..

echo "Building extensions..."
cd packages/extensions/datamodellm && npm run build && cd ../../..
cd packages/extensions/pdf-viewer && npm run build && cd ../../..
cd packages/extensions/csv-spreadsheet && npm run build && cd ../../..

# Build the Electron app (required for E2E tests)
echo "Building Electron app..."
cd packages/electron && npm run build && cd ../..

# Install Playwright browsers (for non-Electron tests if needed)
echo "Installing Playwright dependencies..."
npx playwright install --with-deps chromium

echo ""
echo "=== Setup Complete ==="
echo ""
echo "To run E2E tests:"
echo "  1. Start Xvfb: Xvfb :99 -screen 0 1920x1080x24 &"
echo "  2. Start dev server with --noSandbox:"
echo "     cd packages/electron && npx electron-vite dev --noSandbox"
echo "  3. In another terminal: npx playwright test"
echo ""
echo "Or run a single test:"
echo "  npx playwright test e2e/core/app-startup.spec.ts"
echo ""
echo "Note: The --noSandbox flag is required when running as root in containers."
echo ""
