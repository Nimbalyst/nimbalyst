#!/bin/bash

# Kill any existing Preditor processes
echo "Killing any existing Preditor processes..."
pkill -f "Preditor" || true
pkill -f "preditor" || true
pkill -f "electron.*packages/electron" || true

# Wait a moment for processes to fully terminate
sleep 2

# Navigate to the electron package directory
cd packages/electron

# Build the app
echo "Building Preditor..."
npm run build:mac:local

# Run the built app
echo "Starting Preditor..."
npm run dev

echo "Preditor has been launched!"