#!/bin/bash

# Kill any existing Preditor processes
echo "Killing any existing Preditor processes..."
pkill -f "Preditor" || true
pkill -f "preditor" || true
pkill -f "electron.*packages/electron" || true

# Wait a moment for processes to fully terminate
sleep 2

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi

# Build rexical package first (required dependency)
echo "Building rexical package..."
cd packages/rexical
npm run build
cd ../..

# Build runtime package (depends on rexical)
echo "Building runtime package..."
cd packages/runtime
npm run build
cd ../..

# Clean build caches to ensure fresh build with updated packages
#echo "Cleaning build caches..."
#rm -rf packages/electron/node_modules/.vite
#rm -rf packages/runtime/node_modules/.vite
#rm -rf node_modules/.vite

# Navigate to the electron package directory
cd packages/electron

# Run the dev app
echo "Starting Preditor..."
npm run dev

echo "Preditor has been launched!"
