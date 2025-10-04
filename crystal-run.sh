#!/bin/bash

# Kill any existing Preditor processes
echo "Killing any existing Preditor processes..."
pkill -f "Preditor" || true
pkill -f "preditor" || true
pkill -f "electron.*packages/electron" || true

# Wait a moment for processes to fully terminate
sleep 2

# Build rexical package first (required dependency)
echo "Building rexical package..."
cd packages/rexical
npm run build
cd ../..

# Navigate to the electron package directory
cd packages/electron

# Run the dev app
echo "Starting Preditor..."
npm run dev

echo "Preditor has been launched!"