#!/bin/bash

echo "Setting up electron for development..."

# Download electron binary if not present
npx -y electron@37.2.6 --version > /dev/null 2>&1

echo "Electron binary ready. You can now run:"
echo "  npm run dev  (from packages/electron directory)"
echo ""
echo "Note: Due to pnpm/electron incompatibility, the first time you run"
echo "npm run dev it will fail. Just run it a second time and it will work."